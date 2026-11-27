"""Background worker (`python -m app.worker`).

Work queue (phase 8), polled every WORKER_POLL_SECONDS (2 s by default):
- parses queued bulk-import files (`import_items`, `FOR UPDATE SKIP LOCKED`) into
  imported profiles waiting for the recruiter's review; the encrypted PDF and its
  key are erased once handled;
- computes pending matches with `compare_job` (new confirmations, changed criteria).
The API never parses an imported file itself, so a batch of 200 never blocks it.

Retention pass, every WORKER_INTERVAL_SECONDS (one hour by default), deletes:
- imported profiles 90 days after their import (decision A2), with their CV
  versions, data keys and matches;
- expired or idle sessions (absolute 7 days, idle 12 hours);
- e-mail tokens that expired or were used more than a day ago;
- audit entries older than 12 months (decision A3; the append-only trigger allows nothing younger);
- encrypted original PDF files whose CV version no longer exists (older than one hour,
  so an upload in progress is never touched). Their data key is already deleted, so
  they were unreadable; removing them completes the deletion.

Only counts are logged, never personal data.
"""

import logging
import os
import signal
import threading
import time
import uuid
from datetime import datetime, timedelta

from sqlalchemy import delete, literal_column, or_, select
from sqlalchemy.orm import Session

from app.api.v2.deps import SESSION_IDLE
from app.db.models import AuditLog, AuthSession, CVVersion, EmailToken, utcnow
from app.db.session import get_engine
from app.storage import files, matching
from app.storage.crypto import EncryptionNotConfigured, master_key

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
        "expired_imports": matching.expire_imported(session, now),
        "sessions": session.execute(delete(AuthSession).where(or_(AuthSession.expires_at <= now, AuthSession.last_seen_at <= now - SESSION_IDLE)).execution_options(synchronize_session=False)).rowcount,
        "email_tokens": session.execute(delete(EmailToken).where(or_(EmailToken.expires_at <= now, EmailToken.used_at <= now - USED_TOKEN_GRACE)).execution_options(synchronize_session=False)).rowcount,
        # The database clock and interval, exactly as the append-only trigger checks them.
        "audit_log": session.execute(delete(AuditLog).where(AuditLog.at < literal_column(AUDIT_RETENTION_SQL)).execution_options(synchronize_session=False)).rowcount,
    }
    session.commit()
    counts["orphan_files"] = sweep_orphan_files(session, now)
    return counts


def drain(session: Session, master: bytes, max_files: int = 20, max_matches: int = 200) -> dict[str, int]:
    """One queue round: parse up to `max_files` imported files, then compute pending matches."""
    parsed = 0
    while parsed < max_files and matching.process_next(session, master):
        parsed += 1
    return {"files": parsed, "matches": matching.compute_pending(session, master, limit=max_matches)}


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    interval = float(os.environ.get("WORKER_INTERVAL_SECONDS", "3600"))
    poll = float(os.environ.get("WORKER_POLL_SECONDS", "2"))
    stop = threading.Event()
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, lambda *_: stop.set())
    logger.info("worker started (queue every %.0f s, retention every %.0f s)", poll, interval)
    next_retention = 0.0
    while not stop.is_set():
        try:
            with Session(get_engine()) as session:
                if time.monotonic() >= next_retention:
                    logger.info("retention pass: %s", run_once(session))
                    next_retention = time.monotonic() + interval
                try:
                    done = drain(session, master_key())
                except EncryptionNotConfigured:
                    done = {"files": 0, "matches": 0}
                if done["files"] or done["matches"]:
                    logger.info("queue: %s", done)
        except Exception:
            logger.exception("worker pass failed")
        stop.wait(poll)
    logger.info("worker stopped")


if __name__ == "__main__":
    main()
