"""PDF upload boundary and API contract regression tests."""

import pytest
import pymupdf
from fastapi.testclient import TestClient

from app.models.candidate import CVParsingResponse
from app.services.pdf import MAX_UPLOAD_BYTES
from conftest import SYNTHETIC_CVS, make_pdf

URL = "/api/v1/candidates/parse"


@pytest.mark.parametrize("fixture", SYNTHETIC_CVS, ids=lambda fixture: fixture["scenario"])
def test_valid_synthetic_cv(client: TestClient, fixture: dict) -> None:
    response = client.post(URL, files={"file": ("synthetic.pdf", make_pdf(fixture["text"]), "application/pdf")})
    assert response.status_code == 200
    parsed = CVParsingResponse.model_validate(response.json())
    assert {skill.name for skill in parsed.candidate.technical_skills} == set(fixture["skills"])
    assert parsed.parsing_metadata.page_count == 1
    assert parsed.parsing_metadata.status == "partial"
    assert parsed.parsing_metadata.warnings
    assert "text" not in response.json()
    if fixture["scenario"] == "incomplete":
        assert parsed.candidate.full_name is None
        assert parsed.candidate.email is None
        assert parsed.candidate.experience == []


@pytest.mark.parametrize("data,status,code", [
    (b"", 422, "empty_file"),
    (b"not a pdf", 415, "invalid_file_type"),
    (b"%PDF-1.7\nbroken\n%%EOF", 422, "corrupted_pdf"),
    (b"x" * (MAX_UPLOAD_BYTES + 1), 413, "file_too_large"),
    (b"x" * (MAX_UPLOAD_BYTES + 100_000), 413, "request_too_large"),
], ids=["empty", "non-pdf", "corrupted", "file-size-limit", "request-size-limit"])
def test_invalid_uploads(client: TestClient, data: bytes, status: int, code: str) -> None:
    response = client.post(URL, files={"file": ("pretend.pdf", data, "application/pdf")})
    assert response.status_code == status
    assert response.json()["detail"]["code"] == code


@pytest.mark.parametrize("options,code", [
    ({"encrypted": True}, "encrypted_pdf"),
    ({"encrypted": True, "user_password": ""}, "encrypted_pdf"),
    ({"pages": 11}, "too_many_pages"),
    ({}, "no_extractable_text"),
])
def test_rejected_pdf_documents(client: TestClient, options: dict, code: str) -> None:
    response = client.post(URL, files={"file": ("synthetic.pdf", make_pdf(**options), "application/pdf")})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code


def test_missing_upload(client: TestClient) -> None:
    assert client.post(URL).status_code == 422


def test_actual_structure_over_filename(client: TestClient) -> None:
    response = client.post(URL, files={"file": ("wrong.txt", make_pdf("Skills\nPython"), "text/plain")})
    assert response.status_code == 200


@pytest.mark.parametrize("origin,allowed", [("http://localhost:5173", True), ("https://untrusted.example", False)])
def test_post_cors(client: TestClient, origin: str, allowed: bool) -> None:
    response = client.options(URL, headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"})
    assert response.status_code == (200 if allowed else 400)
    assert response.headers.get("access-control-allow-origin") == (origin if allowed else None)


def test_upload_schema_in_swagger(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert "multipart/form-data" in schema["paths"][URL]["post"]["requestBody"]["content"]


def test_truncated_document(client: TestClient) -> None:
    data = make_pdf("Skills\nPython")
    response = client.post(URL, files={"file": ("cv.pdf", data[:-20], "application/pdf")})
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "corrupted_pdf"


def test_cors_headers_on_size_rejection(client: TestClient) -> None:
    response = client.post(URL, content=b"x" * (MAX_UPLOAD_BYTES + 100_000), headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_exact_file_size_boundary(client: TestClient) -> None:
    # Put padding inside a legitimate metadata object, preserving the PDF trailer.
    with pymupdf.open(stream=make_pdf("Skills\nPython"), filetype="pdf") as document:
        padding_size = MAX_UPLOAD_BYTES - 1000
        for _ in range(5):
            document.set_metadata({"subject": "x" * padding_size})
            data = document.tobytes()
            if len(data) == MAX_UPLOAD_BYTES:
                break
            padding_size += MAX_UPLOAD_BYTES - len(data)
    assert len(data) == MAX_UPLOAD_BYTES
    response = client.post(URL, files={"file": ("synthetic.pdf", data, "application/pdf")})
    assert response.status_code == 200
