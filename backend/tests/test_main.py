"""HTTP contract tests for the backend foundation."""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    """Run requests within the application's lifespan."""
    with TestClient(app) as test_client:
        yield test_client


def test_root(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {
        "name": "TalentFlow AI", "version": "0.1.0", "docs": "/docs"
    }


def test_health(client: TestClient) -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_docs_and_openapi(client: TestClient) -> None:
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "TalentFlow AI"
    assert schema["info"]["version"] == "0.1.0"
    assert {"/", "/api/v1/health"} <= schema["paths"].keys()


@pytest.mark.parametrize(
    ("origin", "allowed"),
    [("http://localhost:5173", True), ("https://untrusted.example", False)],
)
def test_cors(client: TestClient, origin: str, allowed: bool) -> None:
    response = client.options(
        "/api/v1/health",
        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
    )
    assert response.status_code == (200 if allowed else 400)
    assert response.headers.get("access-control-allow-origin") == (
        origin if allowed else None
    )
