"""Public authentication routes: registration, e-mail verification, sign-in, sign-out, password reset.

Anti-enumeration: registration, verification resend and password reset answer
202 with the same body whether or not the address exists; a failed sign-in
always answers `invalid_credentials` after one full argon2 verification.
"""

import secrets
from datetime import timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.v2.deps import (
    PRIVACY_POLICY_VERSION,
    SESSION_ABSOLUTE,
    DbDep,
    SettingsDep,
    api_error,
    audit,
    current_session,
    session_token,
)
from app.api.v2.schemas import (
    Accepted,
    Account,
    CsrfResponse,
    EmailRequest,
    LoginRequest,
    LoginResponse,
    OrganizationSummary,
    RegisterRequest,
    ResetPasswordRequest,
    TokenRequest,
)
from app.auth import mailer
from app.auth.ratelimit import (
    EMAILS_PER_ACCOUNT,
    LOGIN_ATTEMPTS_PER_CLIENT,
    LOGIN_FAILURES_PER_ACCOUNT,
    REGISTRATIONS_PER_CLIENT,
    Rule,
    limiter,
)
from app.auth.security import csrf_token, hash_password, hash_token, new_token, verify_password
from app.core.config import Settings
from app.db.models import AuthSession, Consent, EmailToken, User, utcnow

router = APIRouter(prefix="/auth", tags=["Accounts"])

VERIFY_TTL = timedelta(hours=24)
RESET_TTL = timedelta(minutes=30)
CSRF_SEED_BYTES = 32
REGISTER_MESSAGE = "If this address can be used, a confirmation e-mail has been sent."
RESEND_MESSAGE = "If this address belongs to an unverified account, a new confirmation e-mail has been sent."
FORGOT_MESSAGE = "If this address belongs to an account, a reset e-mail has been sent."


def client_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def enforce(scope: str, subject: str, rules: tuple[Rule, ...]) -> None:
    wait = limiter.retry_after(scope, subject, rules)
    if wait:
        raise api_error(429, "too_many_attempts", "Too many attempts. Try again later.", headers={"Retry-After": str(wait)})


def account_payload(user: User) -> Account:
    return Account(
        id=user.id, email=user.email, role=user.role, locale=user.locale, email_verified=user.email_verified_at is not None, created_at=user.created_at,
        organizations=[OrganizationSummary(id=item.organization.id, name=item.organization.name, org_role=item.org_role) for item in sorted(user.memberships, key=lambda item: item.created_at)],
    )


def set_cookie(response: Response, settings: Settings, name: str, value: str, max_age: int | None, same_site: str) -> None:
    response.set_cookie(name, value, max_age=max_age, path="/", secure=settings.cookie_secure, httponly=True, samesite=same_site)


def issue_email_token(db: Session, user: User, purpose: str, ttl: timedelta) -> str:
    token, digest = new_token()
    db.add(EmailToken(user_id=user.id, purpose=purpose, token_hash=digest, expires_at=utcnow() + ttl))
    return token


def link(settings: Settings, path: str, token: str) -> str:
    return f"{settings.app_base_url}{path}?token={quote(token)}"


def mail_allowed(email: str) -> bool:
    if limiter.retry_after("mail", email, EMAILS_PER_ACCOUNT):
        return False
    limiter.hit("mail", email)
    return True


def send_mail(settings: Settings, to: str, template: str, locale: str, url: str) -> None:
    try:
        mailer.send(settings, to, template, locale, url)
    except OSError as error:
        raise api_error(503, "email_unavailable", "E-mail delivery is unavailable. Try again later.") from error


def consume_token(db: Session, token: str, purpose: str) -> EmailToken:
    row = db.scalar(select(EmailToken).where(EmailToken.token_hash == hash_token(token), EmailToken.purpose == purpose).with_for_update())
    if row is None or row.used_at is not None or row.expires_at <= utcnow():
        raise api_error(400, "invalid_token", "This link is invalid, expired or already used.")
    row.used_at = utcnow()
    return row


@router.get("/csrf", response_model=CsrfResponse, summary="Get a CSRF token for the next unsafe request")
def get_csrf(request: Request, response: Response, settings: Settings = SettingsDep) -> CsrfResponse:
    seed = request.cookies.get(settings.csrf_cookie)
    if not seed:
        seed = secrets.token_urlsafe(CSRF_SEED_BYTES)
        set_cookie(response, settings, settings.csrf_cookie, seed, None, "strict")
    return CsrfResponse(csrf_token=csrf_token(settings.secret_key, seed, session_token(request, settings)))


@router.post("/register", status_code=202, response_model=Accepted, summary="Create an account with a role (candidate or recruiter)")
def register(body: RegisterRequest, request: Request, db: Session = DbDep, settings: Settings = SettingsDep) -> Accepted:
    enforce("register", client_key(request), REGISTRATIONS_PER_CLIENT)
    limiter.hit("register", client_key(request))
    password_hash = hash_password(body.password)  # Always paid, so both branches take the same time.
    existing = db.scalar(select(User).where(User.email == body.email))
    if existing is None:
        user = User(email=body.email, password_hash=password_hash, role=body.role, locale=body.locale)
        db.add(user)
        try:
            db.flush()
        except IntegrityError:
            db.rollback()
            existing = db.scalar(select(User).where(User.email == body.email))
        else:
            db.add(Consent(user_id=user.id, purpose="processing", policy_version=PRIVACY_POLICY_VERSION))
            if body.marketing:
                db.add(Consent(user_id=user.id, purpose="marketing", policy_version=PRIVACY_POLICY_VERSION))
            token = issue_email_token(db, user, "verify_email", VERIFY_TTL)
            audit(db, settings, "account.registered", user.id, "user", user.id, role=body.role, policy_version=PRIVACY_POLICY_VERSION)
            mail_allowed(body.email)
            send_mail(settings, body.email, "verify_email", body.locale, link(settings, "/verify-email", token))
            db.commit()
            return Accepted(message=REGISTER_MESSAGE)
    if existing is not None and mail_allowed(body.email):
        send_mail(settings, existing.email, "already_registered", existing.locale, f"{settings.app_base_url}/login")
    return Accepted(message=REGISTER_MESSAGE)


@router.post("/verify-email", summary="Confirm an e-mail address with its single-use token")
def verify_email(body: TokenRequest, db: Session = DbDep, settings: Settings = SettingsDep) -> dict[str, str]:
    row = consume_token(db, body.token, "verify_email")
    user = db.get(User, row.user_id)
    if user.email_verified_at is None:
        user.email_verified_at = utcnow()
        audit(db, settings, "account.email_verified", user.id, "user", user.id)
    db.commit()
    return {"status": "verified"}


@router.post("/verify-email/resend", status_code=202, response_model=Accepted, summary="Send a new confirmation e-mail")
def resend_verification(body: EmailRequest, db: Session = DbDep, settings: Settings = SettingsDep) -> Accepted:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is not None and user.email_verified_at is None and mail_allowed(body.email):
        token = issue_email_token(db, user, "verify_email", VERIFY_TTL)
        send_mail(settings, user.email, "verify_email", user.locale, link(settings, "/verify-email", token))
        db.commit()
    return Accepted(message=RESEND_MESSAGE)


@router.post("/login", response_model=LoginResponse, summary="Sign in and open a server-side session")
def login(body: LoginRequest, request: Request, db: Session = DbDep, settings: Settings = SettingsDep) -> JSONResponse:
    enforce("login-client", client_key(request), LOGIN_ATTEMPTS_PER_CLIENT)
    enforce("login-account", body.email, LOGIN_FAILURES_PER_ACCOUNT)
    limiter.hit("login-client", client_key(request))
    user = db.scalar(select(User).where(User.email == body.email))
    valid, needs_rehash = verify_password(user.password_hash if user else None, body.password)
    if not valid:
        limiter.hit("login-account", body.email)
        if user is not None:
            audit(db, settings, "auth.login_failed", user.id, "user", user.id)
            db.commit()
        raise api_error(401, "invalid_credentials", "The e-mail address or password is incorrect.")
    if user.email_verified_at is None:
        raise api_error(403, "email_not_verified", "Confirm your e-mail address before signing in.")
    limiter.reset("login-account", body.email)
    if needs_rehash:
        user.password_hash = hash_password(body.password)
    previous = session_token(request, settings)
    if previous:  # Session fixation: a sign-in never keeps a pre-existing session identifier.
        db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_token(previous)))
    token, digest = new_token()
    now = utcnow()
    db.add(AuthSession(user_id=user.id, token_hash=digest, last_seen_at=now, expires_at=now + SESSION_ABSOLUTE))
    user.last_active_at = now
    audit(db, settings, "auth.login", user.id, "user", user.id)
    db.commit()
    db.refresh(user)
    seed = request.cookies.get(settings.csrf_cookie, "")
    payload = LoginResponse(account=account_payload(user), csrf_token=csrf_token(settings.secret_key, seed, token))
    response = JSONResponse(payload.model_dump(mode="json"))
    set_cookie(response, settings, settings.session_cookie, token, int(SESSION_ABSOLUTE.total_seconds()), "lax")
    return response


@router.post("/logout", status_code=204, summary="Sign out and revoke the current session")
def logout(auth_session: AuthSession = Depends(current_session), db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    audit(db, settings, "auth.logout", auth_session.user_id, "user", auth_session.user_id)
    db.delete(auth_session)
    db.commit()
    response = Response(status_code=204)
    response.delete_cookie(settings.session_cookie, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")
    return response


@router.get("/me", response_model=Account, summary="Get the signed-in account")
def me(auth_session: AuthSession = Depends(current_session)) -> Account:
    return account_payload(auth_session.user)


@router.post("/password/forgot", status_code=202, response_model=Accepted, summary="Send a password reset e-mail")
def forgot_password(body: EmailRequest, db: Session = DbDep, settings: Settings = SettingsDep) -> Accepted:
    user = db.scalar(select(User).where(User.email == body.email))
    if user is not None and mail_allowed(body.email):
        token = issue_email_token(db, user, "reset_password", RESET_TTL)
        send_mail(settings, user.email, "reset_password", user.locale, link(settings, "/reset-password", token))
        db.commit()
    return Accepted(message=FORGOT_MESSAGE)


@router.post("/password/reset", status_code=204, summary="Choose a new password and revoke every session")
def reset_password(body: ResetPasswordRequest, db: Session = DbDep, settings: Settings = SettingsDep) -> Response:
    row = consume_token(db, body.token, "reset_password")
    user = db.get(User, row.user_id)
    user.password_hash = hash_password(body.password)
    # Opening the link proves control of the mailbox.
    user.email_verified_at = user.email_verified_at or utcnow()
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    db.execute(delete(EmailToken).where(EmailToken.user_id == user.id, EmailToken.purpose == "reset_password", EmailToken.used_at.is_(None)))
    audit(db, settings, "auth.password_reset", user.id, "user", user.id)
    db.commit()
    return Response(status_code=204)
