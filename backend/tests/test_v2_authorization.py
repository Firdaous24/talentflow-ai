"""Generated authorization matrix for every /api/v2 operation (design §4.5).

Each operation published in the OpenAPI schema must be classified below; the
matrix is then generated from that table, so a new route without a policy
fails the suite instead of shipping unprotected.

- anonymous (with a valid CSRF token): 401 on everything but the public routes;
- wrong role: 403 `forbidden_role`;
- another organization, another candidate's resource, or an unknown identifier: 404, never 403;
- no CSRF token: 403 `csrf_failed` on every unsafe operation, signed in or not.
"""

import uuid

import pytest
from conftest import new_v2_client
from v2_helpers import sign_up, unsafe

from app.api.v2 import PUBLIC_ROUTES
from app.main import app

POLICY = {
    ("GET", "/api/v2/auth/csrf"): "public",
    ("POST", "/api/v2/auth/register"): "public",
    ("POST", "/api/v2/auth/verify-email"): "public",
    ("POST", "/api/v2/auth/verify-email/resend"): "public",
    ("POST", "/api/v2/auth/login"): "public",
    ("POST", "/api/v2/auth/password/forgot"): "public",
    ("POST", "/api/v2/auth/password/reset"): "public",
    ("POST", "/api/v2/auth/logout"): "authenticated",
    ("GET", "/api/v2/auth/me"): "authenticated",
    ("PATCH", "/api/v2/me"): "authenticated",
    ("DELETE", "/api/v2/me"): "authenticated",
    ("GET", "/api/v2/me/consents"): "authenticated",
    ("PUT", "/api/v2/me/consents/{purpose}"): "authenticated",
    ("POST", "/api/v2/orgs"): "recruiter",
    ("GET", "/api/v2/orgs"): "recruiter",
    ("GET", "/api/v2/orgs/{organization_id}"): "recruiter:organization",
    ("GET", "/api/v2/orgs/{organization_id}/members"): "recruiter:organization",
    ("GET", "/api/v2/candidate/overview"): "candidate",
    # Phase 7: candidate space. ":owned" routes address one of the caller's own resources.
    ("POST", "/api/v2/me/cv"): "candidate",
    ("GET", "/api/v2/me/cv/versions"): "candidate",
    ("GET", "/api/v2/me/cv/versions/{version_id}"): "candidate:owned",
    ("GET", "/api/v2/me/cv/versions/{version_id}/original"): "candidate:owned",
    ("PUT", "/api/v2/me/cv/versions/{version_id}/review"): "candidate:owned",
    ("POST", "/api/v2/me/cv/versions/{version_id}/confirm"): "candidate:owned",
    ("GET", "/api/v2/me/cv/diff"): "candidate:owned",
    ("POST", "/api/v2/me/targets"): "candidate",
    ("GET", "/api/v2/me/targets"): "candidate",
    ("GET", "/api/v2/me/targets/{target_id}"): "candidate:owned",
    ("PUT", "/api/v2/me/targets/{target_id}/requirements"): "candidate:owned",
    ("POST", "/api/v2/me/targets/{target_id}/confirm"): "candidate:owned",
    ("DELETE", "/api/v2/me/targets/{target_id}"): "candidate:owned",
    ("GET", "/api/v2/me/targets/{target_id}/coverage"): "candidate:owned",
    ("GET", "/api/v2/me/targets/{target_id}/gaps"): "candidate:owned",
    ("GET", "/api/v2/me/export"): "authenticated",
}
BODIES = {
    ("PATCH", "/api/v2/me"): {"locale": "en"},
    ("DELETE", "/api/v2/me"): {"password": "irrelevant password"},
    ("PUT", "/api/v2/me/consents/{purpose}"): {"granted": True},
    ("POST", "/api/v2/orgs"): {"name": "Matrix Org"},
    ("POST", "/api/v2/me/targets"): {"text": "Backend Developer\nRequired qualifications:\n- Python\n- Docker"},
    ("PUT", "/api/v2/me/cv/versions/{version_id}/review"): {"profile": {}},
    ("POST", "/api/v2/me/cv/versions/{version_id}/confirm"): {"warnings_acknowledged": True},
    ("PUT", "/api/v2/me/targets/{target_id}/requirements"): {"requirements": [{"id": "req-001", "text": "Python", "category": "technical_skill", "classification": "required"}]},
    ("POST", "/api/v2/auth/register"): {"email": "matrix@example.com", "password": "matrix password 1", "role": "candidate", "accept_terms": True},
    ("POST", "/api/v2/auth/login"): {"email": "matrix@example.com", "password": "x"},
    ("POST", "/api/v2/auth/verify-email"): {"token": "A" * 43},
    ("POST", "/api/v2/auth/verify-email/resend"): {"email": "matrix@example.com"},
    ("POST", "/api/v2/auth/password/forgot"): {"email": "matrix@example.com"},
    ("POST", "/api/v2/auth/password/reset"): {"token": "A" * 43, "password": "matrix password 1"},
}
SAFE = {"GET", "HEAD", "OPTIONS"}


def published_operations() -> set[tuple[str, str]]:
    return {(method.upper(), path) for path, item in app.openapi()["paths"].items() if path.startswith("/api/v2/") for method in item}


def operations(*kinds: str) -> list[tuple[str, str]]:
    return sorted(key for key, kind in POLICY.items() if kind.split(":")[0] in kinds)


def concrete(path: str, organization_id: object = None, owned: dict | None = None) -> str:
    owned = owned or {}
    url = path.replace("{organization_id}", str(organization_id or uuid.uuid4())).replace("{purpose}", "marketing")
    url = url.replace("{version_id}", str(owned.get("version_id") or uuid.uuid4())).replace("{target_id}", str(owned.get("target_id") or uuid.uuid4()))
    if path.endswith("/cv/diff"):
        version = owned.get("version_id") or uuid.uuid4()
        url += f"?from={version}&to={version}"
    return url


def call(client, method: str, path: str, organization_id: object = None, csrf: bool = True, owned: dict | None = None):
    url = concrete(path, organization_id, owned)
    body = BODIES.get((method, path))
    if method in SAFE:
        return client.request(method, url)
    if not csrf:
        return client.request(method, url, json=body)
    return unsafe(client, method, url, body)


def test_every_published_operation_has_an_explicit_policy():
    assert published_operations() == set(POLICY)
    assert {key for key, kind in POLICY.items() if kind == "public"} == PUBLIC_ROUTES


@pytest.mark.parametrize(("method", "path"), operations("authenticated", "recruiter", "candidate"))
def test_anonymous_callers_get_401(v2_client, method, path):
    response = call(v2_client, method, path)
    assert response.status_code == 401, response.text
    assert response.json()["detail"]["code"] == "not_authenticated"


@pytest.mark.parametrize(("method", "path"), sorted(key for key in POLICY if key[0] not in SAFE))
@pytest.mark.parametrize("signed_in", [False, True])
def test_unsafe_operations_without_csrf_get_403(v2_client, method, path, signed_in):
    if signed_in:
        sign_up(v2_client, "csrf-matrix@example.com", "recruiter")
    response = call(v2_client, method, path, csrf=False)
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "csrf_failed"


@pytest.fixture
def actors(v2_env):
    """Two recruiters in separate organizations and one candidate, each with their own cookies."""
    clients = {name: new_v2_client().__enter__() for name in ("recruiter_a", "recruiter_b", "candidate")}
    sign_up(clients["recruiter_a"], "a@example.com", "recruiter")
    sign_up(clients["recruiter_b"], "b@example.com", "recruiter")
    sign_up(clients["candidate"], "c@example.com", "candidate")
    org_a = unsafe(clients["recruiter_a"], "POST", "/api/v2/orgs", {"name": "Org A"}).json()
    org_b = unsafe(clients["recruiter_b"], "POST", "/api/v2/orgs", {"name": "Org B"}).json()
    yield clients, org_a, org_b
    for client in clients.values():
        client.__exit__(None, None, None)


@pytest.mark.parametrize(("method", "path"), operations("recruiter"))
def test_candidates_cannot_use_recruiter_routes(actors, method, path):
    clients, org_a, _ = actors
    response = call(clients["candidate"], method, path, org_a["id"])
    assert (response.status_code, response.json()["detail"]["code"]) == (403, "forbidden_role")


@pytest.mark.parametrize(("method", "path"), operations("candidate"))
def test_recruiters_cannot_use_candidate_routes(actors, method, path):
    clients, _, _ = actors
    response = call(clients["recruiter_a"], method, path)
    assert (response.status_code, response.json()["detail"]["code"]) == (403, "forbidden_role")


@pytest.mark.parametrize(("method", "path"), sorted(key for key, kind in POLICY.items() if kind == "recruiter:organization"))
def test_organizations_are_isolated_with_404(actors, method, path):
    clients, org_a, org_b = actors
    own = call(clients["recruiter_a"], method, path, org_a["id"])
    assert own.status_code == 200
    foreign = call(clients["recruiter_a"], method, path, org_b["id"])
    unknown = call(clients["recruiter_a"], method, path, uuid.uuid4())
    assert foreign.status_code == unknown.status_code == 404
    assert foreign.json() == unknown.json()  # Existence is not revealed.
    assert "Org B" not in foreign.text and "b@example.com" not in foreign.text


def test_organization_lists_only_show_own_memberships(actors):
    clients, org_a, org_b = actors
    assert [item["id"] for item in clients["recruiter_a"].get("/api/v2/orgs").json()] == [org_a["id"]]
    assert [item["id"] for item in clients["recruiter_b"].get("/api/v2/orgs").json()] == [org_b["id"]]
    members = clients["recruiter_a"].get(f"/api/v2/orgs/{org_a['id']}/members").json()
    assert [(item["email"], item["org_role"]) for item in members] == [("a@example.com", "owner")]


def test_account_routes_only_ever_return_the_callers_own_data(actors):
    clients, _, _ = actors
    for name, email in [("recruiter_a", "a@example.com"), ("recruiter_b", "b@example.com"), ("candidate", "c@example.com")]:
        assert clients[name].get("/api/v2/auth/me").json()["email"] == email
        assert email in clients[name].get("/api/v2/auth/me").text
    assert "a@example.com" not in clients["candidate"].get("/api/v2/me/consents").text


def test_malformed_identifiers_are_rejected_without_leaking(actors):
    clients, _, _ = actors
    response = clients["recruiter_a"].get("/api/v2/orgs/not-a-uuid")
    assert response.status_code == 422
    assert "not-a-uuid" not in response.text


@pytest.fixture
def candidates(v2_env):
    """Two candidates; the first has a CV version (with an original PDF) and a job post."""
    from conftest import SYNTHETIC_CVS, make_pdf
    from v2_helpers import upload_cv

    clients = {name: new_v2_client().__enter__() for name in ("owner", "other")}
    sign_up(clients["owner"], "owner@example.com", "candidate")
    sign_up(clients["other"], "other@example.com", "candidate")
    version = upload_cv(clients["owner"], make_pdf(SYNTHETIC_CVS[0]["text"])).json()
    target = unsafe(clients["owner"], "POST", "/api/v2/me/targets", BODIES[("POST", "/api/v2/me/targets")]).json()
    yield clients, {"version_id": version["id"], "target_id": target["id"]}
    for client in clients.values():
        client.__exit__(None, None, None)


@pytest.mark.parametrize(("method", "path"), sorted(key for key, kind in POLICY.items() if kind == "candidate:owned"))
def test_candidates_are_isolated_with_404(candidates, method, path):
    clients, owned = candidates
    foreign = call(clients["other"], method, path, owned=owned)
    unknown = call(clients["other"], method, path)
    assert foreign.status_code == unknown.status_code == 404, foreign.text
    assert foreign.json() == unknown.json()  # Existence is not revealed.
    assert "Avery" not in foreign.text and "Backend Developer" not in foreign.text
    if method in SAFE and not path.endswith("/original"):
        assert call(clients["owner"], method, path, owned=owned).status_code in {200, 409}


def test_recruiters_never_reach_candidate_content(candidates):
    """No recruiter route exposes a candidate's profile, even with the visibility opt-in (design §2.3)."""
    clients, owned = candidates
    assert unsafe(clients["owner"], "PUT", "/api/v2/me/consents/recruiter_visibility", {"granted": True}).status_code == 200
    with new_v2_client() as recruiter:
        sign_up(recruiter, "recruiter@example.com", "recruiter")
        organization = unsafe(recruiter, "POST", "/api/v2/orgs", {"name": "Hiring Org"}).json()
        for method, path in sorted(key for key, kind in POLICY.items() if key[0] in SAFE and kind.split(":")[0] in {"recruiter", "candidate", "authenticated"}):
            response = call(recruiter, method, path, organization["id"], owned=owned)
            assert "Avery" not in response.text and "owner@example.com" not in response.text, (method, path)
            if POLICY[(method, path)].startswith("candidate"):
                assert response.status_code == 403
