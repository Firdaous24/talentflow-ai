"""Background worker: retention housekeeping (phases 6 and 7); the job queue arrives in phase 8.

Each pass deletes:
- expired or idle sessions (absolute 7 days, idle 12 hours);
- e-mail tokens that expired or were used more than a day ago;
- audit entries older than 12 months (decision A3; the append-only trigger allows nothing younger);
- encrypted original PDF files whose CV version no longer exists (older than one hour,
  so an upload in progress is never touched). Their data key is already deleted, so
  they were unreadable; removing them completes the deletion.

Only counts are logged, never personal data. Run with `python -m app.worker`.
"""

import logging
import os
import signal
import threading
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, literal_column, or_, select
from sqlalchemy.orm import Session

from app.api.v2.deps import SESSION_IDLE
from app.db.models import AuditLog, AuthSession, CVVersion, EmailToken, utcnow
from app.db.session import get_engine
from app.storage import files

AUDIT_RETENTION_SQL = "now() - interval '12 months'"
USED_TOKEN_GRACE = timedelta(days=1)
ORPHAN_FILE_GRACE = timedelta(hours=1)
logger = logging.getLogger("talentflow.worker")


def sweep_orphan_files(session: Session, now: datetime) -> int:
    directory = files.files_directory()
    if not directory.is_dir():
        return 0
    stale = [path for path in directory.iterdir() if path.suffix in {".bin", ".tmp"} and now.timestamp() - path.stat().st_mtime >= ORPHAN_FILE_GRACE.total_seconds()]
    ids = {}
    for path in stale:
        try:
            ids[path] = uuid.UUID(path.stem)
        except ValueError:
            ids[path] = None
    known = set(session.scalars(select(CVVersion.id).where(CVVersion.id.in_([value for value in ids.values() if value]))).all()) if ids else set()
    removed = 0
    for path in stale:
        if path.suffix == ".bin" and ids[path] in known:
            continue
        path.unlink(missing_ok=True)
        removed += 1
    return removed


def run_once(session: Session, now: datetime | None = None) -> dict[str, int]:
    now = now or utcnow()
    counts = {
        "sessions": session.execute(delete(AuthSession).where(or_(AuthSession.expires_at <= now, AuthSession.last_seen_at <= now - SESSION_IDLE)).execution_options(synchronize_session=False)).rowcount,
        "email_tokens": session.execute(delete(EmailToken).where(or_(EmailToken.expires_at <= now, EmailToken.used_at <= now - USED_TOKEN_GRACE)).execution_options(synchronize_session=False)).rowcount,
        # The database clock and interval, exactly as the append-only trigger checks them.
        "audit_log": session.execute(delete(AuditLog).where(AuditLog.at < literal_column(AUDIT_RETENTION_SQL)).execution_options(synchronize_session=False)).rowcount,
    }
    session.commit()
    counts["orphan_files"] = sweep_orphan_files(session, now)
    return counts


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    interval = float(os.environ.get("WORKER_INTERVAL_SECONDS", "3600"))
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    logger.info("worker started (retention pass every %.0f s)", interval)
    while not stop.is_set():
        try:
            with Session(get_engine()) as session:
                logger.info("retention pass: %s", run_once(session))
        except Exception:
            logger.exception("retention pass failed")
        stop.wait(interval)
    logger.info("worker stopped")


if __name__ == "__main__":
    main()
