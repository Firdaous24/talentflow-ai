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
