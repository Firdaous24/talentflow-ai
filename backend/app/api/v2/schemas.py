"""Request and response contracts for /api/v2 (extra fields are rejected)."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BeforeValidator, ConfigDict, Field

from app.models.candidate import CandidateProfile, CVParsingResponse
from app.models.candidate import Schema as BaseSchema
from app.models.job import JobAnalysisResponse, RequirementComparison, ReviewedRequirement, TechnicalEvidence
from app.services.coverage import CoverageCounts, FieldChange, Gap, SectionDiff


class Schema(BaseSchema):
    # Passwords must reach the hasher byte for byte: no implicit whitespace stripping here.
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False, validate_assignment=True)


def _normalize_email(value: str) -> str:
    return value.lower()


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


Email = Annotated[str, BeforeValidator(_strip), Field(min_length=3, max_length=254, pattern=r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"), AfterValidator(_normalize_email)]
# No composition rules (NIST SP 800-63B): a length floor and a ceiling that bounds argon2 work.
Password = Annotated[str, Field(min_length=12, max_length=128)]
Token = Annotated[str, Field(min_length=20, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]
Locale = Literal["fr", "en"]
SelfServiceRole = Literal["candidate", "recruiter"]
EditablePurpose = Literal["processing", "recruiter_visibility", "model_assistance", "marketing"]


class RegisterRequest(Schema):
    email: Email
    password: Password
    role: SelfServiceRole
    locale: Locale = "fr"
    accept_terms: Literal[True] = Field(description="Terms, privacy notice and the required `processing` consent.")
    marketing: bool = False


class LoginRequest(Schema):
    email: Email
    password: Annotated[str, Field(min_length=1, max_length=128)]


class EmailRequest(Schema):
    email: Email


class TokenRequest(Schema):
    token: Token


class ResetPasswordRequest(Schema):
    token: Token
    password: Password


class DeleteAccountRequest(Schema):
    password: Annotated[str, Field(min_length=1, max_length=128)]


class UpdateAccountRequest(Schema):
    locale: Locale


class ConsentUpdate(Schema):
    granted: bool


class OrganizationCreate(Schema):
    name: Annotated[str, BeforeValidator(_strip), Field(min_length=2, max_length=120)]


class Accepted(Schema):
    status: Literal["accepted"] = "accepted"
    message: str


class CsrfResponse(Schema):
    csrf_token: str


class OrganizationSummary(Schema):
    id: uuid.UUID
    name: str
    org_role: Literal["owner", "member"]


class Account(Schema):
    id: uuid.UUID
    email: str
    role: Literal["candidate", "recruiter", "admin"]
    locale: Locale
    email_verified: bool
    created_at: datetime
    organizations: list[OrganizationSummary]


class LoginResponse(Schema):
    account: Account
    csrf_token: str


class ConsentState(Schema):
    purpose: EditablePurpose
    granted: bool
    policy_version: str | None
    granted_at: datetime | None


class ConsentRecord(Schema):
    purpose: EditablePurpose
    policy_version: str
    granted_at: datetime
    withdrawn_at: datetime | None


class Consents(Schema):
    current_policy_version: str
    consents: list[ConsentState]
    history: list[ConsentRecord]


class Member(Schema):
    email: str
    org_role: Literal["owner", "member"]
    joined_at: datetime


class Organization(Schema):
    id: uuid.UUID
    name: str
    created_at: datetime
    org_role: Literal["owner", "member"]
    member_count: int


# ---------------------------------------------------------------------------
# Candidate space (phase 7)
# ---------------------------------------------------------------------------

CVStatus = Literal["to_review", "reviewed", "confirmed"]
NextStep = Literal["upload_cv", "review_cv", "add_target", "review_criteria", "view_coverage"]


class CVVersionSummary(Schema):
    id: uuid.UUID
    number: int
    created_at: datetime
    page_count: int
    status: CVStatus
    reviewed_at: datetime | None
    confirmed_at: datetime | None
    has_original: bool
    current: bool


class CVVersionDetail(CVVersionSummary):
    """The owner's own version: original extraction (with warnings and evidence) and reviewed profile."""

    parsed: CVParsingResponse
    reviewed_profile: CandidateProfile | None


class CVReviewRequest(Schema):
    profile: CandidateProfile


class CVConfirmRequest(Schema):
    warnings_acknowledged: Literal[True] = Field(description="The candidate read the extraction warnings and checked the profile.")


class VersionReference(Schema):
    id: uuid.UUID
    number: int


class CVDiff(Schema):
    from_version: VersionReference
    to_version: VersionReference
    fields: list[FieldChange]
    sections: list[SectionDiff]


class TargetSummary(Schema):
    id: uuid.UUID
    title: str | None
    created_at: datetime
    requirement_count: int
    criteria_confirmed_at: datetime | None


class TargetDetail(TargetSummary):
    source_text: str
    analysis: JobAnalysisResponse
    requirements: list[ReviewedRequirement]
    requirements_reviewed: bool


class RequirementsUpdate(Schema):
    requirements: list[ReviewedRequirement] = Field(min_length=1, max_length=150)


class CoverageReport(Schema):
    """Documentary coverage of one target by the current confirmed CV. Not an assessment of ability."""

    target_id: uuid.UUID
    cv_version: VersionReference
    counts: CoverageCounts
    comparisons: list[RequirementComparison]
    technical_evidence: list[TechnicalEvidence]
    warnings: list[str]
    method: Literal["qualification-document-checklist-v1"] = "qualification-document-checklist-v1"
    notice: Literal["documentary_coverage_not_competence"] = "documentary_coverage_not_competence"


class GapReport(Schema):
    """Fixed message keys only: nothing is written or suggested in the candidate's place."""

    target_id: uuid.UUID
    cv_version: VersionReference
    gaps: list[Gap]


class CandidateOverview(Schema):
    cv_versions: int
    current_version: CVVersionSummary | None = None
    targets: int = 0
    confirmed_targets: int = 0
    recruiter_visibility: bool
    original_storage_available: bool = False
    next_step: NextStep
