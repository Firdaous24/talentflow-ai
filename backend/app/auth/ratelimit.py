"""In-memory sliding-window rate limiter (decision D16).

The backend runs a single uvicorn worker (LangGraph workflows already require
it), so process memory is a consistent store. Keys are hashed: no e-mail
address is kept in memory by the limiter.
"""

import hashlib
import math
import threading
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass


@dataclass(frozen=True)
class Rule:
    limit: int
    window_seconds: float


class RateLimiter:
    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    @staticmethod
    def _key(scope: str, subject: str) -> str:
        return scope + ":" + hashlib.sha256(subject.encode("utf-8")).hexdigest()

    def retry_after(self, scope: str, subject: str, rules: tuple[Rule, ...]) -> int:
        """Seconds to wait before another hit is allowed; 0 when allowed now."""
        now = self._clock()
        key = self._key(scope, subject)
        with self._lock:
            hits = self._hits.get(key)
            if not hits:
                return 0
            longest = max(rule.window_seconds for rule in rules)
            while hits and hits[0] <= now - longest:
                hits.popleft()
            wait = 0.0
            for rule in rules:
                recent = [hit for hit in hits if hit > now - rule.window_seconds]
                if len(recent) >= rule.limit:
                    wait = max(wait, recent[-rule.limit] + rule.window_seconds - now)
            return math.ceil(wait) if wait > 0 else 0

    def hit(self, scope: str, subject: str) -> None:
        with self._lock:
            self._hits.setdefault(self._key(scope, subject), deque()).append(self._clock())

    def reset(self, scope: str | None = None, subject: str | None = None) -> None:
        with self._lock:
            if scope is None:
                self._hits.clear()
            elif subject is not None:
                self._hits.pop(self._key(scope, subject), None)


# Policies from the design document (§6): login 5/min and 20/h per account on failures.
LOGIN_FAILURES_PER_ACCOUNT = (Rule(5, 60), Rule(20, 3600))
LOGIN_ATTEMPTS_PER_CLIENT = (Rule(30, 60),)
REGISTRATIONS_PER_CLIENT = (Rule(10, 3600),)
EMAILS_PER_ACCOUNT = (Rule(3, 3600),)
# Candidate space (phase 7): uploads 20/min per account (design §6), plus a daily ceiling.
CV_UPLOADS_PER_ACCOUNT = (Rule(20, 60), Rule(100, 86400))
JOB_ANALYSES_PER_ACCOUNT = (Rule(30, 60), Rule(300, 86400))
# Recruiter space (phase 8): bulk imports, 3 batches per hour per organization (design §6).
IMPORT_BATCHES_PER_ORGANIZATION = (Rule(3, 3600),)

limiter = RateLimiter()
