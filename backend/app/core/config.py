"""Runtime settings for the account platform (/api/v2), read from the environment only.

No secret has a default value. /api/v1 (the public demo) never reads these
settings, so it keeps working when they are absent; /api/v2 answers 503
`service_not_configured` instead of starting with an unsafe configuration.
"""

import os
from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy.engine import URL, make_url

MIN_SECRET_LENGTH = 32
PLACEHOLDER_PREFIX = "change-me"


class ConfigurationError(RuntimeError):
    """The environment does not provide a safe configuration for /api/v2."""


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ConfigurationError(f"{name} must be true or false.")


def database_url() -> URL:
    """DATABASE_URL, or a URL assembled from POSTGRES_* (password escaped by SQLAlchemy)."""
    explicit = os.environ.get("DATABASE_URL", "").strip()
    if explicit:
        url = make_url(explicit)
    else:
        user, password, name = (os.environ.get(key, "").strip() for key in ("POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"))
        if not (user and password and name):
            raise ConfigurationError("Set DATABASE_URL, or POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB.")
        url = URL.create(
            "postgresql+psycopg", username=user, password=password, database=name,
            host=os.environ.get("POSTGRES_HOST", "db").strip() or "db",
            port=int(os.environ.get("POSTGRES_PORT", "5432")),
        )
    if url.get_backend_name() != "postgresql":
        raise ConfigurationError("The account platform requires PostgreSQL.")
    return url.set(drivername="postgresql+psycopg")


@dataclass(frozen=True)
class Settings:
    database_url: URL
    secret_key: bytes
    cookie_secure: bool
    app_base_url: str
    email_backend: str
    smtp_host: str
    smtp_port: int
    mail_from: str

    @property
    def session_cookie(self) -> str:
        # The __Host- prefix requires Secure; plain HTTP local development uses the bare name.
        return "__Host-tf_session" if self.cookie_secure else "tf_session"

    @property
    def csrf_cookie(self) -> str:
        return "__Host-tf_csrf" if self.cookie_secure else "tf_csrf"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    secret = os.environ.get("TALENTFLOW_SECRET_KEY", "")
    if len(secret) < MIN_SECRET_LENGTH or secret.lower().startswith(PLACEHOLDER_PREFIX):
        raise ConfigurationError("TALENTFLOW_SECRET_KEY must be a generated secret of at least 32 characters.")
    email_backend = os.environ.get("EMAIL_BACKEND", "smtp").strip().lower()
    if email_backend not in {"smtp", "memory"}:
        raise ConfigurationError("EMAIL_BACKEND must be smtp or memory.")
    return Settings(
        database_url=database_url(),
        secret_key=secret.encode("utf-8"),
        cookie_secure=_flag("SESSION_COOKIE_SECURE", True),
        app_base_url=os.environ.get("APP_BASE_URL", "http://localhost:5173").strip().rstrip("/"),
        email_backend=email_backend,
        smtp_host=os.environ.get("SMTP_HOST", "mailpit").strip(),
        smtp_port=int(os.environ.get("SMTP_PORT", "1025")),
        mail_from=os.environ.get("MAIL_FROM", "TalentFlow AI <no-reply@talentflow.example>").strip(),
    )
