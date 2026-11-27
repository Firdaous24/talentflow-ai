"""Request and response contracts for /api/v2 (extra fields are rejected)."""

import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BeforeValidator, ConfigDict, Field

from app.models.candidate import Schema as BaseSchema


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


class CandidateOverview(Schema):
    cv_versions: int
    recruiter_visibility: bool
    next_step: str
