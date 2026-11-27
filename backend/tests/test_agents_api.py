"""Local-only API isolation, retention, stale-state and privacy regressions."""

from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from uuid import uuid4

import pytest

from app.agents.checkpoints import MAX_BODY_BYTES, WorkflowManager
from app.main import app

ROOT = "/api/v1/agents/workflows"
HEADERS = {"X-Workflow-Session": "f" * 64}


def payload(client):
    analysis = client.post("/api/v1/jobs/analyze", json={"text": "Fictional Platform Engineer\nTechnical Environment\nPython / Airflow / GCP"}).json()
    candidate = {"technical_skills": [{"name": "Python", "category": "programming_language"}]}
    requirements = [{key: item[key] for key in ("id", "text", "classification", "category")} for item in analysis["requirements"]]
    return {"comparison": {"candidate": candidate, "job_analysis": analysis, "requirements": requirements,
        "review": {"candidate_confirmed": True, "candidate_snapshot": deepcopy(candidate), "requirements_reviewed": True, "requirement_snapshot": deepcopy(requirements)}},
        "request_revision": "test-revision", "client_request_id": str(uuid4())}


def resume_payload(body, waiting):
    return {"acknowledged": True, "request_revision": body["request_revision"], "snapshot_hash": waiting["snapshot_hash"], "comparison": body["comparison"]}


def test_complete_api_uses_actual_interrupt_then_finalizes_and_read_report_is_stable(client):
    body = payload(client)
    response = client.post(ROOT, headers=HEADERS, json=body)
    assert response.status_code == 201, response.text
    waiting = response.json()
    assert response.headers["cache-control"] == "no-store"
    path = f"{ROOT}/{waiting['workflow_id']}"
    entry = app.state.workflow_manager.entries[waiting["workflow_id"]]
    checkpoint = entry.graph.get_state(entry.config)
    assert checkpoint.next == ("human_review",) and checkpoint.tasks[0].interrupts
    assert client.get(path, headers=HEADERS).json() == waiting
    assert client.get(path + "/review", headers=HEADERS).json() == waiting
    assert client.get(path + "/report", headers=HEADERS).status_code == 409
    completed = client.post(path + "/resume", headers=HEADERS, json=resume_payload(body, waiting))
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"
    assert completed.json()["comparison"] == waiting["comparison"]
    assert client.get(path + "/report", headers=HEADERS).json() == completed.json()
    assert client.get(path + "/report", headers=HEADERS).json() == completed.json()
    assert client.post(path + "/resume", headers=HEADERS, json=resume_payload(body, waiting)).status_code == 409
    assert client.post(path + "/cancel", headers=HEADERS).status_code == 409
    assert not list(entry.checkpointer.list(entry.config))


def test_start_idempotency_does_not_execute_twice(client):
    body = payload(client)
    first = client.post(ROOT, headers=HEADERS, json=body)
    second = client.post(ROOT, headers=HEADERS, json=body)
    assert first.status_code == second.status_code == 201
    assert first.json() == second.json()
    assert len(app.state.workflow_manager.entries) == 1


@pytest.mark.parametrize("token", [None, "", "short", "!" * 64])
def test_missing_or_malformed_session_capability_cannot_start(client, token):
    response = client.post(ROOT, headers={} if token is None else {"X-Workflow-Session": token}, json=payload(client))
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "workflow_session_required"
    assert not app.state.workflow_manager.entries


@pytest.mark.parametrize("method,suffix", [("GET", ""), ("GET", "/review"), ("GET", "/report"), ("POST", "/resume"), ("POST", "/cancel")])
def test_uuid_is_not_authorization_wrong_owner_sees_no_workflow(client, method, suffix):
    body = payload(client)
    waiting = client.post(ROOT, headers=HEADERS, json=body).json()
    response = client.request(method, ROOT + "/" + waiting["workflow_id"] + suffix,
        headers={"X-Workflow-Session": "b" * 64}, json=resume_payload(body, waiting) if suffix == "/resume" else None)
    assert response.status_code == 404
    assert "comparison" not in response.text
    assert client.get(ROOT + "/" + str(uuid4()), headers=HEADERS).status_code == 404


@pytest.mark.parametrize("headers", [
    {"Host": "public.example"}, {"Host": "localhost.evil.example"},
    {"Origin": "https://public.example"}, {"Origin": "null"},
    {"Origin": "http://localhost.evil.example:5173"},
    {"Origin": "http://user@localhost:5173"}, {"Origin": "http://localhost:5173/path"},
])
def test_public_hosts_or_origins_are_rejected_before_processing(client, headers):
    response = client.post(ROOT, headers={**HEADERS, **headers}, json=payload(client))
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "local_workflow_only"
    assert not app.state.workflow_manager.entries


def test_local_origin_and_custom_session_header_pass_cors(client):
    response = client.options(ROOT, headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-workflow-session"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_body_limit_precedes_json_parse_and_does_not_rely_on_content_length(client):
    response = client.post(ROOT, headers={**HEADERS, "Content-Type": "application/json"}, content=b"x" * (MAX_BODY_BYTES + 1))
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "workflow_request_too_large"
    assert not app.state.workflow_manager.entries


def test_invalid_json_and_unknown_identity_fields_get_structured_redacted_validation(client):
    body = payload(client)
    body["comparison"]["candidate"]["full_name"] = "Fictional private identity never echoed"
    response = client.post(ROOT, headers=HEADERS, json=body)
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "workflow_validation"
    assert any(item["type"] == "extra_forbidden" for item in detail["errors"])
    assert "private identity" not in response.text
    malformed = client.post(ROOT, headers={**HEADERS, "Content-Type": "application/json"}, content=b'{"candidate":"fictional private value",')
    assert malformed.status_code == 422
    assert "fictional private value" not in malformed.text
    assert not app.state.workflow_manager.entries


@pytest.mark.parametrize("value", ["Email: fictional@example.test", "See https://example.test/fictional", "+1 202 555 0142", "202-555-0142", "0612345678", "06 12 34 56 78", "Nationality: fictional", "Date of birth: fictional"])
def test_obvious_personal_data_in_free_fields_rejected_before_checkpoint_creation(client, value):
    body = payload(client)
    body["comparison"]["candidate"]["projects"] = [{"description": value}]
    body["comparison"]["review"]["candidate_snapshot"] = deepcopy(body["comparison"]["candidate"])
    response = client.post(ROOT, headers=HEADERS, json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "privacy_boundary"
    assert value not in response.text
    assert not app.state.workflow_manager.entries


def test_review_acknowledgment_must_be_explicit_true_and_cannot_replace_evidence(client):
    body = payload(client)
    waiting = client.post(ROOT, headers=HEADERS, json=body).json()
    path = ROOT + "/" + waiting["workflow_id"] + "/resume"
    resume = resume_payload(body, waiting)
    resume["acknowledged"] = False
    assert client.post(path, headers=HEADERS, json=resume).status_code == 422
    resume["acknowledged"] = True
    resume["comparison_result"] = {"invented": "value"}
    assert client.post(path, headers=HEADERS, json=resume).status_code == 422
    assert app.state.workflow_manager.get(waiting["workflow_id"], HEADERS["X-Workflow-Session"]).status == "waiting_for_review"


def test_concurrent_resume_only_finalizes_once(client):
    body = payload(client)
    waiting = client.post(ROOT, headers=HEADERS, json=body).json()
    path = ROOT + "/" + waiting["workflow_id"] + "/resume"
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(client.post, path, headers=HEADERS, json=resume_payload(body, waiting)) for _ in range(2)]
        responses = [future.result() for future in futures]
    assert sorted(response.status_code for response in responses) == [200, 409]
    report = client.get(ROOT + "/" + waiting["workflow_id"] + "/report", headers=HEADERS).json()
    assert report["status"] == "completed"
    assert len(report["steps"]) == 7 and all(step["status"] == "completed" for step in report["steps"])


def test_cancel_is_idempotent_removes_all_input_result_and_checkpoint_data(client):
    body = payload(client)
    waiting = client.post(ROOT, headers=HEADERS, json=body).json()
    path = ROOT + "/" + waiting["workflow_id"]
    cancelled = client.post(path + "/cancel", headers=HEADERS)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert cancelled.json()["comparison"] is None
    assert client.post(path + "/cancel", headers=HEADERS).json() == cancelled.json()
    assert client.post(path + "/resume", headers=HEADERS, json=resume_payload(body, waiting)).status_code == 410
    assert client.get(path + "/review", headers=HEADERS).status_code == 410
    assert client.get(path + "/report", headers=HEADERS).status_code == 410
    entry = app.state.workflow_manager.entries[waiting["workflow_id"]]
    assert "request" not in entry.state and "comparison_result" not in entry.state
    assert not list(entry.checkpointer.list(entry.config))
    assert not entry.graph.get_state(entry.config).values


def test_expiration_active_cleanup_physically_purges_then_returns_actionable_state(client):
    now = [1000.0]
    app.state.workflow_manager = WorkflowManager(ttl_seconds=30, clock=lambda: now[0])
    body = payload(client)
    waiting = client.post(ROOT, headers=HEADERS, json=body).json()
    entry = app.state.workflow_manager.entries[waiting["workflow_id"]]
    assert list(entry.checkpointer.list(entry.config))
    now[0] += 31
    app.state.workflow_manager.cleanup()
    assert "request" not in entry.state and "comparison_result" not in entry.state
    assert not list(entry.checkpointer.list(entry.config))
    path = ROOT + "/" + waiting["workflow_id"]
    assert client.get(path, headers=HEADERS).json()["status"] == "expired"
    assert client.post(path + "/resume", headers=HEADERS, json=resume_payload(body, waiting)).status_code == 410
    assert client.get(path + "/report", headers=HEADERS).status_code == 410


def test_stale_client_revision_gets_clear_409_without_acknowledging_review(client):
    body = payload(client)
    waiting = client.post(ROOT, headers=HEADERS, json=body).json()
    resume = resume_payload(body, waiting)
    resume["request_revision"] = "new-version"
    response = client.post(ROOT + "/" + waiting["workflow_id"] + "/resume", headers=HEADERS, json=resume)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "workflow_stale"
    assert app.state.workflow_manager.get(waiting["workflow_id"], HEADERS["X-Workflow-Session"]).human_review_status == "required"
