"""Candidate space (phase 7): versioned encrypted CVs, review, private job targets,
documentary coverage and honest gaps.

Rules carried over from the demo, now enforced on stored data:
- a new upload adds a version and never overwrites an older one;
- only the current (latest) version can be reviewed or confirmed;
- coverage needs both reviews: the current CV version confirmed and the
  target's criteria confirmed; any edit clears the matching confirmation;
- the comparison is `compare_job`, on the qualification-only projection;
- every query is filtered by the caller's own profile: another candidate's
  identifier answers 404, exactly like an unknown one.
"""

import base64
import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.v2.auth import enforce
from app.api.v2.deps import DbDep, SettingsDep, api_error, audit, current_user, require_role
from app.api.v2.schemas import (
    CandidateOverview,
    CoverageReport,
    CVConfirmRequest,
    CVDiff,
    CVReviewRequest,
    CVVersionDetail,
    CVVersionSummary,
    GapReport,
    RequirementsUpdate,
    TargetDetail,
    TargetSummary,
    VersionReference,
)
from app.auth.ratelimit import CV_UPLOADS_PER_ACCOUNT, JOB_ANALYSES_PER_ACCOUNT, limiter
from app.core.config import Settings
from app.db.models import CandidateProfile as ProfileRow
from app.db.models import Consent, CVVersion, JobOffer, Membership, User, utcnow
from app.models.job import (
    JobAnalysisResponse,
    JobAnalyzeRequest,
    JobComparisonRequest,
    JobComparisonResponse,
    JobReviewAssertion,
    QualificationProfile,
    ReviewedRequirement,
)
from app.services import coverage
from app.services.extraction import DeterministicCandidateExtractor
from app.services.jobs import DeterministicJobAnalyzer, JobWorkflowError, compare_job, validate_review
from app.services.pdf import MAX_UPLOAD_BYTES, CVParsingError, extract_pdf
from app.storage import cv as store
from app.storage import files
from app.storage.crypto import DecryptionFailed, EncryptionNotConfigured, master_key

router = APIRouter(prefix="/me", tags=["Candidate space"])
overview_router = APIRouter(tags=["Spaces"])
Candidate = Depends(require_role("candidate"))
MAX_CV_VERSIONS = 20
MAX_TARGETS = 50


def master_key_dependency() -> bytes:
    try:
        return master_key()
    except EncryptionNotConfigured as error:
        raise api_error(503, "encryption_not_configured", "Encrypted CV storage is not configured on this server.") from error


MasterKey = Depends(master_key_dependency)


def unreadable(error: DecryptionFailed):
    return api_error(503, "cv_unreadable", "This CV cannot be decrypted with the server's current key.")


def own_profile(db: Session, user: User, create: bool = False) -> ProfileRow | None:
    profile = db.scalar(select(ProfileRow).where(ProfileRow.user_id == user.id))
    if profile is None and create:
        profile = ProfileRow(user_id=user.id)
        db.add(profile)
        db.flush()
    return profile


def latest_version(db: Session, profile: ProfileRow | None) -> CVVersion | None:
    if profile is None:
        return None
    return db.scalar(select(CVVersion).where(CVVersion.candidate_profile_id == profile.id).order_by(CVVersion.number.desc()).limit(1))


def own_version(db: Session, user: User, version_id: uuid.UUID) -> CVVersion:
    version = db.scalar(select(CVVersion).join(ProfileRow).where(CVVersion.id == version_id, ProfileRow.user_id == user.id))
    if version is None:
        raise api_error(404, "not_found", "CV version not found.")
    return version


def own_target(db: Session, user: User, target_id: uuid.UUID) -> JobOffer:
    target = db.scalar(select(JobOffer).where(JobOffer.id == target_id, JobOffer.owner_user_id == user.id))
    if target is None:
        raise api_error(404, "not_found", "Job post not found.")
    return target


def version_status(version: CVVersion) -> str:
    return "confirmed" if version.confirmed_at else "reviewed" if version.reviewed_enc is not None else "to_review"


def summary(version: CVVersion, latest_number: int) -> CVVersionSummary:
    return CVVersionSummary(
        id=version.id, number=version.number, created_at=version.created_at, page_count=version.page_count, status=version_status(version),
        reviewed_at=version.reviewed_at, confirmed_at=version.confirmed_at, has_original=version.original_file_ref is not None, current=version.number == latest_number,
    )


def detail(db: Session, master: bytes, version: CVVersion) -> CVVersionDetail:
    latest = latest_version(db, version.profile)
    try:
        parsed, reviewed = store.read_parsed(master, version), store.read_reviewed(master, version)
    except DecryptionFailed as error:
        raise unreadable(error) from error
    return CVVersionDetail(**summary(version, latest.number if latest else version.number).model_dump(), parsed=parsed, reviewed_profile=reviewed)


def require_current(db: Session, version: CVVersion) -> None:
    latest = latest_version(db, version.profile)
    if latest is None or latest.id != version.id:
        raise api_error(409, "version_superseded", "A newer CV version exists. Older versions stay readable but can no longer be reviewed.")


def target_requirements(target: JobOffer) -> list[ReviewedRequirement]:
    if target.reviewed_requirements is not None:
        return [ReviewedRequirement.model_validate(item) for item in target.reviewed_requirements]
    analysis = JobAnalysisResponse.model_validate(target.analysis)
    return [ReviewedRequirement(id=item.id, text=item.text, category=item.category, classification=item.classification) for item in analysis.requirements]


def target_summary(target: JobOffer) -> TargetSummary:
    return TargetSummary(id=target.id, title=target.title, created_at=target.created_at, requirement_count=len(target_requirements(target)), criteria_confirmed_at=target.criteria_confirmed_at)


def target_detail(target: JobOffer) -> TargetDetail:
    return TargetDetail(
        **target_summary(target).model_dump(), source_text=target.source_text, analysis=JobAnalysisResponse.model_validate(target.analysis),
        requirements=target_requirements(target), requirements_reviewed=target.reviewed_requirements is not None,
    )


def review_request(analysis: JobAnalysisResponse, requirements: list[ReviewedRequirement], candidate: QualificationProfile) -> JobComparisonRequest:
    return JobComparisonRequest(
        candidate=candidate, job_analysis=analysis, requirements=requirements,
        review=JobReviewAssertion(candidate_confirmed=True, candidate_snapshot=candidate, requirements_reviewed=True, requirement_snapshot=requirements),
    )


# --- CV versions -----------------------------------------------------------


@router.post("/cv", status_code=201, response_model=CVVersionDetail, summary="Upload a new CV version (PDF); older versions are kept")
async def upload_cv(
    file: Annotated[UploadFile, File(description="PDF CV, at most 5 MiB and 10 pages. No OCR.")],
    keep_original: Annotated[bool, Form(description="Also keep the encrypted original PDF (only if the server enables it).")] = False,
    user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep, settings: Settings = SettingsDep,
) -> CVVersionDetail:
    try:
        if keep_original and not files.original_storage_enabled():
            raise api_error(409, "original_storage_disabled", "Keeping the original PDF is disabled on this server. Only the encrypted text is stored.")
    except files.OriginalStorageUnavailable as error:
        raise api_error(503, "service_not_configured", "Original PDF storage is misconfigured on this server.") from error
    enforce("cv-upload", str(user.id), CV_UPLOADS_PER_ACCOUNT)
    limiter.hit("cv-upload", str(user.id))
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        document = await run_in_threadpool(extract_pdf, data)
        parsed = await run_in_threadpool(DeterministicCandidateExtractor().extract, document)
    except CVParsingError as error:
        raise api_error(error.status_code, error.code, error.message) from error
    finally:
        await file.close()
    profile = own_profile(db, user, create=True)
    count = db.scalar(select(func.count()).select_from(CVVersion).where(CVVersion.candidate_profile_id == profile.id)) or 0
    if count >= MAX_CV_VERSIONS:
        raise api_error(409, "version_limit", f"A profile keeps at most {MAX_CV_VERSIONS} versions. Delete the account data to start again.")
    latest = latest_version(db, profile)
    version = store.create_version(db, master, profile, (latest.number if latest else 0) + 1, document.text, parsed, data if keep_original else None)
    audit(db, settings, "cv.version_created", user.id, "cv_version", version.id, number=version.number, original_kept=keep_original)
    db.commit()
    db.refresh(version)
    return detail(db, master, version)


@router.get("/cv/versions", response_model=list[CVVersionSummary], summary="CV version history, newest first")
def list_versions(user: User = Candidate, db: Session = DbDep) -> list[CVVersionSummary]:
    profile = own_profile(db, user)
    if profile is None:
        return []
    versions = db.scalars(select(CVVersion).where(CVVersion.candidate_profile_id == profile.id).order_by(CVVersion.number.desc())).all()
    return [summary(version, versions[0].number) for version in versions]


@router.get("/cv/versions/{version_id}", response_model=CVVersionDetail, summary="One of my CV versions")
def get_version(version_id: uuid.UUID, user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep) -> CVVersionDetail:
    return detail(db, master, own_version(db, user, version_id))


@router.get("/cv/versions/{version_id}/original", summary="Download the original PDF, when it was kept", response_class=Response, responses={200: {"content": {"application/pdf": {}}}})
def get_original(version_id: uuid.UUID, user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep) -> Response:
    version = own_version(db, user, version_id)
    try:
        data = store.read_original(master, version)
    except (DecryptionFailed, FileNotFoundError) as error:
        raise unreadable(error) from error
    if data is None:
        raise api_error(404, "not_found", "No original PDF was kept for this version.")
    return Response(data, media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="cv-version-{version.number}.pdf"'})


@router.put("/cv/versions/{version_id}/review", response_model=CVVersionDetail, summary="Save my reviewed profile (clears the confirmation)")
def review_version(body: CVReviewRequest, version_id: uuid.UUID, user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep) -> CVVersionDetail:
    version = own_version(db, user, version_id)
    require_current(db, version)
    try:
        store.write_reviewed(master, version, body.profile)
    except DecryptionFailed as error:
        raise unreadable(error) from error
    version.reviewed_at = utcnow()
    version.confirmed_at = None
    db.commit()
    return detail(db, master, version)


@router.post("/cv/versions/{version_id}/confirm", response_model=CVVersionDetail, summary="Confirm the reviewed profile of the current version")
def confirm_version(body: CVConfirmRequest, version_id: uuid.UUID, user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep, settings: Settings = SettingsDep) -> CVVersionDetail:
    version = own_version(db, user, version_id)
    require_current(db, version)
    try:
        if version.reviewed_enc is None:
            # Confirming without edits keeps the extraction as the reviewed profile.
            store.write_reviewed(master, version, store.read_parsed(master, version).candidate)
            version.reviewed_at = utcnow()
    except DecryptionFailed as error:
        raise unreadable(error) from error
    version.confirmed_at = utcnow()
    audit(db, settings, "cv.version_confirmed", user.id, "cv_version", version.id, number=version.number)
    db.commit()
    return detail(db, master, version)


@router.get("/cv/diff", response_model=CVDiff, summary="What changed between two of my CV versions")
def diff_versions(
    from_version: Annotated[uuid.UUID, Query(alias="from")], to_version: Annotated[uuid.UUID, Query(alias="to")],
    user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep,
) -> CVDiff:
    old, new = own_version(db, user, from_version), own_version(db, user, to_version)
    try:
        fields, sections = coverage.profile_diff(store.current_profile(master, old), store.current_profile(master, new))
    except DecryptionFailed as error:
        raise unreadable(error) from error
    return CVDiff(from_version=VersionReference(id=old.id, number=old.number), to_version=VersionReference(id=new.id, number=new.number), fields=fields, sections=sections)


# --- Job targets -----------------------------------------------------------


@router.post("/targets", status_code=201, response_model=TargetDetail, summary="Paste a job post: analyzed, private to me")
async def create_target(body: JobAnalyzeRequest, user: User = Candidate, db: Session = DbDep) -> TargetDetail:
    count = db.scalar(select(func.count()).select_from(JobOffer).where(JobOffer.owner_user_id == user.id)) or 0
    if count >= MAX_TARGETS:
        raise api_error(409, "target_limit", f"Keep at most {MAX_TARGETS} job posts. Delete one to add another.")
    enforce("job-analysis", str(user.id), JOB_ANALYSES_PER_ACCOUNT)
    limiter.hit("job-analysis", str(user.id))
    analysis = await run_in_threadpool(DeterministicJobAnalyzer().analyze, body.text)
    target = JobOffer(owner_user_id=user.id, visibility="private", status="draft", title=analysis.job.title, source_text=body.text, analysis=analysis.model_dump(mode="json"))
    db.add(target)
    db.commit()
    db.refresh(target)
    return target_detail(target)


@router.get("/targets", response_model=list[TargetSummary], summary="My job posts")
def list_targets(user: User = Candidate, db: Session = DbDep) -> list[TargetSummary]:
    rows = db.scalars(select(JobOffer).where(JobOffer.owner_user_id == user.id).order_by(JobOffer.created_at.desc(), JobOffer.id.desc())).all()
    return [target_summary(row) for row in rows]


@router.get("/targets/{target_id}", response_model=TargetDetail, summary="One of my job posts")
def get_target(target_id: uuid.UUID, user: User = Candidate, db: Session = DbDep) -> TargetDetail:
    return target_detail(own_target(db, user, target_id))


@router.put("/targets/{target_id}/requirements", response_model=TargetDetail, summary="Save reviewed criteria (clears the confirmation)")
def review_requirements(body: RequirementsUpdate, target_id: uuid.UUID, user: User = Candidate, db: Session = DbDep) -> TargetDetail:
    target = own_target(db, user, target_id)
    analysis = JobAnalysisResponse.model_validate(target.analysis)
    try:
        # Same correction rules as the demo: labels stay supported by the exact source.
        validate_review(review_request(analysis, body.requirements, QualificationProfile()), DeterministicJobAnalyzer())
    except JobWorkflowError as error:
        status = 409 if error.code == "source_mismatch" else 422
        raise api_error(status, "analysis_outdated" if status == 409 else error.code, error.message) from error
    target.reviewed_requirements = [item.model_dump(mode="json") for item in body.requirements]
    target.criteria_confirmed_at = None
    db.commit()
    return target_detail(target)


@router.post("/targets/{target_id}/confirm", response_model=TargetDetail, summary="Confirm the reviewed criteria")
def confirm_requirements(target_id: uuid.UUID, user: User = Candidate, db: Session = DbDep) -> TargetDetail:
    target = own_target(db, user, target_id)
    requirements = target_requirements(target)
    if not requirements:
        raise api_error(409, "no_requirements", "No criterion was found in this job post. Paste a post with explicit requirements.")
    target.reviewed_requirements = [item.model_dump(mode="json") for item in requirements]
    target.criteria_confirmed_at = utcnow()
    db.commit()
    return target_detail(target)


@router.delete("/targets/{target_id}", status_code=204, summary="Delete one of my job posts")
def delete_target(target_id: uuid.UUID, user: User = Candidate, db: Session = DbDep) -> Response:
    db.delete(own_target(db, user, target_id))
    db.commit()
    return Response(status_code=204)


def compare(db: Session, master: bytes, user: User, target: JobOffer) -> tuple[CVVersion, JobComparisonResponse]:
    version = latest_version(db, own_profile(db, user))
    if version is None:
        raise api_error(409, "cv_missing", "Upload a CV first.")
    if version.confirmed_at is None:
        raise api_error(409, "cv_review_required", "Review and confirm your current CV version first.")
    if target.criteria_confirmed_at is None:
        raise api_error(409, "criteria_review_required", "Review and confirm this job post's criteria first.")
    try:
        profile = store.read_reviewed(master, version)
    except DecryptionFailed as error:
        raise unreadable(error) from error
    try:
        candidate = coverage.qualification_projection(profile)
        result = compare_job(review_request(JobAnalysisResponse.model_validate(target.analysis), target_requirements(target), candidate), DeterministicJobAnalyzer())
    except JobWorkflowError as error:
        raise api_error(409, "analysis_outdated", "The job analysis changed since this post was added. Paste it again to compare.") from error
    return version, result


@router.get("/targets/{target_id}/coverage", response_model=CoverageReport, summary="Documentary coverage of a job post by my confirmed CV")
def target_coverage(target_id: uuid.UUID, user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep) -> CoverageReport:
    target = own_target(db, user, target_id)
    version, result = compare(db, master, user, target)
    return CoverageReport(
        target_id=target.id, cv_version=VersionReference(id=version.id, number=version.number), counts=coverage.coverage_counts(result.comparisons),
        comparisons=result.comparisons, technical_evidence=result.technical_evidence, warnings=result.warnings,
    )


@router.get("/targets/{target_id}/gaps", response_model=GapReport, summary="Criteria my CV does not document, or that need interpretation")
def target_gaps(target_id: uuid.UUID, user: User = Candidate, master: bytes = MasterKey, db: Session = DbDep) -> GapReport:
    target = own_target(db, user, target_id)
    version, result = compare(db, master, user, target)
    return GapReport(target_id=target.id, cv_version=VersionReference(id=version.id, number=version.number), gaps=coverage.gaps(result.comparisons))


# --- Overview and export ---------------------------------------------------


@overview_router.get("/candidate/overview", response_model=CandidateOverview, summary="Candidate space overview (candidates)")
def candidate_overview(user: User = Candidate, db: Session = DbDep) -> CandidateOverview:
    visible = db.scalar(select(Consent.id).where(Consent.user_id == user.id, Consent.purpose == "recruiter_visibility", Consent.withdrawn_at.is_(None))) is not None
    profile = own_profile(db, user)
    latest = latest_version(db, profile)
    count = db.scalar(select(func.count()).select_from(CVVersion).where(CVVersion.candidate_profile_id == profile.id)) if profile else 0
    targets = db.scalars(select(JobOffer).where(JobOffer.owner_user_id == user.id)).all()
    confirmed = sum(1 for target in targets if target.criteria_confirmed_at)
    if latest is None:
        step = "upload_cv"
    elif latest.confirmed_at is None:
        step = "review_cv"
    elif not targets:
        step = "add_target"
    elif not confirmed:
        step = "review_criteria"
    else:
        step = "view_coverage"
    try:
        original = files.original_storage_enabled()
    except files.OriginalStorageUnavailable:
        original = False
    return CandidateOverview(
        cv_versions=count or 0, current_version=summary(latest, latest.number) if latest else None, targets=len(targets), confirmed_targets=confirmed,
        recruiter_visibility=visible, original_storage_available=original, next_step=step,
    )


def iso(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


@router.get("/export", summary="Download all my personal data (portable JSON)", response_class=JSONResponse)
def export_data(user: User = Depends(current_user), db: Session = DbDep, settings: Settings = SettingsDep) -> JSONResponse:
    profile = own_profile(db, user)
    versions = db.scalars(select(CVVersion).where(CVVersion.candidate_profile_id == profile.id).order_by(CVVersion.number)).all() if profile else []
    exported_versions = []
    if versions:
        master = master_key_dependency()
        for version in versions:
            try:
                original = store.read_original(master, version)
                exported_versions.append({
                    "number": version.number, "created_at": iso(version.created_at), "reviewed_at": iso(version.reviewed_at), "confirmed_at": iso(version.confirmed_at),
                    "page_count": version.page_count, "extracted_text": store.read_text(master, version),
                    "extraction": store.read_parsed(master, version).model_dump(mode="json"),
                    "reviewed_profile": (reviewed.model_dump(mode="json") if (reviewed := store.read_reviewed(master, version)) else None),
                    "original_pdf_base64": base64.b64encode(original).decode("ascii") if original else None,
                })
            except (DecryptionFailed, FileNotFoundError) as error:
                raise unreadable(error) from error
    targets = db.scalars(select(JobOffer).where(JobOffer.owner_user_id == user.id).order_by(JobOffer.created_at)).all()
    consents = db.scalars(select(Consent).where(Consent.user_id == user.id).order_by(Consent.granted_at, Consent.id)).all()
    memberships = db.scalars(select(Membership).where(Membership.user_id == user.id).order_by(Membership.created_at)).all()
    payload = {
        "format": "talentflow-export-v1",
        "exported_at": utcnow().isoformat(),
        "account": {
            "email": user.email, "role": user.role, "locale": user.locale, "created_at": iso(user.created_at),
            "email_verified_at": iso(user.email_verified_at), "last_active_at": iso(user.last_active_at),
        },
        "consents": [{"purpose": row.purpose, "policy_version": row.policy_version, "granted_at": iso(row.granted_at), "withdrawn_at": iso(row.withdrawn_at)} for row in consents],
        "organizations": [{"name": row.organization.name, "org_role": row.org_role, "joined_at": iso(row.created_at)} for row in memberships],
        "cv_versions": exported_versions,
        "job_posts": [{
            "title": row.title, "created_at": iso(row.created_at), "source_text": row.source_text, "analysis": row.analysis,
            "reviewed_requirements": row.reviewed_requirements, "criteria_confirmed_at": iso(row.criteria_confirmed_at),
        } for row in targets],
    }
    audit(db, settings, "account.exported", user.id, "user", user.id, cv_versions=len(exported_versions), job_posts=len(targets))
    db.commit()
    return JSONResponse(payload, headers={"Content-Disposition": 'attachment; filename="talentflow-export.json"'})


def stored_original_refs(db: Session, user: User) -> list[str]:
    return [ref for ref in db.scalars(select(CVVersion.original_file_ref).join(ProfileRow).where(ProfileRow.user_id == user.id, CVVersion.original_file_ref.is_not(None))).all() if ref]
