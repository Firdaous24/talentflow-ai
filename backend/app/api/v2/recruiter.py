"""Recruiter space (phase 8): an organization's offers, bulk import, review queue,
anonymous ranking by documentary coverage and reasoned identity reveal.

Every route is under /orgs/{organization_id} and starts with the membership
check: another organization's identifiers answer 404, exactly like unknown ones.
Candidate visibility comes from app.storage.matching only. Nothing here acts on
a rank: no threshold, no automatic rejection or acceptance, no e-mail.
"""

import hashlib
import hmac
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Response, UploadFile
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.v2.auth import enforce
from app.api.v2.candidate import MasterKey, unreadable
from app.api.v2.deps import DbDep, SettingsDep, api_error, audit, require_role
from app.api.v2.recruiter_schemas import (
    ATTESTATION_VERSION,
    ConfirmImported,
    Counts,
    Identity,
    ImportBatchOut,
    ImportCreate,
    ImportFailure,
    ImportItemOut,
    ImportProgress,
    Invitation,
    JobCreate,
    JobUpdate,
    MatchDetail,
    OrgJobDetail,
    OrgJobSummary,
    Ranking,
    RankingEntry,
    RankingGroup,
    RevealRequest,
    ReviewItem,
)
from app.api.v2.schemas import RequirementsUpdate
from app.api.v2.spaces import own_membership
from app.auth.ratelimit import IMPORT_BATCHES_PER_ORGANIZATION, JOB_ANALYSES_PER_ACCOUNT, limiter
from app.auth.security import new_token
from app.core.config import Settings
from app.db.models import CandidateProfile as ProfileRow
from app.db.models import CVVersion, ImportBatch, ImportItem, JobOffer, Match, User, utcnow
from app.models.job import JobAnalysisResponse, QualificationProfile
from app.services import coverage, ranking
from app.services.jobs import DeterministicJobAnalyzer, JobWorkflowError, validate_review
from app.services.pdf import MAX_UPLOAD_BYTES
from app.storage import cv as store
from app.storage import matching
from app.storage.crypto import DecryptionFailed

router = APIRouter(prefix="/orgs/{organization_id}", tags=["Recruiter space"])
Recruiter = Depends(require_role("recruiter"))
MAX_JOBS = 100


def member(db: Session, user: User, organization_id: uuid.UUID) -> None:
    own_membership(db, user, organization_id)  # 404 when not a member.


def org_job(db: Session, organization_id: uuid.UUID, job_id: uuid.UUID) -> JobOffer:
    job = db.scalar(select(JobOffer).where(JobOffer.id == job_id, JobOffer.organization_id == organization_id))
    if job is None:
        raise api_error(404, "not_found", "Job post not found.")
    return job


def org_match(db: Session, organization_id: uuid.UUID, match_id: uuid.UUID) -> Match:
    match = db.scalar(matching.visible_matches(organization_id).where(Match.id == match_id))
    if match is None:
        raise api_error(404, "not_found", "Match not found.")
    return match


def org_imported(db: Session, organization_id: uuid.UUID, profile_id: uuid.UUID) -> ProfileRow:
    profile = matching.org_profile(db, organization_id, profile_id)
    if profile is None:
        raise api_error(404, "not_found", "Profile not found.")
    return profile


def job_items(job_id: uuid.UUID):
    return select(ImportItem).join(ImportBatch, ImportItem.batch_id == ImportBatch.id).where(ImportBatch.job_offer_id == job_id)


def review_queue_query(job_id: uuid.UUID):
    return (
        job_items(job_id).join(ProfileRow, ImportItem.candidate_profile_id == ProfileRow.id).join(CVVersion, CVVersion.candidate_profile_id == ProfileRow.id)
        .where(ImportItem.status == "parsed", ProfileRow.origin == "imported", ProfileRow.expires_at > utcnow(), CVVersion.confirmed_at.is_(None))
    )


def counts_of(job: JobOffer, db: Session) -> tuple[int, int, int]:
    visible = matching.visible_matches(job.organization_id).where(Match.job_offer_id == job.id).subquery()
    ranked = db.scalar(select(func.count()).select_from(visible).where(visible.c.status == "current")) or 0
    pending = db.scalar(select(func.count()).select_from(visible).where(visible.c.status == "pending")) or 0
    to_review = db.scalar(select(func.count()).select_from(review_queue_query(job.id).subquery())) or 0
    return ranked, pending, to_review


def job_summary(db: Session, job: JobOffer) -> OrgJobSummary:
    ranked, pending, to_review = counts_of(job, db)
    return OrgJobSummary(
        id=job.id, title=job.title, created_at=job.created_at, status=job.status, visibility=job.visibility, requirement_count=len(matching.target_requirements(job)),
        criteria_confirmed_at=job.criteria_confirmed_at, ranked=ranked, pending=pending, to_review=to_review,
    )


def job_detail(job: JobOffer) -> OrgJobDetail:
    return OrgJobDetail(
        id=job.id, title=job.title, created_at=job.created_at, requirement_count=len(matching.target_requirements(job)), criteria_confirmed_at=job.criteria_confirmed_at,
        source_text=job.source_text, analysis=JobAnalysisResponse.model_validate(job.analysis), requirements=matching.target_requirements(job),
        requirements_reviewed=job.reviewed_requirements is not None, status=job.status, visibility=job.visibility,
    )


def counts(match: Match) -> Counts:
    return Counts(required_documented=match.required_documented or 0, required_total=match.required_total or 0, preferred_documented=match.preferred_documented or 0, preferred_total=match.preferred_total or 0, needs_review=match.needs_review_count or 0)


# --- Offers ----------------------------------------------------------------


@router.post("/jobs", status_code=201, response_model=OrgJobDetail, summary="Create an offer from its text (analyzed, private draft)")
async def create_job(organization_id: uuid.UUID, body: JobCreate, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> OrgJobDetail:
    member(db, user, organization_id)
    if (db.scalar(select(func.count()).select_from(JobOffer).where(JobOffer.organization_id == organization_id)) or 0) >= MAX_JOBS:
        raise api_error(409, "job_limit", f"An organization keeps at most {MAX_JOBS} offers.")
    enforce("job-analysis", str(user.id), JOB_ANALYSES_PER_ACCOUNT)
    limiter.hit("job-analysis", str(user.id))
    analysis = await run_in_threadpool(DeterministicJobAnalyzer().analyze, body.text)
    job = JobOffer(organization_id=organization_id, created_by=user.id, status="draft", visibility="private", title=analysis.job.title, source_text=body.text, analysis=analysis.model_dump(mode="json"))
    db.add(job)
    db.flush()
    audit(db, settings, "job.created", user.id, "job_offer", job.id)
    db.commit()
    return job_detail(job)


@router.get("/jobs", response_model=list[OrgJobSummary], summary="The organization's offers")
def list_jobs(organization_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep) -> list[OrgJobSummary]:
    member(db, user, organization_id)
    jobs = db.scalars(select(JobOffer).where(JobOffer.organization_id == organization_id).order_by(JobOffer.created_at.desc(), JobOffer.id.desc())).all()
    return [job_summary(db, job) for job in jobs]


@router.get("/jobs/{job_id}", response_model=OrgJobDetail, summary="One offer of the organization")
def get_job(organization_id: uuid.UUID, job_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep) -> OrgJobDetail:
    member(db, user, organization_id)
    return job_detail(org_job(db, organization_id, job_id))


@router.patch("/jobs/{job_id}", response_model=OrgJobDetail, summary="Open, close or publish an offer")
def update_job(organization_id: uuid.UUID, job_id: uuid.UUID, body: JobUpdate, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> OrgJobDetail:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    status = body.status or job.status
    visibility = body.visibility or job.visibility
    if status == "open" and job.criteria_confirmed_at is None:
        raise api_error(409, "criteria_review_required", "Confirm the offer's criteria before opening it.")
    if visibility == "public" and status != "open":
        raise api_error(409, "offer_not_open", "Only an open offer can be public.")
    if status == "closed" and job.status != "closed":
        job.closed_at = utcnow()
    elif status != "closed":
        job.closed_at = None
    job.status, job.visibility = status, visibility
    audit(db, settings, "job.updated", user.id, "job_offer", job.id, status=status, visibility=visibility)
    db.commit()
    return job_detail(job)


@router.delete("/jobs/{job_id}", status_code=204, summary="Delete an offer, its imports and matches")
def delete_job(organization_id: uuid.UUID, job_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    audit(db, settings, "job.deleted", user.id, "job_offer", job.id)
    db.delete(job)
    db.commit()
    return Response(status_code=204)


@router.put("/jobs/{job_id}/requirements", response_model=OrgJobDetail, summary="Save reviewed criteria (clears the confirmation)")
def review_job_requirements(organization_id: uuid.UUID, job_id: uuid.UUID, body: RequirementsUpdate, user: User = Recruiter, db: Session = DbDep) -> OrgJobDetail:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    analysis = JobAnalysisResponse.model_validate(job.analysis)
    try:
        validate_review(matching.review_request(analysis, body.requirements, QualificationProfile()), DeterministicJobAnalyzer())
    except JobWorkflowError as error:
        status = 409 if error.code == "source_mismatch" else 422
        raise api_error(status, "analysis_outdated" if status == 409 else error.code, error.message) from error
    job.reviewed_requirements = [item.model_dump(mode="json") for item in body.requirements]
    job.criteria_confirmed_at = None
    if job.status == "open":
        job.status, job.visibility = "draft", "private"  # An offer is never open on unconfirmed criteria.
    matching.invalidate_job(db, job.id)
    db.commit()
    return job_detail(job)


@router.post("/jobs/{job_id}/confirm", response_model=OrgJobDetail, summary="Confirm the reviewed criteria (matches are recomputed)")
def confirm_job_requirements(organization_id: uuid.UUID, job_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> OrgJobDetail:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    requirements = matching.target_requirements(job)
    if not requirements:
        raise api_error(409, "no_requirements", "No criterion was found in this offer.")
    job.reviewed_requirements = [item.model_dump(mode="json") for item in requirements]
    job.criteria_confirmed_at = utcnow()
    matching.invalidate_job(db, job.id)
    audit(db, settings, "job.criteria_confirmed", user.id, "job_offer", job.id)
    db.commit()
    return job_detail(job)


# --- Bulk import -----------------------------------------------------------


def batch_out(db: Session, batch: ImportBatch) -> ImportBatchOut:
    rows = db.execute(select(ImportItem.status, func.count()).where(ImportItem.batch_id == batch.id).group_by(ImportItem.status)).all()
    progress = ImportProgress(**{status: count for status, count in rows})
    failures = db.execute(select(ImportItem.position, ImportItem.status, ImportItem.error_code).where(ImportItem.batch_id == batch.id, ImportItem.status.in_(("failed", "duplicate"))).order_by(ImportItem.position)).all()
    return ImportBatchOut(
        id=batch.id, job_id=batch.job_offer_id, file_count=batch.file_count, uploaded=sum(count for _, count in rows), attested_at=batch.attested_at,
        attestation_version=batch.attestation_version, created_at=batch.created_at, expires_at=batch.created_at + matching.IMPORT_RETENTION, progress=progress,
        failures=[ImportFailure(position=position, status=status, error_code=code) for position, status, code in failures],
    )


@router.post("/jobs/{job_id}/imports", status_code=201, response_model=ImportBatchOut, summary="Start a bulk import (attestation required); files follow one by one")
def create_import(organization_id: uuid.UUID, job_id: uuid.UUID, body: ImportCreate, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> ImportBatchOut:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    enforce("import-batch", str(organization_id), IMPORT_BATCHES_PER_ORGANIZATION)
    limiter.hit("import-batch", str(organization_id))
    now = utcnow()
    batch = ImportBatch(organization_id=organization_id, job_offer_id=job.id, attested_by=user.id, attested_at=now, attestation_version=ATTESTATION_VERSION, file_count=body.file_count)
    db.add(batch)
    db.flush()
    db.refresh(batch)
    # Decision A2: the attestation is timestamped and audited.
    audit(db, settings, "import.attested", user.id, "import_batch", batch.id, file_count=body.file_count, attestation_version=ATTESTATION_VERSION)
    db.commit()
    return batch_out(db, batch)


@router.get("/jobs/{job_id}/imports", response_model=list[ImportBatchOut], summary="Import batches of an offer, with progress")
def list_imports(organization_id: uuid.UUID, job_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep) -> list[ImportBatchOut]:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    batches = db.scalars(select(ImportBatch).where(ImportBatch.job_offer_id == job.id).order_by(ImportBatch.created_at.desc())).all()
    return [batch_out(db, batch) for batch in batches]


@router.post("/imports/{batch_id}/files", status_code=202, response_model=ImportItemOut, summary="Queue one PDF of a batch (parsed by the worker)")
async def upload_import_file(
    organization_id: uuid.UUID, batch_id: uuid.UUID,
    file: Annotated[UploadFile, File(description="PDF CV, at most 5 MiB and 10 pages. Stored encrypted until parsed.")],
    user: User = Recruiter, master: bytes = MasterKey, db: Session = DbDep, settings: Settings = SettingsDep,
) -> ImportItemOut:
    member(db, user, organization_id)
    # The batch row is locked so that concurrent uploads get distinct positions.
    batch = db.scalar(select(ImportBatch).where(ImportBatch.id == batch_id, ImportBatch.organization_id == organization_id).with_for_update())
    if batch is None:
        raise api_error(404, "not_found", "Import batch not found.")
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()
    if not data:
        raise api_error(422, "empty_file", "The uploaded file is empty.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise api_error(413, "file_too_large", "PDF must not exceed 5 MiB.")
    if not data.startswith(b"%PDF-"):
        raise api_error(415, "invalid_file_type", "Upload a structurally valid PDF document.")
    position = (db.scalar(select(func.max(ImportItem.position)).where(ImportItem.batch_id == batch.id)) or 0) + 1
    if position > batch.file_count:
        raise api_error(409, "batch_full", "This batch already holds the number of files attested for it.")
    digest = hmac.new(settings.secret_key, b"import|" + organization_id.bytes + data, hashlib.sha256).digest()
    item = matching.queue_file(db, master, batch, position, data, digest)
    db.commit()
    return ImportItemOut(position=item.position, status=item.status)


# --- Review queue and imported profiles ------------------------------------


@router.get("/jobs/{job_id}/review-queue", response_model=list[ReviewItem], summary="Imported profiles to review before ranking (qualifications only)")
def review_queue(organization_id: uuid.UUID, job_id: uuid.UUID, user: User = Recruiter, master: bytes = MasterKey, db: Session = DbDep) -> list[ReviewItem]:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    rows = db.execute(review_queue_query(job.id).add_columns(ProfileRow, CVVersion).order_by(ImportItem.created_at, ImportItem.position)).all()
    result = []
    for item, profile, version in rows:
        try:
            parsed = store.read_parsed(master, version)
        except DecryptionFailed as error:
            raise unreadable(error) from error
        result.append(ReviewItem(
            profile_id=profile.id, batch_id=item.batch_id, position=item.position, page_count=version.page_count,
            qualifications=coverage.qualification_projection(parsed.candidate), warnings=parsed.parsing_metadata.warnings, expires_at=profile.expires_at,
        ))
    return result


@router.post("/profiles/{profile_id}/confirm", status_code=201, response_model=RankingEntry, summary="Confirm an imported profile: it enters the ranking once computed")
def confirm_imported(organization_id: uuid.UUID, profile_id: uuid.UUID, body: ConfirmImported, user: User = Recruiter, master: bytes = MasterKey, db: Session = DbDep, settings: Settings = SettingsDep) -> RankingEntry:
    member(db, user, organization_id)
    profile = org_imported(db, organization_id, profile_id)
    version = db.scalar(select(CVVersion).where(CVVersion.candidate_profile_id == profile.id).order_by(CVVersion.number.desc()).limit(1))
    item = db.scalar(select(ImportItem).where(ImportItem.candidate_profile_id == profile.id))
    if version is None or item is None or version.confirmed_at is not None:
        raise api_error(409, "already_reviewed", "This profile is not waiting for review.")
    job = db.get(JobOffer, db.get(ImportBatch, item.batch_id).job_offer_id)
    try:
        store.write_reviewed(master, version, store.read_parsed(master, version).candidate)
    except DecryptionFailed as error:
        raise unreadable(error) from error
    version.reviewed_at = version.confirmed_at = utcnow()
    match = matching.add_match(db, job, profile, version, "import")
    audit(db, settings, "import.profile_confirmed", user.id, "match", match.id)
    db.commit()
    return RankingEntry(match_id=match.id, alias=match.alias_number, source="import", counts=counts(match), identity_revealed=False)


@router.delete("/profiles/{profile_id}", status_code=204, summary="Delete an imported profile now (CV versions and keys included)")
def delete_imported(organization_id: uuid.UUID, profile_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    member(db, user, organization_id)
    profile = org_imported(db, organization_id, profile_id)
    audit(db, settings, "profile.deleted", user.id, "candidate_profile", profile.id, by="organization")
    db.delete(profile)
    db.commit()
    return Response(status_code=204)


@router.post("/profiles/{profile_id}/invitation", status_code=201, response_model=Invitation, summary="Create the candidate's link to claim or delete the profile (shown once)")
def create_invitation(organization_id: uuid.UUID, profile_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep, settings: Settings = SettingsDep) -> Invitation:
    member(db, user, organization_id)
    profile = org_imported(db, organization_id, profile_id)
    token, digest = new_token()
    profile.claim_token_hash = digest
    profile.claim_expires_at = profile.expires_at
    audit(db, settings, "profile.invitation_created", user.id, "candidate_profile", profile.id)
    db.commit()
    # Nothing is sent: the recruiter shares the link with the candidate themself.
    return Invitation(url=f"{settings.app_base_url}/claim?token={token}", expires_at=profile.claim_expires_at)


# --- Ranking and evidence --------------------------------------------------


@router.get("/jobs/{job_id}/ranking", response_model=Ranking, summary="Anonymous ranking by documentary coverage (lexicographic, ties grouped)")
def job_ranking(organization_id: uuid.UUID, job_id: uuid.UUID, user: User = Recruiter, db: Session = DbDep) -> Ranking:
    member(db, user, organization_id)
    job = org_job(db, organization_id, job_id)
    if job.criteria_confirmed_at is None:
        raise api_error(409, "criteria_review_required", "Confirm the offer's criteria before reading its ranking.")
    rows = db.scalars(matching.visible_matches(organization_id).where(Match.job_offer_id == job.id)).all()
    current = [row for row in rows if row.status == "current"]
    groups = ranking.rank([
        ranking.Ranked(key=ranking.CoverageKey(row.required_documented, row.preferred_documented, row.needs_review_count), arrived_at=row.created_at, tie_breaker=str(row.id), item=row)
        for row in current
    ])
    _, _, to_review = counts_of(job, db)
    return Ranking(
        job_id=job.id, pending=len(rows) - len(current), to_review=to_review,
        groups=[RankingGroup(
            required_documented=group.key.required_documented, preferred_documented=group.key.preferred_documented, needs_review=group.key.needs_review,
            entries=[RankingEntry(match_id=entry.item.id, alias=entry.item.alias_number, source=entry.item.source, counts=counts(entry.item), identity_revealed=entry.item.identity_revealed_at is not None) for entry in group.entries],
        ) for group in groups],
    )


def identity_of(master: bytes, db: Session, match: Match) -> Identity:
    version = db.get(CVVersion, match.cv_version_id)
    profile = store.current_profile(master, version)
    return Identity(full_name=profile.full_name, email=profile.email, phone=profile.phone, linkedin_url=str(profile.linkedin_url) if profile.linkedin_url else None, github_url=str(profile.github_url) if profile.github_url else None)


def match_detail(db: Session, master: bytes, match: Match) -> MatchDetail:
    if match.status != "current":
        raise api_error(409, "match_pending", "This comparison is still being computed.")
    try:
        comparison = matching.read_comparison(db, master, match)
        identity = identity_of(master, db, match) if match.identity_revealed_at else None
    except DecryptionFailed as error:
        raise unreadable(error) from error
    job = db.get(JobOffer, match.job_offer_id)
    profile = db.get(ProfileRow, match.candidate_profile_id)
    return MatchDetail(
        match_id=match.id, job_id=job.id, alias=match.alias_number, source=match.source, counts=counts(match), comparisons=comparison.comparisons,
        technical_evidence=comparison.technical_evidence, job_source_text=job.source_text, imported_profile_id=profile.id if profile.origin == "imported" else None,
        identity_revealed_at=match.identity_revealed_at, reveal_reason=match.reveal_reason, identity=identity,
    )


@router.get("/matches/{match_id}", response_model=MatchDetail, summary="Evidence of one ranked match (anonymous unless revealed)")
def get_match(organization_id: uuid.UUID, match_id: uuid.UUID, user: User = Recruiter, master: bytes = MasterKey, db: Session = DbDep) -> MatchDetail:
    member(db, user, organization_id)
    return match_detail(db, master, org_match(db, organization_id, match_id))


@router.post("/matches/{match_id}/reveal", response_model=MatchDetail, summary="Reveal one candidate's identity, with a reason (audited)")
def reveal_identity(organization_id: uuid.UUID, match_id: uuid.UUID, body: RevealRequest, user: User = Recruiter, master: bytes = MasterKey, db: Session = DbDep, settings: Settings = SettingsDep) -> MatchDetail:
    member(db, user, organization_id)
    match = org_match(db, organization_id, match_id)
    if match.status != "current":
        raise api_error(409, "match_pending", "This comparison is still being computed.")
    if match.identity_revealed_at is None:
        match.identity_revealed_at, match.revealed_by = utcnow(), user.id
    match.reveal_reason, match.reveal_note = body.reason, body.note
    # The audit entry keeps the reason code only: never the identity or the free-text note.
    audit(db, settings, "match.identity_revealed", user.id, "match", match.id, reason=body.reason)
    db.commit()
    return match_detail(db, master, match)
