"""Signed-in account management: language, consents and complete deletion."""

from fastapi import APIRouter, Depends, Path, Response
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.v2.auth import account_payload, enforce
from app.api.v2.deps import PRIVACY_POLICY_VERSION, DbDep, SettingsDep, api_error, audit, current_session, current_user
from app.api.v2.schemas import (
    Account,
    ConsentRecord,
    Consents,
    ConsentState,
    ConsentUpdate,
    DeleteAccountRequest,
    EditablePurpose,
    UpdateAccountRequest,
)
from app.auth.ratelimit import LOGIN_FAILURES_PER_ACCOUNT, limiter
from app.auth.security import verify_password
from app.core.config import Settings
from app.db.models import CONSENT_PURPOSES, AuthSession, Consent, Membership, Organization, User, utcnow

router = APIRouter(prefix="/me", tags=["Accounts"])


@router.patch("", response_model=Account, summary="Update account preferences")
def update_account(body: UpdateAccountRequest, user: User = Depends(current_user), db: Session = DbDep) -> Account:
    user.locale = body.locale
    db.commit()
    return account_payload(user)


@router.delete("", status_code=204, summary="Delete the account and its personal data")
def delete_account(body: DeleteAccountRequest, auth_session: AuthSession = Depends(current_session), db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    user = auth_session.user
    enforce("login-account", user.email, LOGIN_FAILURES_PER_ACCOUNT)
    valid, _ = verify_password(user.password_hash, body.password)
    if not valid:
        limiter.hit("login-account", user.email)
        raise api_error(403, "reauthentication_failed", "The password is incorrect. The account was not deleted.")
    for membership in list(user.memberships):
        others = db.scalars(select(Membership).where(Membership.organization_id == membership.organization_id, Membership.user_id != user.id).order_by(Membership.created_at)).all()
        if not others:
            # Nobody else can administer it: the organization goes with its last member.
            audit(db, settings, "organization.deleted", user.id, "organization", membership.organization_id, reason="last_member_deleted")
            db.delete(db.get(Organization, membership.organization_id))
        elif membership.org_role == "owner" and not any(item.org_role == "owner" for item in others):
            others[0].org_role = "owner"
    audit(db, settings, "account.deleted", user.id, "user", user.id, role=user.role)
    db.delete(user)  # Sessions, tokens, consents and memberships cascade in the database.
    db.commit()
    limiter.reset("login-account", user.email)
    response = Response(status_code=204)
    response.delete_cookie(settings.session_cookie, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")
    return response


def consent_payload(db: Session, user: User) -> Consents:
    rows = db.scalars(select(Consent).where(Consent.user_id == user.id).order_by(Consent.granted_at, Consent.id)).all()
    active = {row.purpose: row for row in rows if row.withdrawn_at is None}
    return Consents(
        current_policy_version=PRIVACY_POLICY_VERSION,
        consents=[ConsentState(purpose=purpose, granted=purpose in active, policy_version=active[purpose].policy_version if purpose in active else None, granted_at=active[purpose].granted_at if purpose in active else None) for purpose in CONSENT_PURPOSES],
        history=[ConsentRecord(purpose=row.purpose, policy_version=row.policy_version, granted_at=row.granted_at, withdrawn_at=row.withdrawn_at) for row in rows],
    )


@router.get("/consents", response_model=Consents, summary="Current consents and their versioned history")
def get_consents(user: User = Depends(current_user), db: Session = DbDep) -> Consents:
    return consent_payload(db, user)


@router.put("/consents/{purpose}", response_model=Consents, summary="Grant or withdraw one consent purpose")
def update_consent(body: ConsentUpdate, purpose: EditablePurpose = Path(), user: User = Depends(current_user), db: Session = DbDep, settings: Settings = SettingsDep) -> Consents:
    if purpose == "model_assistance":
        raise api_error(409, "consent_per_request", "Model assistance is consented to for each request, never in advance.")
    if purpose == "recruiter_visibility" and user.role != "candidate":
        raise api_error(403, "forbidden_role", "Only candidates can make their profile visible to recruiters.")
    if purpose == "processing" and not body.granted:
        raise api_error(409, "consent_required", "Processing is required for the account. Delete the account to withdraw it.")
    current = db.scalar(select(Consent).where(Consent.user_id == user.id, Consent.purpose == purpose, Consent.withdrawn_at.is_(None)).with_for_update())
    now = utcnow()
    if body.granted and (current is None or current.policy_version != PRIVACY_POLICY_VERSION):
        if current is not None:
            current.withdrawn_at = now
            db.flush()
        db.add(Consent(user_id=user.id, purpose=purpose, policy_version=PRIVACY_POLICY_VERSION, granted_at=now))
        audit(db, settings, "consent.granted", user.id, "user", user.id, purpose=purpose, policy_version=PRIVACY_POLICY_VERSION)
    elif not body.granted and current is not None:
        current.withdrawn_at = now
        audit(db, settings, "consent.withdrawn", user.id, "user", user.id, purpose=purpose, policy_version=current.policy_version)
    db.commit()
    return consent_payload(db, user)


def member_count(db: Session, organization_id) -> int:
    return db.scalar(select(func.count()).select_from(Membership).where(Membership.organization_id == organization_id)) or 0
