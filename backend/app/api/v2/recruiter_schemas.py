"""Contracts for the recruiter space (phase 8). Ranking and match payloads are
anonymous by construction: they have no field that could carry identity,
contact, place or dates. Identity exists only in `Identity`, returned after a
reasoned, audited reveal."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import BeforeValidator, Field

from app.api.v2.schemas import Schema, TargetDetail
from app.models.job import JobAnalyzeRequest, QualificationProfile, RequirementComparison, TechnicalEvidence

JobStatus = Literal["draft", "open", "closed"]
Visibility = Literal["private", "public"]
RevealReason = Literal["interview_scheduled", "reference_check", "candidate_request", "other"]
ATTESTATION_VERSION = "2026-11-27"
RANKING_NOTICE = "documentary_coverage_not_competence_decision_is_human"


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


class JobCreate(JobAnalyzeRequest):
    pass


class JobUpdate(Schema):
    status: JobStatus | None = None
    visibility: Visibility | None = None


class OrgJobSummary(Schema):
    id: uuid.UUID
    title: str | None
    created_at: datetime
    status: JobStatus
    visibility: Visibility
    requirement_count: int
    criteria_confirmed_at: datetime | None
    ranked: int
    pending: int
    to_review: int


class OrgJobDetail(TargetDetail):
    status: JobStatus
    visibility: Visibility


class ImportCreate(Schema):
    attestation: Literal[True] = Field(description="« Les candidats ont été informés du traitement de leur CV. » Required (decision A2).")
    file_count: int = Field(ge=1, le=200)


class ImportProgress(Schema):
    queued: int = 0
    parsing: int = 0
    parsed: int = 0
    failed: int = 0
    duplicate: int = 0


class ImportBatchOut(Schema):
    id: uuid.UUID
    job_id: uuid.UUID
    file_count: int
    uploaded: int
    attested_at: datetime
    attestation_version: str
    created_at: datetime
    expires_at: datetime
    progress: ImportProgress
    failures: list["ImportFailure"]


class ImportFailure(Schema):
    position: int
    status: Literal["failed", "duplicate"]
    error_code: str | None


class ImportItemOut(Schema):
    position: int
    status: Literal["queued", "parsing", "parsed", "failed", "duplicate"]


class ReviewItem(Schema):
    """An imported profile to review before it can be ranked: qualifications only."""

    profile_id: uuid.UUID
    batch_id: uuid.UUID
    position: int
    page_count: int
    qualifications: QualificationProfile
    warnings: list[str]
    expires_at: datetime


class ConfirmImported(Schema):
    warnings_acknowledged: Literal[True]


class Invitation(Schema):
    url: str
    expires_at: datetime


class Counts(Schema):
    required_documented: int
    required_total: int
    preferred_documented: int
    preferred_total: int
    needs_review: int


class RankingEntry(Schema):
    match_id: uuid.UUID
    alias: int
    source: Literal["import", "application"]
    counts: Counts
    identity_revealed: bool


class RankingGroup(Schema):
    required_documented: int
    preferred_documented: int
    needs_review: int
    tie_order: Literal["arrival_not_meaningful"] = "arrival_not_meaningful"
    entries: list[RankingEntry]


class Ranking(Schema):
    job_id: uuid.UUID
    notice: Literal["documentary_coverage_not_competence_decision_is_human"] = RANKING_NOTICE
    sort_key: Literal["required_documented_desc,preferred_documented_desc,needs_review_asc"] = "required_documented_desc,preferred_documented_desc,needs_review_asc"
    groups: list[RankingGroup]
    pending: int
    to_review: int


class Identity(Schema):
    full_name: str | None
    email: str | None
    phone: str | None
    linkedin_url: str | None
    github_url: str | None


class MatchDetail(Schema):
    match_id: uuid.UUID
    job_id: uuid.UUID
    alias: int
    source: Literal["import", "application"]
    counts: Counts
    comparisons: list[RequirementComparison]
    technical_evidence: list[TechnicalEvidence]
    job_source_text: str
    imported_profile_id: uuid.UUID | None
    identity_revealed_at: datetime | None
    reveal_reason: RevealReason | None
    identity: Identity | None


class RevealRequest(Schema):
    reason: RevealReason
    note: Annotated[str, BeforeValidator(_strip), Field(min_length=5, max_length=500)]


ImportBatchOut.model_rebuild()
