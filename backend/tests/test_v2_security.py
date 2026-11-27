"""Unit tests for /api/v2 building blocks that need no database."""

import uuid

import pytest
from argon2 import PasswordHasher, Type
from fastapi.testclient import TestClient

from app.auth.ratelimit import RateLimiter, Rule
from app.auth.security import csrf_token, csrf_valid, hash_password, hash_token, new_token, pseudonym, verify_password
from app.core.config import ConfigurationError, database_url, get_settings
from app.db.models import uuid7
from app.main import app

SECRET = b"unit-test-secret-0123456789abcdefghij"


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
def unconfigured(monkeypatch: pytest.MonkeyPatch):
    for name in ("DATABASE_URL", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "TALENTFLOW_SECRET_KEY"):
        monkeypatch.delenv(name, raising=False)
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def configured_without_database(monkeypatch: pytest.MonkeyPatch):
    """Valid settings pointing at an unreachable database: enough for checks that run before any query."""
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://nobody:nothing@127.0.0.1:9/none")
    monkeypatch.setenv("TALENTFLOW_SECRET_KEY", SECRET.decode())
    monkeypatch.setenv("SESSION_COOKIE_SECURE", "true")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def test_argon2id_hash_verifies_and_never_stores_the_password():
    hashed = hash_password("a long enough passphrase")
    assert hashed.startswith("$argon2id$v=19$m=19456,t=2,p=1$")
    assert "a long enough passphrase" not in hashed
    assert verify_password(hashed, "a long enough passphrase") == (True, False)
    assert verify_password(hashed, "a long enough passphrasE") == (False, False)


def test_weaker_legacy_hash_is_flagged_for_transparent_rehash():
    legacy = PasswordHasher(time_cost=1, memory_cost=8 * 1024, parallelism=1, type=Type.ID).hash("legacy passphrase 1")
    assert verify_password(legacy, "legacy passphrase 1") == (True, True)


def test_missing_account_and_corrupt_hash_still_fail_closed():
    assert verify_password(None, "anything at all") == (False, False)
    assert verify_password("not-a-hash", "anything at all") == (False, False)


def test_tokens_are_random_and_only_their_digest_is_stored():
    first, first_digest = new_token()
    second, _ = new_token()
    assert first != second and len(first) >= 43
    assert first_digest == hash_token(first) and len(first_digest) == 32
    assert first.encode() not in first_digest


def test_csrf_token_is_bound_to_seed_session_and_secret():
    anonymous = csrf_token(SECRET, "seed", None)
    signed_in = csrf_token(SECRET, "seed", "session-token")
    assert anonymous != signed_in
    assert csrf_valid(SECRET, "seed", None, anonymous)
    assert csrf_valid(SECRET, "seed", "session-token", signed_in)
    assert not csrf_valid(SECRET, "seed", "session-token", anonymous)  # Login changes the token.
    assert not csrf_valid(SECRET, "other-seed", None, anonymous)
    assert not csrf_valid(b"another-secret-0123456789abcdefghijk", "seed", None, anonymous)
    assert not csrf_valid(SECRET, None, None, anonymous)
    assert not csrf_valid(SECRET, "seed", None, None)


def test_pseudonym_is_stable_keyed_and_not_the_identifier():
    user_id = uuid.uuid4()
    assert pseudonym(SECRET, user_id) == pseudonym(SECRET, user_id)
    assert pseudonym(SECRET, user_id) != pseudonym(b"another-secret-0123456789abcdefghijk", user_id)
    assert str(user_id) not in pseudonym(SECRET, user_id)


def test_rate_limiter_blocks_within_window_and_recovers():
    clock = FakeClock()
    limiter = RateLimiter(clock)
    rules = (Rule(2, 60), Rule(3, 3600))
    assert limiter.retry_after("login", "a@example.com", rules) == 0
    limiter.hit("login", "a@example.com")
    limiter.hit("login", "a@example.com")
    assert limiter.retry_after("login", "a@example.com", rules) == 60
    assert limiter.retry_after("login", "b@example.com", rules) == 0
    clock.now += 61
    assert limiter.retry_after("login", "a@example.com", rules) == 0
    limiter.hit("login", "a@example.com")
    # Third hit within the hour: the hourly rule now applies.
    assert limiter.retry_after("login", "a@example.com", rules) == 3600 - 61
    limiter.reset("login", "a@example.com")
    assert limiter.retry_after("login", "a@example.com", rules) == 0


def test_rate_limiter_keeps_no_raw_subject():
    limiter = RateLimiter(FakeClock())
    limiter.hit("login", "private@example.com")
    assert all("private@example.com" not in key for key in limiter._hits)


def test_uuid7_is_versioned_and_time_ordered():
    values = [uuid7() for _ in range(50)]
    assert all(value.version == 7 and value.variant == uuid.RFC_4122 for value in values)
    assert [value.int >> 80 for value in values] == sorted(value.int >> 80 for value in values)


@pytest.mark.parametrize("secret", ["", "short-secret", "change-me-but-long-enough-0123456789abcdef"])
def test_settings_refuse_missing_short_or_placeholder_secret(monkeypatch, unconfigured, secret):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://user:pass@db/name")
    monkeypatch.setenv("TALENTFLOW_SECRET_KEY", secret)
    with pytest.raises(ConfigurationError):
        get_settings()


def test_database_url_requires_postgresql_and_escapes_assembled_passwords(monkeypatch, unconfigured):
    monkeypatch.setenv("DATABASE_URL", "sqlite:///local.db")
    with pytest.raises(ConfigurationError):
        database_url()
    monkeypatch.delenv("DATABASE_URL")
    with pytest.raises(ConfigurationError):
        database_url()
    monkeypatch.setenv("POSTGRES_USER", "app")
    monkeypatch.setenv("POSTGRES_PASSWORD", "p@ss:w/rd#1")
    monkeypatch.setenv("POSTGRES_DB", "talentflow")
    url = database_url()
    assert (url.drivername, url.host, url.password, url.database) == ("postgresql+psycopg", "db", "p@ss:w/rd#1", "talentflow")


def test_unconfigured_account_api_answers_503_while_the_demo_api_keeps_working(unconfigured):
    with TestClient(app, base_url="http://localhost") as client:
        assert client.get("/api/v1/health").json() == {"status": "ok"}
        response = client.get("/api/v2/auth/me")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "service_not_configured"


def test_unsafe_request_without_csrf_is_refused_before_any_route_code(configured_without_database):
    with TestClient(app, base_url="https://localhost") as client:
        for method, path in [("POST", "/api/v2/auth/login"), ("POST", "/api/v2/auth/logout"), ("DELETE", "/api/v2/me"), ("PUT", "/api/v2/me/consents/marketing"), ("PATCH", "/api/v2/me")]:
            response = client.request(method, path, json={})
            assert response.status_code == 403, (method, path)
            assert response.json()["detail"]["code"] == "csrf_failed"
            assert response.headers["cache-control"] == "no-store"
        forged = client.post("/api/v2/auth/login", json={}, headers={"X-CSRF-Token": "forged"})
        assert forged.status_code == 403


def test_csrf_endpoint_sets_a_strict_host_prefixed_cookie_and_security_headers(configured_without_database):
    with TestClient(app, base_url="https://localhost") as client:
        response = client.get("/api/v2/auth/csrf")
        assert response.status_code == 200
        cookie = response.headers["set-cookie"]
        assert cookie.startswith("__Host-tf_csrf=")
        for attribute in ("HttpOnly", "Path=/", "SameSite=strict", "Secure"):
            assert attribute.lower() in cookie.lower()
        for header, value in {"x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", "cache-control": "no-store"}.items():
            assert response.headers[header] == value


def test_account_api_keeps_the_local_host_boundary(configured_without_database):
    with TestClient(app, base_url="https://localhost") as client:
        response = client.get("/api/v2/auth/csrf", headers={"Host": "attacker.example"})
        assert response.status_code == 403
        assert response.json()["detail"]["code"] == "local_requests_only"
        response = client.get("/api/v2/auth/csrf", headers={"Origin": "https://attacker.example"})
        assert response.status_code == 403


def test_account_api_bounds_json_bodies(configured_without_database):
    with TestClient(app, base_url="https://localhost") as client:
        response = client.post("/api/v2/auth/register", content=b"{" + b" " * (1024 * 1024 + 1), headers={"Content-Type": "application/json"})
        assert response.status_code == 413
