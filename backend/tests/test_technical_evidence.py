"""Fictional, exact-source technical mentions without qualification inference."""

from copy import deepcopy
import json
from pathlib import Path

from pydantic import ValidationError
import pytest

from app.models.job import JobComparisonResponse, TechnicalEvidence
from tests.test_jobs import payload, sync_review


def comparison(client, text, candidate):
    body = payload(text, candidate)
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 200, response.json()
    return response.json(), body


def evidence_by_name(data):
    return {item["name"]: item for item in data["technical_evidence"]}


def test_response_contract_accepts_prior_payload_without_optional_overview():
    original = {"comparisons": [], "warnings": []}
    response = JobComparisonResponse.model_validate(original)
    assert response.technical_evidence == []
    assert response.review_assertion == "unverified_client_assertion"
    assert response.method == "qualification-document-checklist-v1"


def test_fictional_architect_keeps_six_environment_rows_and_aggregates_mentions(client):
    cases = json.loads((Path(__file__).parent / "fixtures" / "jobs_realistic.json").read_text(encoding="utf-8"))["cases"]
    source = next(item["text"] for item in cases if item["id"] == "ai_architect_fr")
    candidate = {
        "projects": [{
            "name": "GraphRAG exploration",
            "description": "Developed RAG with LLMs and AI Agents.",
            "technologies": ["Python", "FastAPI", "Machine Learning", "MLflow"],
        }],
    }
    data, body = comparison(client, source, candidate)
    assert len(data["comparisons"]) == 6
    assert all(item["status"] == "needs_review" for item in data["comparisons"])
    assert all(item["classification"] == "unspecified" for item in data["comparisons"])
    overview = evidence_by_name(data)
    assert len(overview) == len(data["technical_evidence"]) == 18
    mentioned = {name for name, item in overview.items() if item["candidate_evidence"]}
    assert mentioned == {"RAG", "LLMs", "AI Agents", "Machine Learning", "MLflow"}
    assert "Python" not in overview  # A CV-only technology is not job evidence.
    assert "FastAPI" not in overview
    assert "GraphRAG" not in overview
    assert len(overview["AI"]["job_references"]) == 2
    assert all(item["requires_interpretation"] for item in overview.values())
    originals = {item["id"]: item for item in body["job_analysis"]["requirements"]}
    for item in overview.values():
        for reference in item["job_references"]:
            assert reference["evidence"] == originals[reference["requirement_id"]]["evidence"]
            assert reference["origin"] == "technical_environment"
            assert reference["classification"] == "unspecified"
            assert all(source[entry["start"]:entry["end"]] == entry["quote"] for entry in reference["evidence"])
        assert all(entry["unverified"] is True for entry in item["candidate_evidence"])


@pytest.mark.parametrize("generic,specific", [
    ("OpenAI", "Azure OpenAI"),
    ("Azure", "Azure AI"),
    ("RAG", "GraphRAG"),
    ("AI", "AI Agents"),
    ("API", "REST APIs"),
    ("Machine Learning", "MLOps"),
])
def test_longest_phrases_and_distinct_names_never_fabricate_overlap(client, generic, specific):
    text = f"Fictional Platform Engineer\nTechnical Environment\n{generic} / {specific}"
    candidate = {"projects": [{"description": f"A prototype using {specific}."}]}
    data, _ = comparison(client, text, candidate)
    overview = evidence_by_name(data)
    assert set(overview) == {generic, specific}
    assert overview[generic]["candidate_evidence"] == []
    assert overview[specific]["candidate_evidence"] == [{"field": "projects.0.description", "quote": f"A prototype using {specific}.", "unverified": True}]


def test_canonical_aliases_are_supported_without_changing_exact_profile_quotes(client):
    data, _ = comparison(client, "Backend Engineer\nRequired Skills\nPostgreSQL", {"technical_skills": [{"name": "Postgres", "category": "database"}]})
    item = evidence_by_name(data)["PostgreSQL"]
    assert item["candidate_evidence"] == [{"field": "technical_skills.0.name", "quote": "Postgres", "unverified": True}]
    assert item["requires_interpretation"] is False
    assert data["comparisons"][0]["status"] == "documented"


def test_repeated_job_mentions_deduplicate_technology_and_keep_every_source(client):
    text = "Backend Engineer\nRequired Skills\nPython\nPython / Docker\nPreferred Skills\nPython"
    candidate = {"technical_skills": [{"name": "Python", "category": "programming_language"}], "experience": [{"description": "Built services in Python."}]}
    data, _ = comparison(client, text, candidate)
    assert len(data["technical_evidence"]) == 2
    item = evidence_by_name(data)["Python"]
    assert [ref["requirement_id"] for ref in item["job_references"]] == ["req-001", "req-002", "req-003"]
    assert [ref["classification"] for ref in item["job_references"]] == ["required", "required", "preferred"]
    assert {entry["field"] for entry in item["candidate_evidence"]} == {"technical_skills.0.name", "experience.0.description"}
    assert item["requires_interpretation"] is False


def test_profile_field_paths_preserve_exact_unicode_quotes_and_structured_sources(client):
    candidate = {
        "experience": [{"job_title": "Machine Learning Engineer", "description": "Conçu des services Python.", "technologies": ["MLflow"]}],
        "projects": [{"name": "GraphRAG", "description": "Exploration RAG et LLMs.", "technologies": ["FastAPI"]}],
    }
    text = "Fictional AI Engineer\nTechnical Environment\nMachine Learning / Python / MLflow / GraphRAG / RAG / LLMs / FastAPI"
    data, _ = comparison(client, text, candidate)
    overview = evidence_by_name(data)
    expected = {
        "Machine Learning": ("experience.0.job_title", "Machine Learning Engineer"),
        "Python": ("experience.0.description", "Conçu des services Python."),
        "MLflow": ("experience.0.technologies.0", "MLflow"),
        "GraphRAG": ("projects.0.name", "GraphRAG"),
        "RAG": ("projects.0.description", "Exploration RAG et LLMs."),
        "LLMs": ("projects.0.description", "Exploration RAG et LLMs."),
        "FastAPI": ("projects.0.technologies.0", "FastAPI"),
    }
    for name, (field, quote) in expected.items():
        assert overview[name]["candidate_evidence"] == [{"field": field, "quote": quote, "unverified": True}]


@pytest.mark.parametrize("quote", [
    "Nationality Fictional; Python",
    "Python: email: fictional@example.com",
    "Python: contact https://example.com/person",
    "No Python experience",
    "I want to learn Python",
])
def test_overview_keeps_existing_private_protected_and_negated_evidence_exclusions(client, quote):
    candidate = {"experience": [{"description": quote}]}
    data, _ = comparison(client, "Backend Engineer\nRequired Skills\nPython", candidate)
    assert evidence_by_name(data)["Python"]["candidate_evidence"] == []
    assert quote not in json.dumps(data)
    assert data["comparisons"][0]["status"] == "not_documented"


def test_corrected_environment_classification_never_rewrites_original_job_reference(client):
    body = payload("Fictional Backend Engineer\nTechnical Environment\nPython")
    body["requirements"][0]["classification"] = "required"
    sync_review(body)
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 200
    data = response.json()
    assert data["comparisons"][0]["classification"] == "required"
    assert data["comparisons"][0]["status"] == "needs_review"
    item = evidence_by_name(data)["Python"]
    assert item["requires_interpretation"] is True
    assert item["job_references"][0]["classification"] == "unspecified"
    assert item["job_references"][0]["origin"] == "technical_environment"


@pytest.mark.parametrize("heading,clause,interpreted", [
    ("Required Skills", "Python", False),
    ("Qualifications", "Python", True),
    ("Required Skills", "Python or Java", True),
    ("Required Skills", "Advanced Python proficiency required", True),
])
def test_interpretation_flag_uses_source_and_actual_comparison_semantics(client, heading, clause, interpreted):
    data, _ = comparison(client, f"Backend Engineer\n{heading}\n{clause}", {"technical_skills": [{"name": "Python", "category": "programming_language"}]})
    assert evidence_by_name(data)["Python"]["requires_interpretation"] is interpreted


def test_nontechnical_requirements_return_empty_overview_without_inventing_technologies(client):
    data, _ = comparison(client, "Fictional Analyst\nRequired Skills\nDocumentation knowledge required", {"education": [{"degree": "Fictional degree"}]})
    assert len(data["comparisons"]) == 1
    assert data["technical_evidence"] == []


@pytest.mark.parametrize("tamper,code", [
    ("candidate_confirmed", "review_required"),
    ("requirements_reviewed", "review_required"),
    ("candidate_snapshot", "review_stale"),
    ("source_evidence", "source_mismatch"),
])
def test_technical_summary_does_not_bypass_review_or_source_validation(client, tamper, code):
    body = payload("Fictional Backend Engineer\nTechnical Environment\nPython / Docker")
    if tamper in {"candidate_confirmed", "requirements_reviewed"}:
        body["review"][tamper] = False
    elif tamper == "candidate_snapshot":
        body["candidate"]["technical_skills"].append({"name": "Docker", "category": "cloud_devops"})
    else:
        body["job_analysis"]["requirements"][0]["evidence"][0]["quote"] = "Fabricated source"
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert "technical_evidence" not in response.json()


def test_private_fields_still_rejected_in_unchanged_comparison_request(client):
    body = payload("Fictional Backend Engineer\nTechnical Environment\nPython")
    body["candidate"]["full_name"] = "Fictional Person"
    body["review"]["candidate_snapshot"] = deepcopy(body["candidate"])
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert any(item["loc"] == ["body", "candidate", "full_name"] and item["type"] == "extra_forbidden" for item in response.json()["detail"])


def test_new_response_models_reject_invented_fields_and_verified_evidence():
    valid = {
        "name": "Python", "category": "programming_language",
        "job_references": [{"requirement_id": "req-001", "origin": "technical_environment", "classification": "unspecified", "evidence": [{"quote": "Python", "start": 30, "end": 36}]}],
        "candidate_evidence": [{"field": "technical_skills.0.name", "quote": "Python", "unverified": True}],
        "requires_interpretation": True,
    }
    assert TechnicalEvidence.model_validate(valid).name == "Python"
    for mutation in ("score", "verified", "source", "identity"):
        value = deepcopy(valid)
        if mutation == "verified":
            value["candidate_evidence"][0]["unverified"] = False
        elif mutation == "source":
            value["job_references"][0]["origin"] = "inferred"
        elif mutation == "identity":
            value["candidate_evidence"][0]["email"] = "fictional@example.com"
        else:
            value["score"] = 99
        with pytest.raises(ValidationError):
            TechnicalEvidence.model_validate(value)


def test_lexical_overlap_does_not_document_experience_or_environment_qualifications(client):
    text = "Backend Engineer\nRequired Skills\n3 years of Python experience required\nTechnical Environment\nRAG / LLMs"
    candidate = {
        "technical_skills": [{"name": "Python", "category": "programming_language"}],
        "projects": [{"description": "Explored RAG with LLMs."}],
    }
    data, _ = comparison(client, text, candidate)
    assert [(item["category"], item["origin"], item["status"]) for item in data["comparisons"]] == [
        ("experience", "qualification", "not_documented"),
        ("technical_skill", "technical_environment", "needs_review"),
    ]
    # A lexical mention remains visible without upgrading either source clause
    # into a documented experience or mandatory environment qualification.
    overview = evidence_by_name(data)
    assert all(overview[name]["candidate_evidence"] for name in ("Python", "RAG", "LLMs"))
    assert data["comparisons"][0]["candidate_evidence"] == []
