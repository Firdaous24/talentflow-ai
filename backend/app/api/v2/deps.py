"""Shared dependencies for /api/v2: settings, errors, current session, role checks and audit."""

import uuid
from collections.abc import Callable, Iterator
from datetime import timedelta

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.auth.security import hash_token, pseudonym
from app.core.config import ConfigurationError, Settings, get_settings
from app.db.models import AuditLog, AuthSession, User, utcnow
from app.db.session import get_db

SESSION_ABSOLUTE = timedelta(days=7)
SESSION_IDLE = timedelta(hours=12)
SESSION_TOUCH_EVERY = timedelta(minutes=5)
PRIVACY_POLICY_VERSION = "2026-11-27"


def api_error(status: int, code: str, message: str, headers: dict[str, str] | None = None) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message}, headers=headers)


def settings_dependency() -> Settings:
    try:
        return get_settings()
    except ConfigurationError as error:
        raise api_error(503, "service_not_configured", "The account service is not configured on this server.") from error


def database(settings: Settings = Depends(settings_dependency)) -> Iterator[Session]:
    yield from get_db()


SettingsDep = Depends(settings_dependency)
DbDep = Depends(database)


def audit(db: Session, settings: Settings, action: str, actor_id: uuid.UUID | None = None, target_type: str | None = None, target_id: uuid.UUID | None = None, **details: object) -> None:
    """Pseudonymous, content-free audit entry, committed with the caller's transaction.

    A user target is never stored by raw identifier: the keyed `actor_ref` is the
    only link, so entries kept after an account deletion identify nobody."""
    if target_type == "user":
        target_id = None
    db.add(AuditLog(actor_ref=pseudonym(settings.secret_key, actor_id) if actor_id else None, action=action, target_type=target_type, target_id=target_id, details=details))


def session_token(request: Request, settings: Settings) -> str | None:
    return request.cookies.get(settings.session_cookie) or None


def current_session(request: Request, db: Session = DbDep, settings: Settings = SettingsDep) -> AuthSession:
    token = session_token(request, settings)
    row = db.scalar(select(AuthSession).options(joinedload(AuthSession.user)).where(AuthSession.token_hash == hash_token(token))) if token else None
    now = utcnow()
    if row is None or row.expires_at <= now or row.last_seen_at + SESSION_IDLE <= now:
        raise api_error(401, "not_authenticated", "Sign in to use this resource.")
    if now - row.last_seen_at >= SESSION_TOUCH_EVERY:
        row.last_seen_at = now
        row.user.last_active_at = now
        db.commit()
    return row


def current_user(auth_session: AuthSession = Depends(current_session)) -> User:
    return auth_session.user


def require_role(*roles: str) -> Callable[..., User]:
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise api_error(403, "forbidden_role", "This resource is not available for your account type.")
        return user

    return dependency
