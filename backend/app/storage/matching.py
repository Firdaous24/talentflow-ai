"""Repository for the recruiter space (phase 8): the only place that decides which
candidate profiles an organization may see, and that computes, stores and reads
matches. Routes and the worker go through it; no route builds its own query.

Visibility (non-negotiable):
- a profile imported by the organization, until it expires (90 days, A2);
- a registered candidate's profile only while that candidate's
  `recruiter_visibility` consent is active. Withdrawing it hides every match at
  once, because the rule is evaluated on each query, never copied.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.orm import Session

from app.db.models import CandidateProfile as ProfileRow
from app.db.models import Consent, CVVersion, ImportBatch, ImportItem, JobOffer, Match, utcnow
from app.models.job import (
    JobAnalysisResponse,
    JobComparisonRequest,
    JobComparisonResponse,
    JobReviewAssertion,
    QualificationProfile,
    ReviewedRequirement,
)
from app.services import coverage
from app.services.extraction import DeterministicCandidateExtractor
from app.services.jobs import DeterministicJobAnalyzer, JobWorkflowError, compare_job
from app.services.pdf import CVParsingError, extract_pdf
from app.storage import cv as store
from app.storage.crypto import DecryptionFailed, new_data_key, open_sealed, seal, unwrap_key, wrap_key

IMPORT_RETENTION = timedelta(days=90)
STUCK_AFTER = timedelta(minutes=10)
MAX_ATTEMPTS = 3


def target_requirements(job: JobOffer) -> list[ReviewedRequirement]:
    if job.reviewed_requirements is not None:
        return [ReviewedRequirement.model_validate(item) for item in job.reviewed_requirements]
    analysis = JobAnalysisResponse.model_validate(job.analysis)
    return [ReviewedRequirement(id=item.id, text=item.text, category=item.category, classification=item.classification) for item in analysis.requirements]


def review_request(analysis: JobAnalysisResponse, requirements: list[ReviewedRequirement], candidate: QualificationProfile) -> JobComparisonRequest:
    return JobComparisonRequest(
        candidate=candidate, job_analysis=analysis, requirements=requirements,
        review=JobReviewAssertion(candidate_confirmed=True, candidate_snapshot=candidate, requirements_reviewed=True, requirement_snapshot=requirements),
    )


# --- Visibility ------------------------------------------------------------


def visible_profile(now: datetime | None = None):
    """SQL condition: may an organization see this profile right now?"""
    now = now or utcnow()
    consented = exists().where(Consent.user_id == ProfileRow.user_id, Consent.purpose == "recruiter_visibility", Consent.withdrawn_at.is_(None))
    return or_(and_(ProfileRow.origin == "imported", ProfileRow.expires_at > now), and_(ProfileRow.origin == "self", consented))


def visible_matches(organization_id: uuid.UUID):
    """Matches of one organization whose profile is visible and whose CV version is confirmed."""
    return (
        select(Match)
        .join(ProfileRow, Match.candidate_profile_id == ProfileRow.id)
        .join(CVVersion, Match.cv_version_id == CVVersion.id)
        .where(Match.organization_id == organization_id, visible_profile(), CVVersion.confirmed_at.is_not(None))
    )


def org_profile(db: Session, organization_id: uuid.UUID, profile_id: uuid.UUID) -> ProfileRow | None:
    """An imported profile owned by the organization (registered profiles are never addressed directly)."""
    return db.scalar(select(ProfileRow).where(ProfileRow.id == profile_id, ProfileRow.organization_id == organization_id, ProfileRow.origin == "imported"))


def next_alias(db: Session, job_id: uuid.UUID) -> int:
    return (db.scalar(select(func.max(Match.alias_number)).where(Match.job_offer_id == job_id)) or 0) + 1


def add_match(db: Session, job: JobOffer, profile: ProfileRow, version: CVVersion, source: str) -> Match:
    match = Match(organization_id=job.organization_id, job_offer_id=job.id, candidate_profile_id=profile.id, cv_version_id=version.id, source=source, alias_number=next_alias(db, job.id), status="pending")
    db.add(match)
    db.flush()
    return match


def invalidate_job(db: Session, job_id: uuid.UUID) -> None:
    """Criteria changed: every match of the offer is recomputed by the worker."""
    db.execute(update(Match).where(Match.job_offer_id == job_id).values(status="pending", comparison_enc=None, required_documented=None, required_total=None, preferred_documented=None, preferred_total=None, needs_review_count=None, computed_at=None))


def follow_version(db: Session, profile_id: uuid.UUID, version_id: uuid.UUID) -> None:
    """A newly confirmed CV version replaces the previous one in every match of the profile."""
    db.execute(update(Match).where(Match.candidate_profile_id == profile_id).values(cv_version_id=version_id, status="pending", comparison_enc=None, required_documented=None, required_total=None, preferred_documented=None, preferred_total=None, needs_review_count=None, computed_at=None))


# --- Matches ---------------------------------------------------------------


def _context(match: Match) -> str:
    return f"match|{match.id}|comparison"


def compute(db: Session, master: bytes, match: Match) -> bool:
    """Run compare_job for one pending match; False when it must wait (a review is missing)."""
    job = db.get(JobOffer, match.job_offer_id)
    version = db.get(CVVersion, match.cv_version_id)
    if job is None or version is None or job.criteria_confirmed_at is None or version.confirmed_at is None:
        return False
    profile = store.read_reviewed(master, version)
    if profile is None:
        return False
    try:
        result = compare_job(review_request(JobAnalysisResponse.model_validate(job.analysis), target_requirements(job), coverage.qualification_projection(profile)), DeterministicJobAnalyzer())
    except JobWorkflowError:
        return False
    counts = coverage.coverage_counts(result.comparisons)
    match.comparison_enc = seal(store.data_key(master, version), result.model_dump_json().encode("utf-8"), _context(match))
    match.required_documented, match.required_total = counts.required_documented, counts.required_total
    match.preferred_documented, match.preferred_total = counts.preferred_documented, counts.preferred_total
    match.needs_review_count = counts.needs_review
    match.status, match.computed_at = "current", utcnow()
    return True


def read_comparison(db: Session, master: bytes, match: Match) -> JobComparisonResponse:
    version = db.get(CVVersion, match.cv_version_id)
    return JobComparisonResponse.model_validate_json(open_sealed(store.data_key(master, version), match.comparison_enc, _context(match)))


def compute_pending(db: Session, master: bytes, limit: int = 50) -> int:
    rows = db.scalars(select(Match).where(Match.status == "pending").order_by(Match.created_at).limit(limit).with_for_update(skip_locked=True)).all()
    done = 0
    for match in rows:
        try:
            done += compute(db, master, match)
        except DecryptionFailed:
            continue
    db.commit()
    return done


# --- Import queue ----------------------------------------------------------


def queue_file(db: Session, master: bytes, batch: ImportBatch, position: int, data: bytes, digest: bytes) -> ImportItem:
    item = ImportItem(id=uuid.uuid4(), batch_id=batch.id, organization_id=batch.organization_id, position=position, file_digest=digest)
    duplicate = db.scalar(select(ImportItem.id).where(ImportItem.organization_id == batch.organization_id, ImportItem.file_digest == digest, ImportItem.status.in_(("queued", "parsing", "parsed"))))
    if duplicate is not None:
        item.status = "duplicate"
    else:
        key = new_data_key()
        item.wrapped_key = wrap_key(master, key, f"import_item|{item.id}")
        item.pdf_enc = seal(key, data, f"import_item|{item.id}|pdf")
    db.add(item)
    return item


def _finish(item: ImportItem, status: str, error: str | None = None) -> None:
    item.status, item.error_code = status, error
    item.pdf_enc = item.wrapped_key = None  # The queued PDF and its key are erased once handled.
    item.locked_at = None


def process_next(db: Session, master: bytes) -> bool:
    """Parse one queued file into an imported profile (to review). False when the queue is empty."""
    now = utcnow()
    db.execute(update(ImportItem).where(ImportItem.status == "parsing", ImportItem.locked_at < now - STUCK_AFTER, ImportItem.attempts < MAX_ATTEMPTS).values(status="queued", locked_at=None))
    stuck = db.scalars(select(ImportItem).where(ImportItem.status == "parsing", ImportItem.locked_at < now - STUCK_AFTER)).all()
    for item in stuck:
        _finish(item, "failed", "processing_error")
    db.commit()
    item = db.scalar(select(ImportItem).where(ImportItem.status == "queued").order_by(ImportItem.created_at, ImportItem.position).limit(1).with_for_update(skip_locked=True))
    if item is None:
        return False
    item.status, item.locked_at, item.attempts = "parsing", now, item.attempts + 1
    db.commit()
    item_id = item.id
    try:
        key = unwrap_key(master, item.wrapped_key, f"import_item|{item.id}")
        data = open_sealed(key, item.pdf_enc, f"import_item|{item.id}|pdf")
        document = extract_pdf(data)
        parsed = DeterministicCandidateExtractor().extract(document)
        batch = db.get(ImportBatch, item.batch_id)
        profile = ProfileRow(origin="imported", organization_id=item.organization_id, expires_at=batch.created_at + IMPORT_RETENTION)
        db.add(profile)
        db.flush()
        store.create_version(db, master, profile, 1, document.text, parsed, None)
        item.candidate_profile_id = profile.id
        _finish(item, "parsed")
        db.commit()
    except CVParsingError as error:
        db.rollback()
        _finish(db.get(ImportItem, item_id), "failed", error.code)
        db.commit()
    except Exception:  # noqa: BLE001 - a broken file must never stop the queue; no content is logged.
        db.rollback()
        _finish(db.get(ImportItem, item_id), "failed", "processing_error")
        db.commit()
    return True


def expire_imported(db: Session, now: datetime | None = None) -> int:
    """Decision A2: imported profiles are deleted 90 days after the import (versions and keys cascade)."""
    now = now or utcnow()
    return db.execute(delete(ProfileRow).where(ProfileRow.origin == "imported", ProfileRow.expires_at <= now).execution_options(synchronize_session=False)).rowcount
