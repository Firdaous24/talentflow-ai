"""Applications from the candidate space and claim links for imported profiles (phase 8).

- A candidate applies to an organization's open, public offer with their current
  confirmed CV. The organization sees the application only while the candidate's
  `recruiter_visibility` consent is active (the rule lives in storage.matching).
- The holder of a claim link (single use, only its hash is stored, valid until the
  profile's 90-day expiry) can delete the imported profile at once, without an
  account, or claim it into their candidate account.
"""

import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.api.v2.candidate import latest_version, own_profile
from app.api.v2.deps import DbDep, SettingsDep, api_error, audit, require_role
from app.api.v2.schemas import Schema, TokenRequest
from app.auth.security import hash_token
from app.core.config import Settings
from app.db.models import CandidateProfile as ProfileRow
from app.db.models import Consent, CVVersion, ImportBatch, ImportItem, JobOffer, Match, Organization, User, utcnow
from app.storage import matching

router = APIRouter(tags=["Applications"])
Candidate = Depends(require_role("candidate"))


class PublicJob(Schema):
    id: uuid.UUID
    title: str | None
    organization: str
    requirement_count: int
    applied: bool


class ApplicationCreate(Schema):
    job_id: uuid.UUID


class Application(Schema):
    id: uuid.UUID
    job_id: uuid.UUID
    job_title: str | None
    organization: str
    created_at: str
    visible_to_recruiters: bool


class ClaimInfo(Schema):
    organization: str
    job_title: str | None
    expires_at: str


def has_visibility_consent(db: Session, user: User) -> bool:
    return db.scalar(select(Consent.id).where(Consent.user_id == user.id, Consent.purpose == "recruiter_visibility", Consent.withdrawn_at.is_(None))) is not None


def public_jobs_query():
    return select(JobOffer, Organization).join(Organization, JobOffer.organization_id == Organization.id).where(JobOffer.status == "open", JobOffer.visibility == "public", JobOffer.criteria_confirmed_at.is_not(None))


@router.get("/me/public-jobs", response_model=list[PublicJob], summary="Open public offers a candidate can apply to")
def public_jobs(user: User = Candidate, db: Session = DbDep) -> list[PublicJob]:
    profile = own_profile(db, user)
    applied = set(db.scalars(select(Match.job_offer_id).where(Match.candidate_profile_id == profile.id)).all()) if profile else set()
    rows = db.execute(public_jobs_query().order_by(JobOffer.created_at.desc()).limit(100)).all()
    return [PublicJob(id=job.id, title=job.title, organization=organization.name, requirement_count=len(matching.target_requirements(job)), applied=job.id in applied) for job, organization in rows]


def application_out(db: Session, match: Match, visible: bool) -> Application:
    job = db.get(JobOffer, match.job_offer_id)
    return Application(id=match.id, job_id=job.id, job_title=job.title, organization=db.get(Organization, job.organization_id).name, created_at=match.created_at.isoformat(), visible_to_recruiters=visible)


@router.post("/me/applications", status_code=201, response_model=Application, summary="Apply to a public offer with my confirmed CV")
def apply(body: ApplicationCreate, user: User = Candidate, db: Session = DbDep, settings: Settings = SettingsDep) -> Application:
    row = db.execute(public_jobs_query().where(JobOffer.id == body.job_id)).first()
    if row is None:
        raise api_error(404, "not_found", "Offer not found or not open.")
    job = row[0]
    if not has_visibility_consent(db, user):
        raise api_error(409, "consent_required", "Applying shares your profile with the organization: turn on “visible to recruiters” first.")
    profile = own_profile(db, user)
    version = latest_version(db, profile)
    if version is None or version.confirmed_at is None:
        raise api_error(409, "cv_review_required", "Review and confirm your current CV version first.")
    if db.scalar(select(Match.id).where(Match.job_offer_id == job.id, Match.candidate_profile_id == profile.id)) is not None:
        raise api_error(409, "already_applied", "You already applied to this offer.")
    match = matching.add_match(db, job, profile, version, "application")
    audit(db, settings, "application.created", user.id, "match", match.id)
    db.commit()
    return application_out(db, match, True)


@router.get("/me/applications", response_model=list[Application], summary="My applications")
def list_applications(user: User = Candidate, db: Session = DbDep) -> list[Application]:
    profile = own_profile(db, user)
    if profile is None:
        return []
    visible = has_visibility_consent(db, user)
    rows = db.scalars(select(Match).where(Match.candidate_profile_id == profile.id).order_by(Match.created_at.desc())).all()
    return [application_out(db, row, visible) for row in rows]


@router.delete("/me/applications/{application_id}", status_code=204, summary="Withdraw an application")
def withdraw(application_id: uuid.UUID, user: User = Candidate, db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    profile = own_profile(db, user)
    match = db.scalar(select(Match).where(Match.id == application_id, Match.candidate_profile_id == profile.id)) if profile else None
    if match is None:
        raise api_error(404, "not_found", "Application not found.")
    audit(db, settings, "application.withdrawn", user.id, "match", match.id)
    db.delete(match)
    db.commit()
    return Response(status_code=204)


# --- Claim links -----------------------------------------------------------


def claimed_profile(db: Session, token: str) -> ProfileRow:
    profile = db.scalar(select(ProfileRow).where(ProfileRow.claim_token_hash == hash_token(token), ProfileRow.origin == "imported"))
    now = utcnow()
    if profile is None or profile.claim_expires_at is None or profile.claim_expires_at <= now or profile.expires_at <= now:
        raise api_error(404, "invalid_token", "This link is invalid, expired or already used.")
    return profile


@router.post("/claims/inspect", response_model=ClaimInfo, summary="What a claim link is about (public)")
def inspect_claim(body: TokenRequest, db: Session = DbDep) -> ClaimInfo:
    profile = claimed_profile(db, body.token)
    item = db.scalar(select(ImportItem).where(ImportItem.candidate_profile_id == profile.id))
    job = db.get(JobOffer, db.get(ImportBatch, item.batch_id).job_offer_id) if item else None
    return ClaimInfo(organization=db.get(Organization, profile.organization_id).name, job_title=job.title if job else None, expires_at=profile.expires_at.isoformat())


@router.post("/claims/delete", status_code=204, summary="Delete my imported profile now, with the link alone (public)")
def delete_by_claim(body: TokenRequest, db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    profile = claimed_profile(db, body.token)
    audit(db, settings, "profile.deleted", None, "candidate_profile", profile.id, by="candidate_link")
    db.delete(profile)
    db.commit()
    return Response(status_code=204)


@router.post("/claims/accept", status_code=204, summary="Move an imported profile into my candidate account")
def accept_claim(body: TokenRequest, user: User = Candidate, db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    imported = claimed_profile(db, body.token)
    own = own_profile(db, user, create=True)
    offset = db.scalar(select(func.max(CVVersion.number)).where(CVVersion.candidate_profile_id == own.id)) or 0
    # The versions keep their identifiers, so their data keys still open them. The
    # recruiter's confirmation does not count for the candidate: they review it themself.
    db.execute(update(CVVersion).where(CVVersion.candidate_profile_id == imported.id).values(candidate_profile_id=own.id, number=CVVersion.number + offset, confirmed_at=None))
    already = select(Match.job_offer_id).where(Match.candidate_profile_id == own.id).scalar_subquery()
    db.execute(delete(Match).where(Match.candidate_profile_id == imported.id, Match.job_offer_id.in_(already)))
    db.execute(update(Match).where(Match.candidate_profile_id == imported.id).values(candidate_profile_id=own.id))
    db.execute(update(ImportItem).where(ImportItem.candidate_profile_id == imported.id).values(candidate_profile_id=None))
    db.execute(delete(ProfileRow).where(ProfileRow.id == imported.id))
    audit(db, settings, "profile.claimed", user.id, "candidate_profile", own.id)
    db.commit()
    return Response(status_code=204)
