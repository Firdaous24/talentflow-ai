"""Shared in-process API client and fictional, programmatically generated PDFs."""

import json
import os
from collections.abc import Iterator
from pathlib import Path

import pymupdf
import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy import text as sql_text

from app.main import app

SYNTHETIC_CVS = json.loads((Path(__file__).parent / "fixtures" / "cvs.json").read_text(encoding="utf-8"))


def make_pdf(text: str = "", pages: int = 1, encrypted: bool = False, user_password: str = "test-only") -> bytes:
    with pymupdf.open() as document:
        for index in range(pages):
            page = document.new_page()
            if text and index == 0:
                remaining = page.insert_textbox(pymupdf.Rect(40, 40, 555, 800), text, fontsize=10)
                assert remaining >= 0, "Synthetic text must fit on its page."
        if encrypted:
            return document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="synthetic-owner", user_pw=user_password)
        return document.tobytes()


@pytest.fixture
def client() -> Iterator[TestClient]:
    # Requests use the local host the runtime allow-list accepts (no "testserver").
    with TestClient(app, base_url="http://localhost") as test_client:
        yield test_client


# ---------------------------------------------------------------------------
# /api/v2 (accounts). Tests that need PostgreSQL use TEST_DATABASE_URL, a
# disposable database that the fixtures migrate and truncate. Without it they
# are skipped locally; CI sets REQUIRE_DATABASE_TESTS=1 so they can never be
# skipped silently there.
# ---------------------------------------------------------------------------

TEST_SECRET = "pytest-only-secret-key-0123456789-abcdefghijklmnop"
# 32 bytes in base64url, for tests only (the real key comes from the environment).
TEST_DATA_KEY = "cHl0ZXN0LW9ubHktZGF0YS1rZXktMzItYnl0ZXMhISE"
BACKEND_DIR = Path(__file__).resolve().parents[1]
V2_TABLES = (
    "audit_log", "consents", "email_tokens", "memberships", "sessions", "organizations", "users",
    "candidate_profiles", "cv_versions", "cv_data_keys", "job_offers",
)


def alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.attributes["configure_logger"] = False
    return config


@pytest.fixture(scope="session")
def database_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url:
        if os.environ.get("REQUIRE_DATABASE_TESTS") == "1":
            pytest.fail("TEST_DATABASE_URL is required when REQUIRE_DATABASE_TESTS=1.")
        pytest.skip("Set TEST_DATABASE_URL to a disposable PostgreSQL database to run /api/v2 database tests.")
    return url


@pytest.fixture(scope="session")
def migrated_database(database_url: str) -> Iterator[str]:
    previous = os.environ.get("DATABASE_URL")
    os.environ["DATABASE_URL"] = database_url
    try:
        command.downgrade(alembic_config(), "base")
        command.upgrade(alembic_config(), "head")
        yield database_url
    finally:
        if previous is None:
            os.environ.pop("DATABASE_URL", None)
        else:
            os.environ["DATABASE_URL"] = previous


@pytest.fixture
def v2_env(monkeypatch: pytest.MonkeyPatch, migrated_database: str, tmp_path: Path) -> Iterator[str]:
    from app.auth import mailer
    from app.auth.ratelimit import limiter
    from app.core.config import get_settings
    from app.storage.crypto import master_key

    monkeypatch.setenv("DATABASE_URL", migrated_database)
    monkeypatch.setenv("TALENTFLOW_SECRET_KEY", TEST_SECRET)
    monkeypatch.setenv("EMAIL_BACKEND", "memory")
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    monkeypatch.setenv("APP_BASE_URL", "https://localhost")
    monkeypatch.setenv("TALENTFLOW_DATA_KEY", TEST_DATA_KEY)
    monkeypatch.setenv("CV_FILES_DIR", str(tmp_path / "cv_files"))
    monkeypatch.delenv("CV_ORIGINAL_STORAGE", raising=False)
    get_settings.cache_clear()
    master_key.cache_clear()
    engine = create_engine(migrated_database)
    with engine.begin() as connection:
        connection.execute(sql_text(f"TRUNCATE {', '.join(V2_TABLES)} RESTART IDENTITY CASCADE"))
    engine.dispose()
    limiter.reset()
    mailer.outbox.clear()
    yield migrated_database
    get_settings.cache_clear()
    master_key.cache_clear()
    limiter.reset()
    mailer.outbox.clear()


def new_v2_client() -> TestClient:
    # HTTPS so the Secure, __Host- prefixed cookies behave exactly as in production.
    return TestClient(app, base_url="https://localhost")


@pytest.fixture
def v2_client(v2_env: str) -> Iterator[TestClient]:
    with new_v2_client() as test_client:
        yield test_client
