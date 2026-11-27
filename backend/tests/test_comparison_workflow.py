"""Source-bound review and comparison of fictional technical job descriptions."""

from copy import deepcopy

import pytest


def reviewed_payload(client, text):
    response = client.post("/api/v1/jobs/analyze", json={"text": text})
    assert response.status_code == 200
    analysis = response.json()
    requirements = [
        {key: item[key] for key in ("id", "text", "category", "classification")}
        for item in analysis["requirements"]
    ]
    candidate = {"technical_skills": [{"name": "Python", "category": "programming_language"}]}
    return {
        "candidate": candidate,
        "job_analysis": analysis,
        "requirements": requirements,
        "review": {
            "candidate_confirmed": True,
            "candidate_snapshot": deepcopy(candidate),
            "requirements_reviewed": True,
            "requirement_snapshot": deepcopy(requirements),
        },
    }


def update_review(body):
    body["review"]["requirement_snapshot"] = deepcopy(body["requirements"])


@pytest.mark.parametrize("heading,clause,skills", [
    ("Technical Environment", "api / Python knowledge required", {"API", "Python"}),
    ("Technical Environment", "ai / ml / Python knowledge required", {"AI", "Machine Learning", "Python"}),
    ("Environnement technique", "ia / ml / connaissance de Python obligatoire", {"AI", "Machine Learning", "Python"}),
    ("Technical Environment", "hld / lld / architecture knowledge required", {"HLD", "LLD"}),
])
def test_untouched_qualification_in_technical_section_compares(client, heading, clause, skills):
    text = f"Fictional Platform Engineer\n{heading}\n{clause}"
    body = reviewed_payload(client, text)
    original = body["job_analysis"]["requirements"][0]
    assert original["origin"] == "qualification"
    assert {item["name"] for item in original["technical_skills"]} == skills

    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 200, response.json()
    result = response.json()
    assert result["review_assertion"] == "unverified_client_assertion"
    row = result["comparisons"][0]
    assert row["original_requirement_text"] == clause
    assert row["origin"] == "qualification"
    assert row["job_evidence"] == original["evidence"]
    assert all(text[item["start"]:item["end"]] == item["quote"] for item in row["job_evidence"])


@pytest.mark.parametrize("clause", [
    "api / ai / ml / hld / lld",
    "Cloud / architectures applicatives / Data / AI",
    "Python / Azure OpenAI / RAG",
])
def test_reviewed_environment_only_source_remains_unspecified_needs_review(client, clause):
    body = reviewed_payload(client, f"Fictional Platform Engineer\nTechnical Environment\n{clause}")
    assert body["requirements"][0]["classification"] == "unspecified"
    assert body["job_analysis"]["requirements"][0]["origin"] == "technical_environment"
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 200, response.json()
    row = response.json()["comparisons"][0]
    assert row["classification"] == "unspecified"
    assert row["origin"] == "technical_environment"
    assert row["status"] == "needs_review"


@pytest.mark.parametrize("original,corrected", [
    ("API / Python knowledge required", "api / Python knowledge required"),
    ("api / Python knowledge required", "API / Python knowledge required"),
    ("ai / ml / Python knowledge required", "AI / Machine Learning / Python knowledge required"),
    ("PostgreSQL knowledge required", "Postgres knowledge required"),
])
def test_supported_case_and_alias_corrections_retain_source_proof(client, original, corrected):
    body = reviewed_payload(client, f"Fictional Platform Engineer\nTechnical Environment\n{original}")
    body["requirements"][0]["text"] = corrected
    update_review(body)
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 200, response.json()
    row = response.json()["comparisons"][0]
    assert row["requirement_text"] == corrected
    assert row["original_requirement_text"] == original
    assert row["job_evidence"] == body["job_analysis"]["requirements"][0]["evidence"]


@pytest.mark.parametrize("corrected", [
    "api / Python knowledge required / Java",
    "api / knowledge required",
    "api / Python knowledge required / 5 years of experience",
    "api / Python knowledge required / young applicants",
    "api / Python knowledge not required",
])
def test_contextual_alias_fix_does_not_allow_unsupported_or_excluded_edits(client, corrected):
    body = reviewed_payload(client, "Fictional Platform Engineer\nTechnical Environment\napi / Python knowledge required")
    body["requirements"][0]["text"] = corrected
    update_review(body)
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unsupported_correction"


def test_untouched_labels_still_require_fresh_original_source_analysis(client):
    body = reviewed_payload(client, "Fictional Platform Engineer\nTechnical Environment\napi / Python knowledge required")
    body["job_analysis"]["requirements"][0]["technical_skills"] = [{"name": "Python", "category": "programming_language"}]
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "source_mismatch"


@pytest.mark.parametrize("review_key", ["candidate_confirmed", "requirements_reviewed"])
def test_environment_workflow_rejects_missing_review_with_structured_error(client, review_key):
    body = reviewed_payload(client, "Fictional Platform Engineer\nTechnical Environment\napi / ai / Python")
    body["review"][review_key] = False
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "review_required",
        "message": "Confirm the reviewed candidate and review the extracted job requirements before comparison.",
    }


def test_environment_workflow_rejects_profile_edit_after_confirmation(client):
    body = reviewed_payload(client, "Fictional Platform Engineer\nTechnical Environment\napi / ai / Python")
    body["candidate"]["technical_skills"].append({"name": "Docker", "category": "cloud_devops"})
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "review_stale"


def test_environment_workflow_rejects_identity_in_qualification_payload(client):
    body = reviewed_payload(client, "Fictional Platform Engineer\nTechnical Environment\napi / ai / Python")
    body["candidate"]["full_name"] = "Fictional Candidate"
    body["review"]["candidate_snapshot"] = deepcopy(body["candidate"])
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    errors = response.json()["detail"]
    assert any(item["loc"] == ["body", "candidate", "full_name"] and item["type"] == "extra_forbidden" for item in errors)


@pytest.mark.parametrize("section,records,path", [
    ("education", [{"degree": "Fictional degree"}] * 101, ["education"]),
    ("experience", [{"technologies": ["Python"] * 101}], ["experience", 0, "technologies"]),
])
def test_overlong_qualification_lists_keep_structured_field_validation(client, section, records, path):
    body = reviewed_payload(client, "Fictional Platform Engineer\nTechnical Environment\napi / ai / Python")
    body["candidate"][section] = records
    body["review"]["candidate_snapshot"] = deepcopy(body["candidate"])
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    errors = response.json()["detail"]
    for prefix in (["body", "candidate"], ["body", "review", "candidate_snapshot"]):
        assert any(item["loc"] == prefix + path and item["type"] == "too_long" and item["ctx"]["max_length"] == 100 for item in errors)
