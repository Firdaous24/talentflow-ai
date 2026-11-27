"""Relational model: accounts, sessions, consents, audit and minimal organizations
(phase 6), then the candidate space (phase 7): CV versions and private job targets.

Personal data is deleted for real (no soft delete). CV content is stored
encrypted only (`*_enc` columns, see app/storage/crypto.py), each version with
its own wrapped data key in `cv_data_keys`. The audit log stores a
pseudonymous actor reference (HMAC of the user id), so it survives account
deletion without identifying anyone. Enumerations are CHECK constraints on
text columns: they migrate and downgrade without PostgreSQL enum types.
"""

import os
import time
import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Identity,
    Index,
    LargeBinary,
    MetaData,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

ROLES = ("candidate", "recruiter", "admin")
SELF_SERVICE_ROLES = ("candidate", "recruiter")
LOCALES = ("fr", "en")
CONSENT_PURPOSES = ("processing", "recruiter_visibility", "model_assistance", "marketing")
TOKEN_PURPOSES = ("verify_email", "reset_password")
ORG_ROLES = ("owner", "member")
JOB_VISIBILITIES = ("private", "public")
JOB_STATUSES = ("draft", "open", "closed")
PROFILE_ORIGINS = ("self", "imported")
IMPORT_ITEM_STATUSES = ("queued", "parsing", "parsed", "failed", "duplicate")
MATCH_SOURCES = ("import", "application")
MATCH_STATUSES = ("pending", "current")
REVEAL_REASONS = ("interview_scheduled", "reference_check", "candidate_request", "other")

NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


def uuid7() -> uuid.UUID:
    """Time-ordered UUID version 7 (RFC 9562): 48-bit millisecond timestamp, then random bits."""
    value = (time.time_ns() // 1_000_000) << 80 | int.from_bytes(os.urandom(10), "big")
    value = (value & ~(0xF << 76)) | (0x7 << 76)
    value = (value & ~(0x3 << 62)) | (0x2 << 62)
    return uuid.UUID(int=value)


def utcnow() -> datetime:
    return datetime.now(UTC)


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


class Timestamped:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Timestamped, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(_in("role", ROLES), name="role"),
        CheckConstraint(_in("locale", LOCALES), name="locale"),
        CheckConstraint("email = lower(email)", name="email_normalized"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(16))
    locale: Mapped[str] = mapped_column(String(8), server_default="fr")
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=utcnow)

    sessions: Mapped[list["AuthSession"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    consents: Mapped[list["Consent"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    memberships: Mapped[list["Membership"]] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)
    candidate_profile: Mapped["CandidateProfile | None"] = relationship(back_populates="user", cascade="all, delete-orphan", passive_deletes=True)


class AuthSession(Timestamped, Base):
    """Server-side session. Only the SHA-256 of the cookie token is stored."""

    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    user: Mapped[User] = relationship(back_populates="sessions")


class EmailToken(Timestamped, Base):
    """Single-use e-mail verification or password reset token, stored hashed."""

    __tablename__ = "email_tokens"
    __table_args__ = (CheckConstraint(_in("purpose", TOKEN_PURPOSES), name="purpose"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(32))
    token_hash: Mapped[bytes] = mapped_column(LargeBinary(32), unique=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Consent(Base):
    """One row per grant; withdrawal closes the row. History stays versioned by policy."""

    __tablename__ = "consents"
    __table_args__ = (
        CheckConstraint(_in("purpose", CONSENT_PURPOSES), name="purpose"),
        CheckConstraint("withdrawn_at IS NULL OR withdrawn_at >= granted_at", name="withdrawal_after_grant"),
        # At most one active grant per purpose.
        Index("uq_consents_active_purpose", "user_id", "purpose", unique=True, postgresql_where="withdrawn_at IS NULL"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(32))
    policy_version: Mapped[str] = mapped_column(String(32))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="consents")


class Organization(Timestamped, Base):
    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    name: Mapped[str] = mapped_column(String(120))

    memberships: Mapped[list["Membership"]] = relationship(back_populates="organization", cascade="all, delete-orphan", passive_deletes=True)


class Membership(Timestamped, Base):
    __tablename__ = "memberships"
    __table_args__ = (CheckConstraint(_in("org_role", ORG_ROLES), name="org_role"),)

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), primary_key=True, index=True)
    org_role: Mapped[str] = mapped_column(String(16))

    user: Mapped[User] = relationship(back_populates="memberships")
    organization: Mapped[Organization] = relationship(back_populates="memberships")


class AuditLog(Base):
    """Append-only (enforced by a trigger); never holds CV content, e-mail or password."""

    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(BigInteger, Identity(always=True), primary_key=True)
    actor_ref: Mapped[str | None] = mapped_column(String(64), index=True)
    action: Mapped[str] = mapped_column(String(64))
    target_type: Mapped[str | None] = mapped_column(String(32))
    target_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)
    details: Mapped[dict] = mapped_column(JSONB, server_default="{}")
    at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class CandidateProfile(Timestamped, Base):
    """A candidate's own profile (`self`, phase 7), or a profile imported by an
    organization without a candidate account (`imported`, phase 8).

    An imported profile belongs to exactly one organization, expires 90 days
    after the import (decision A2) and can be claimed or deleted by the
    candidate through a single-use invitation link (only its hash is stored)."""

    __tablename__ = "candidate_profiles"
    __table_args__ = (
        CheckConstraint(_in("origin", PROFILE_ORIGINS), name="origin"),
        CheckConstraint(
            "(origin = 'self' AND user_id IS NOT NULL AND organization_id IS NULL AND expires_at IS NULL)"
            " OR (origin = 'imported' AND user_id IS NULL AND organization_id IS NOT NULL AND expires_at IS NOT NULL)",
            name="single_owner",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    origin: Mapped[str] = mapped_column(String(16), server_default="self", default="self")
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    claim_token_hash: Mapped[bytes | None] = mapped_column(LargeBinary(32), unique=True)
    claim_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=utcnow)

    user: Mapped[User | None] = relationship(back_populates="candidate_profile")
    versions: Mapped[list["CVVersion"]] = relationship(back_populates="profile", cascade="all, delete-orphan", passive_deletes=True, order_by="CVVersion.number")


class CVVersion(Timestamped, Base):
    """One uploaded CV. A new upload adds a version; it never overwrites an older one.

    Only ciphertext is stored: the extracted text, the parsing result and the
    reviewed profile. A confirmed version always has a reviewed profile."""

    __tablename__ = "cv_versions"
    __table_args__ = (
        UniqueConstraint("candidate_profile_id", "number"),
        CheckConstraint("number >= 1", name="number_positive"),
        CheckConstraint("confirmed_at IS NULL OR reviewed_enc IS NOT NULL", name="confirmed_after_review"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    candidate_profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    number: Mapped[int] = mapped_column()
    page_count: Mapped[int] = mapped_column(SmallInteger)
    extracted_text_enc: Mapped[bytes] = mapped_column(LargeBinary)
    parsed_enc: Mapped[bytes] = mapped_column(LargeBinary)
    reviewed_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    original_file_ref: Mapped[str | None] = mapped_column(String(64))

    profile: Mapped[CandidateProfile] = relationship(back_populates="versions")
    data_key: Mapped["CVDataKey"] = relationship(back_populates="version", cascade="all, delete-orphan", passive_deletes=True)


class CVDataKey(Base):
    """The version's data key, wrapped by the master key. Deleting it shreds the version."""

    __tablename__ = "cv_data_keys"

    cv_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cv_versions.id", ondelete="CASCADE"), primary_key=True)
    wrapped_key: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    version: Mapped[CVVersion] = relationship(back_populates="data_key")


class JobOffer(Timestamped, Base):
    """A job post with exactly one owner: a private target pasted by a candidate
    (`owner_user_id`, phase 7) or an organization's offer (`organization_id`,
    phase 8; `created_by` is kept only while the recruiter's account exists)."""

    __tablename__ = "job_offers"
    __table_args__ = (
        CheckConstraint(_in("visibility", JOB_VISIBILITIES), name="visibility"),
        CheckConstraint(_in("status", JOB_STATUSES), name="status"),
        CheckConstraint("(organization_id IS NULL) <> (owner_user_id IS NULL)", name="single_owner"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    visibility: Mapped[str] = mapped_column(String(16), server_default="private")
    status: Mapped[str] = mapped_column(String(16), server_default="draft")
    title: Mapped[str | None] = mapped_column(String(2000))
    source_text: Mapped[str] = mapped_column(Text)
    analysis: Mapped[dict] = mapped_column(JSONB)
    reviewed_requirements: Mapped[list | None] = mapped_column(JSONB)
    criteria_confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=utcnow)


class ImportBatch(Base):
    """A bulk import into one of an organization's offers (phase 8).

    The recruiter's attestation that the candidates were informed is mandatory,
    timestamped and audited (decision A2); without it no batch exists."""

    __tablename__ = "import_batches"
    __table_args__ = (CheckConstraint("file_count BETWEEN 1 AND 200", name="file_count"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    job_offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_offers.id", ondelete="CASCADE"), index=True)
    attested_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    attested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    attestation_version: Mapped[str] = mapped_column(String(32))
    file_count: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ImportItem(Base):
    """One file of a batch, and the PostgreSQL work queue the worker consumes
    with `FOR UPDATE SKIP LOCKED`. The PDF waits here encrypted (its own data
    key, wrapped by the master key) and both are erased once parsed or failed.
    `file_digest` is an HMAC of the file, used to flag duplicates per organization."""

    __tablename__ = "import_items"
    __table_args__ = (
        CheckConstraint(_in("status", IMPORT_ITEM_STATUSES), name="status"),
        UniqueConstraint("batch_id", "position"),
        Index("ix_import_items_queue", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    batch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("import_batches.id", ondelete="CASCADE"), index=True)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    position: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(String(16), server_default="queued", default="queued")
    error_code: Mapped[str | None] = mapped_column(String(64))
    file_digest: Mapped[bytes] = mapped_column(LargeBinary(32))
    pdf_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    wrapped_key: Mapped[bytes | None] = mapped_column(LargeBinary)
    candidate_profile_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    attempts: Mapped[int] = mapped_column(SmallInteger, server_default="0", default=0)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Match(Base):
    """A confirmed CV version compared with an organization's offer.

    The comparison holds CV excerpts, so it is stored encrypted with the
    version's data key. Only verifiable counts are kept in clear: the ranking
    sorts on them lexicographically and nothing else (design §3.3). `alias_number`
    gives the stable anonymous label; identity is revealed per match, with a
    reason, and audited."""

    __tablename__ = "matches"
    __table_args__ = (
        CheckConstraint(_in("source", MATCH_SOURCES), name="source"),
        CheckConstraint(_in("status", MATCH_STATUSES), name="status"),
        CheckConstraint("reveal_reason IS NULL OR " + _in("reveal_reason", REVEAL_REASONS), name="reveal_reason"),
        CheckConstraint("status = 'pending' OR (comparison_enc IS NOT NULL AND required_total IS NOT NULL)", name="current_has_counts"),
        UniqueConstraint("job_offer_id", "candidate_profile_id"),
        UniqueConstraint("job_offer_id", "alias_number"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid7)
    organization_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("organizations.id", ondelete="CASCADE"), index=True)
    job_offer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("job_offers.id", ondelete="CASCADE"), index=True)
    candidate_profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    cv_version_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cv_versions.id", ondelete="CASCADE"), index=True)
    source: Mapped[str] = mapped_column(String(16))
    alias_number: Mapped[int] = mapped_column()
    status: Mapped[str] = mapped_column(String(16), server_default="pending", default="pending")
    comparison_enc: Mapped[bytes | None] = mapped_column(LargeBinary)
    required_documented: Mapped[int | None] = mapped_column()
    required_total: Mapped[int | None] = mapped_column()
    preferred_documented: Mapped[int | None] = mapped_column()
    preferred_total: Mapped[int | None] = mapped_column()
    needs_review_count: Mapped[int | None] = mapped_column()
    computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    identity_revealed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revealed_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    reveal_reason: Mapped[str | None] = mapped_column(String(32))
    reveal_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
