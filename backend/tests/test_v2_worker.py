"""Retention housekeeping run by the worker."""

from datetime import timedelta

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session
from v2_helpers import sign_up

from app.db.models import AuditLog, AuthSession, EmailToken, utcnow
from app.worker import run_once


def test_worker_purges_expired_sessions_tokens_and_old_audit_entries(v2_client, v2_env):
    sign_up(v2_client, "worker@example.com")
    engine = create_engine(v2_env)
    with Session(engine) as session:
        session.execute(text("INSERT INTO audit_log (action, at) VALUES ('old', now() - interval '13 months')"))
        session.commit()
        before = session.scalar(select(func.count()).select_from(AuditLog))
        assert run_once(session) == {"sessions": 0, "email_tokens": 0, "audit_log": 1, "orphan_files": 0}
        # Nothing young was touched: the signed-in session and recent audit entries remain.
        assert session.scalar(select(func.count()).select_from(AuthSession)) == 1
        assert session.scalar(select(func.count()).select_from(AuditLog)) == before - 1
        counts = run_once(session, now=utcnow() + timedelta(days=8))
        assert counts["sessions"] == 1 and counts["email_tokens"] == 1
        assert session.scalar(select(func.count()).select_from(EmailToken)) == 0
    engine.dispose()
    assert v2_client.get("/api/v2/auth/me").status_code == 401
