"""Helpers for /api/v2 tests: CSRF, sign-up through the real e-mail token, sign-in."""

import re

from fastapi.testclient import TestClient

from app.auth import mailer

PASSWORD = "correct horse battery staple"


def csrf(client: TestClient) -> str:
    response = client.get("/api/v2/auth/csrf")
    assert response.status_code == 200, response.text
    return response.json()["csrf_token"]


def unsafe(client: TestClient, method: str, path: str, json: dict | None = None, token: str | None = None):
    headers = {"X-CSRF-Token": token if token is not None else csrf(client)}
    return client.request(method, path, json=json, headers=headers)


def last_link(to: str, path: str) -> str:
    for mail in reversed(mailer.outbox):
        if mail.to == to:
            match = re.search(re.escape(path) + r"\?token=([A-Za-z0-9_-]+)", mail.body)
            if match:
                return match.group(1)
    raise AssertionError(f"No {path} link was sent to {to}.")


def register(client: TestClient, email: str, role: str = "candidate", password: str = PASSWORD, **extra):
    body = {"email": email, "password": password, "role": role, "locale": "fr", "accept_terms": True, **extra}
    return unsafe(client, "POST", "/api/v2/auth/register", body)


def verify(client: TestClient, email: str):
    return unsafe(client, "POST", "/api/v2/auth/verify-email", {"token": last_link(email, "/verify-email")})


def login(client: TestClient, email: str, password: str = PASSWORD):
    return unsafe(client, "POST", "/api/v2/auth/login", {"email": email, "password": password})


def sign_up(client: TestClient, email: str, role: str = "candidate") -> dict:
    assert register(client, email, role).status_code == 202
    assert verify(client, email).status_code == 200
    response = login(client, email)
    assert response.status_code == 200, response.text
    return response.json()


def upload_cv(client: TestClient, pdf: bytes, keep_original: bool = False):
    return client.post(
        "/api/v2/me/cv", files={"file": ("fictional-cv.pdf", pdf, "application/pdf")},
        data={"keep_original": "true" if keep_original else "false"}, headers={"X-CSRF-Token": csrf(client)},
    )


JOB_TEXT = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\nTechnical environment: PostgreSQL, Redis\n"


def fictional_cv(number: int, skills: list[str]) -> str:
    """A fictional CV with identity, contact, place and dates that must never leak before a reveal."""
    return (
        f"Name: Imported Person {number}\nEmail: imported{number}@example.com\nPhone: +212 600 000 {number:03d}\n"
        f"Technical Skills\n{', '.join(skills)}\nEducation\nDegree: BSc\nInstitution: Fictional College {number}\n"
        "Field of study: Computer Science\nStart date: 2019\nEnd date: 2022\nLanguages\nEnglish: Fluent"
    )


def recruiter_job(client: TestClient, email: str, organization: str = "Hiring Org", confirm: bool = True) -> tuple[str, str]:
    """A signed-in recruiter with an organization and an offer whose criteria are confirmed."""
    sign_up(client, email, "recruiter")
    org = unsafe(client, "POST", "/api/v2/orgs", {"name": organization}).json()["id"]
    job = unsafe(client, "POST", f"/api/v2/orgs/{org}/jobs", {"text": JOB_TEXT})
    assert job.status_code == 201, job.text
    job_id = job.json()["id"]
    if confirm:
        assert unsafe(client, "POST", f"/api/v2/orgs/{org}/jobs/{job_id}/confirm").status_code == 200
    return org, job_id


def import_files(client: TestClient, org: str, job: str, pdfs: list[bytes]) -> tuple[str, list]:
    batch = unsafe(client, "POST", f"/api/v2/orgs/{org}/jobs/{job}/imports", {"attestation": True, "file_count": len(pdfs)})
    assert batch.status_code == 201, batch.text
    batch_id = batch.json()["id"]
    responses = [
        client.post(f"/api/v2/orgs/{org}/imports/{batch_id}/files", files={"file": (f"cv-{index}.pdf", pdf, "application/pdf")}, headers={"X-CSRF-Token": csrf(client)})
        for index, pdf in enumerate(pdfs)
    ]
    return batch_id, responses


def run_worker(database_url: str) -> dict[str, int]:
    """Drain the queue as the worker would, until nothing is left to parse or compute."""
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from app.storage.crypto import master_key
    from app.worker import drain

    engine = create_engine(database_url)
    total = {"files": 0, "matches": 0}
    try:
        with Session(engine) as session:
            while True:
                done = drain(session, master_key(), max_files=50)
                total = {key: total[key] + done[key] for key in total}
                if not done["files"] and not done["matches"]:
                    return total
    finally:
        engine.dispose()
