"""Loopback-only Host/Origin checks and body limits for every /api/v1 route."""

import pytest

from app.api.local_boundary import MAX_JSON_BODY_BYTES
from app.services.pdf import MAX_UPLOAD_BYTES

JOB_TEXT = "Fictional Data Analyst\nRequired skills\n- Python and SQL are required."


@pytest.mark.parametrize("headers", [
    {"Host": "public.example"},
    {"Host": "localhost.evil.example"},
    {"Host": "127.0.0.1.nip.io"},
    {"Origin": "http://evil.example"},
    {"Origin": "http://localhost:5173/path"},
    {"Origin": "null"},
])
@pytest.mark.parametrize("method, path, body", [
    ("get", "/api/v1/health", None),
    ("get", "/api/v1/jobs/capabilities", None),
    ("post", "/api/v1/jobs/analyze", {"text": JOB_TEXT}),
])
def test_non_local_hosts_and_origins_are_rejected_on_api_routes(client, headers, method, path, body):
    kwargs = {"headers": headers} | ({"json": body} if body is not None else {})
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "local_requests_only"


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "localhost:8000", "host.docker.internal:5173"])
def test_local_hosts_and_origins_are_accepted(client, host):
    response = client.post("/api/v1/jobs/analyze", headers={"Host": host, "Origin": "http://localhost:5173"}, json={"text": JOB_TEXT})
    assert response.status_code == 200, response.text


def test_upload_route_is_also_host_checked(client):
    response = client.post("/api/v1/candidates/parse", headers={"Host": "public.example"}, files={"file": ("cv.pdf", b"%PDF-1.7", "application/pdf")})
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "local_requests_only"


def test_service_root_and_docs_stay_outside_the_api_boundary(client):
    assert client.get("/", headers={"Host": "public.example"}).status_code == 200


def test_json_body_over_one_mebibyte_is_rejected_before_parsing(client):
    oversized = b'{"text": "' + b"a" * MAX_JSON_BODY_BYTES + b'"}'
    response = client.post("/api/v1/jobs/compare", headers={"Content-Type": "application/json"}, content=oversized)
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "request_too_large"


def test_chunked_json_body_without_length_is_also_bounded(client):
    def chunks():
        for _ in range(MAX_JSON_BODY_BYTES // 65536 + 2):
            yield b"a" * 65536

    response = client.post("/api/v1/jobs/analyze", headers={"Content-Type": "application/json"}, content=chunks())
    assert response.status_code == 413


def test_json_body_under_the_limit_reaches_validation(client):
    response = client.post("/api/v1/jobs/analyze", json={"text": "a" * (MAX_JSON_BODY_BYTES // 2)})
    assert response.status_code == 422  # Pydantic max_length, not the byte limit.


def test_cv_upload_keeps_its_five_mebibyte_limit(client):
    # Larger than the JSON limit but within the upload limit: reaches PDF validation.
    accepted = client.post("/api/v1/candidates/parse", files={"file": ("cv.pdf", b"not a pdf" + b"0" * (2 * 1024 * 1024), "application/pdf")})
    assert accepted.status_code == 415
    rejected = client.post("/api/v1/candidates/parse", files={"file": ("cv.pdf", b"%PDF-" + b"0" * (MAX_UPLOAD_BYTES + 128 * 1024), "application/pdf")})
    assert rejected.status_code == 413
    assert rejected.json()["detail"]["code"] == "request_too_large"
