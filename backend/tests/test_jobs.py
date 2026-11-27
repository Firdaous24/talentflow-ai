"""Fictional bilingual jobs and source/review/privacy regression contracts."""

from copy import deepcopy

import pytest

from app.models.job import JobComparisonRequest
from app.services.jobs import DeterministicJobAnalyzer, compare_job

ENGLISH = """Junior Python Developer
Company: Invented Lantern Labs
Location: Remote
Employment type: Full-time
About Us
Our internal systems use Java and MongoDB.
Responsibilities
- Build dashboards with Tableau.
Required Skills
- Python and Postgres
- SQL
Preferred Qualifications
- Docker
Education
- Bachelor degree in Computer Science required.
"""

FRENCH = """Développeuse backend
Entreprise: Atelier Fiction
Lieu: Rabat
Type de contrat: CDI
Missions
- Développer des interfaces React.
Compétences requises
- Python et FastAPI
- PostgreSQL
Compétences souhaitées
- K8s et Docker
Formation
- Master en informatique requis.
"""


def payload(text=ENGLISH, candidate=None):
    analysis = DeterministicJobAnalyzer().analyze(text).model_dump(mode="json")
    reviewed = [{key: item[key] for key in ("id", "text", "category", "classification")} for item in analysis["requirements"]]
    candidate = candidate or {"technical_skills": [{"name": "Python", "category": "programming_language"}, {"name": "PostgreSQL", "category": "database"}], "education": [{"degree": "Bachelor", "field_of_study": "Computer Science"}]}
    return {"candidate": candidate, "job_analysis": analysis, "requirements": reviewed, "review": {"candidate_confirmed": True, "candidate_snapshot": deepcopy(candidate), "requirements_reviewed": True, "requirement_snapshot": deepcopy(reviewed)}}


def sync_review(body):
    body["review"]["candidate_snapshot"] = deepcopy(body["candidate"])
    body["review"]["requirement_snapshot"] = deepcopy(body["requirements"])


def test_english_metadata_source_and_requirements(client):
    result = client.post("/api/v1/jobs/analyze", json={"text": ENGLISH})
    assert result.status_code == 200
    data = result.json()
    assert data["job"]["title"] == "Junior Python Developer"
    assert data["job"]["company"] == "Invented Lantern Labs"
    assert data["job"]["location"] == "Remote"
    assert data["job"]["employment_type"] == "Full-time"
    assert data["job"]["responsibilities"] == ["Build dashboards with Tableau."]
    assert [item["classification"] for item in data["requirements"]] == ["required", "required", "preferred", "required"]
    assert {skill["name"] for item in data["requirements"] for skill in item["technical_skills"]} == {"Python", "PostgreSQL", "SQL", "Docker"}
    for item in data["requirements"]:
        for evidence in item["evidence"]:
            assert ENGLISH[evidence["start"]:evidence["end"]] == evidence["quote"]


def test_french_headings_accents_and_aliases(client):
    data = client.post("/api/v1/jobs/analyze", json={"text": FRENCH}).json()
    assert data["job"]["title"] == "Développeuse backend"
    assert data["job"]["company"] == "Atelier Fiction"
    assert data["requirements"][2]["classification"] == "preferred"
    assert [skill["name"] for skill in data["requirements"][2]["technical_skills"]] == ["Docker", "Kubernetes"]
    assert all(FRENCH[entry["start"]:entry["end"]] == entry["quote"] for row in data["requirements"] for entry in row["evidence"])


def test_missing_metadata_no_inferred_education_or_duration():
    result = DeterministicJobAnalyzer().analyze("Senior Python Engineer\nRequired Skills\nPython")
    assert result.job.company is result.job.location is result.job.employment_type is None
    assert len(result.requirements) == 1
    assert result.requirements[0].category == "technical_skill"
    assert "year" not in result.requirements[0].text


def test_generic_qualification_heading_does_not_invent_required():
    result = DeterministicJobAnalyzer().analyze("Backend Engineer\nQualifications\nPython\nDocker preferred")
    assert [item.classification for item in result.requirements] == ["unspecified", "preferred"]


def test_explicit_line_classification_overrides_heading():
    result = DeterministicJobAnalyzer().analyze("Backend Engineer\nRequired Skills\nDocker preferred\nPython required and preferred")
    assert [item.classification for item in result.requirements] == ["preferred", "unspecified"]
    assert result.requirements[1].warnings


def test_inline_heading_crlf_emoji_and_split_clauses_exact_offsets():
    text = "Backend Engineer 😀\r\nRequired Skills: Python required; Docker preferred.\r\n"
    result = DeterministicJobAnalyzer().analyze(text)
    assert len(result.requirements) == 2
    assert [item.classification for item in result.requirements] == ["required", "preferred"]
    assert all(text[evidence.start:evidence.end] == evidence.quote for row in result.requirements for evidence in row.evidence)


def test_responsibility_only_qualifies_when_explicitly_mandatory():
    result = DeterministicJobAnalyzer().analyze("Backend Engineer\nResponsibilities\nBuild services in Python.\nPython knowledge is required.")
    assert [item.text for item in result.requirements] == ["Python knowledge is required."]
    assert result.job.responsibilities == ["Build services in Python."]


@pytest.mark.parametrize("clause", ["Female applicants required", "Applicants must be under 30 years of age", "French nationality required", "Native English speaker required", "A photo is mandatory", "Outgoing personality required", "Must be enthusiastic", "Cultural fit required", "Valid work permit required"])
def test_protected_and_irrelevant_clauses_are_excluded(clause):
    result = DeterministicJobAnalyzer().analyze(f"Backend Engineer\nRequired Skills\nPython\n{clause}")
    assert len(result.requirements) == 1
    assert result.requirements[0].text == "Python"
    assert any("excluded" in item for item in result.warnings)


def test_job_negation_and_contrast_are_conservative():
    result = DeterministicJobAnalyzer().analyze("Backend Engineer\nRequirements\nPython is not required but SQL is required.\nNo prior experience with Docker required.")
    assert [item.text for item in result.requirements] == ["SQL is required."]


def test_go_ordinary_verb_is_not_a_technical_alias():
    result = DeterministicJobAnalyzer().analyze("Backend Engineer\nRequirements\nGo to the office on Monday\nGo programming required")
    assert not result.requirements[0].technical_skills
    assert [skill.name for skill in result.requirements[1].technical_skills] == ["Go"]


@pytest.mark.parametrize("text", ["", "Python", " " * 50, "1" * 60, "x" * 30001, "Backend engineer job text\x00 with null bytes"])
def test_invalid_job_text(client, text):
    assert client.post("/api/v1/jobs/analyze", json={"text": text}).status_code == 422


def test_unknown_request_fields_are_rejected(client):
    assert client.post("/api/v1/jobs/analyze", json={"text": ENGLISH, "model": "fake"}).status_code == 422


def test_comparison_documented_missing_and_exact_education(client):
    response = client.post("/api/v1/jobs/compare", json=payload())
    assert response.status_code == 200
    data = response.json()
    assert [row["status"] for row in data["comparisons"]] == ["documented", "not_documented", "not_documented", "documented"]
    assert data["review_assertion"] == "unverified_client_assertion"
    assert all(entry["unverified"] for row in data["comparisons"] for entry in row["candidate_evidence"])
    assert "Computer Science" in [entry["quote"] for entry in data["comparisons"][3]["candidate_evidence"]]
    assert not {"score", "ranking", "fit", "recommendation", "eligible"} & data.keys()


def test_skill_alias_in_candidate_and_corrected_label_supported():
    body = payload("Backend Engineer\nRequired Skills\nPostgreSQL", {"technical_skills": [{"name": "Postgres", "category": "database"}]})
    body["requirements"][0]["text"] = "Postgres required"
    body["requirements"][0]["classification"] = "preferred"
    sync_review(body)
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].status == "documented"
    assert result.comparisons[0].original_requirement_text == "PostgreSQL"
    assert result.comparisons[0].requirement_text == "Postgres required"
    assert result.comparisons[0].review_notes


@pytest.mark.parametrize("text", ["Strong Python proficiency required", "Python or Java required", "3 years of Python experience required"])
def test_ambiguity_proficiency_and_duration_need_review(text):
    body = payload(f"Backend Engineer\nRequired Skills\n{text}", {"experience": [{"job_title": "Python developer", "description": "Built Python services"}], "technical_skills": [{"name": "Python", "category": "programming_language"}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].status == "needs_review"
    assert result.comparisons[0].candidate_evidence


@pytest.mark.parametrize("quote", ["No Python experience", "Does not know Python", "I want to learn Python", "Sans maîtrise de Python", "Je ne connais pas Python", "Python: not proficient"])
def test_negated_or_aspirational_candidate_mentions_are_not_documented(quote):
    body = payload("Backend Engineer\nRequired Skills\nPython", {"experience": [{"description": quote}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].status == "not_documented"
    assert result.comparisons[0].candidate_evidence == []


def test_mixed_qualification_cannot_be_downgraded_into_documented_skill():
    body = payload("Backend Engineer\nRequired Skills\nPython and Bachelor degree required", {"technical_skills": [{"name": "Python", "category": "programming_language"}]})
    body["requirements"][0]["category"] = "technical_skill"
    body["requirements"][0]["text"] = "Python required"
    sync_review(body)
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].status == "needs_review"
    assert "Bachelor" in result.comparisons[0].job_evidence[0].quote


@pytest.mark.parametrize("review_key", ["candidate_confirmed", "requirements_reviewed"])
def test_unreviewed_workflow_is_rejected(client, review_key):
    body = payload()
    body["review"][review_key] = False
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "review_required"


@pytest.mark.parametrize("changed", ["candidate", "requirements"])
def test_stale_review_snapshot_is_rejected(client, changed):
    body = payload()
    if changed == "candidate":
        body["candidate"]["technical_skills"].append({"name": "Docker", "category": "cloud_devops"})
    else:
        body["requirements"][0]["classification"] = "preferred"
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "review_stale"


@pytest.mark.parametrize("tamper", ["quote", "offset", "classification", "metadata"])
def test_original_source_tampering_is_rejected(client, tamper):
    body = payload()
    if tamper == "quote":
        body["job_analysis"]["requirements"][0]["evidence"][0]["quote"] = "Fabricated evidence"
    elif tamper == "offset":
        body["job_analysis"]["requirements"][0]["evidence"][0]["start"] += 1
    elif tamper == "classification":
        body["job_analysis"]["requirements"][0]["classification"] = "preferred"
    else:
        body["job_analysis"]["job"]["company"] = "Fabricated Company"
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "source_mismatch"


@pytest.mark.parametrize("correction", ["Python and Java required", "Python and 15 years experience required", "Python and Master degree required", "Python and English required", "Python and female applicants required"])
def test_source_unsupported_requirement_correction_is_rejected(client, correction):
    body = payload("Backend Engineer\nRequired Skills\nPython")
    body["requirements"][0]["text"] = correction
    sync_review(body)
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unsupported_correction"


def test_unsupported_category_correction_is_rejected(client):
    body = payload("Backend Engineer\nRequired Skills\nPython")
    body["requirements"][0]["category"] = "education"
    sync_review(body)
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "unsupported_category"


@pytest.mark.parametrize("personal_field,value", [("full_name", "Fictional Person"), ("email", "synthetic@example.test"), ("nationality", "Fictional")])
def test_candidate_personal_fields_rejected(client, personal_field, value):
    body = payload()
    body["candidate"][personal_field] = value
    sync_review(body)
    assert client.post("/api/v1/jobs/compare", json=body).status_code == 422


def test_nested_employer_url_and_dates_rejected(client):
    body = payload()
    body["candidate"]["experience"] = [{"job_title": "Developer", "company": "Identity-linked company", "start_date": "2020"}]
    body["candidate"]["projects"] = [{"name": "Project", "github_url": "https://github.com/person/project"}]
    sync_review(body)
    assert client.post("/api/v1/jobs/compare", json=body).status_code == 422


def test_protected_candidate_free_text_never_returned_as_evidence():
    body = payload("Backend Engineer\nRequired Skills\nPython", {"experience": [{"description": "Nationality Fictional; Python"}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].candidate_evidence == []
    assert result.comparisons[0].status == "not_documented"


def test_duplicate_and_unknown_requirement_ids_rejected(client):
    body = payload()
    body["requirements"].append(deepcopy(body["requirements"][0]))
    sync_review(body)
    assert client.post("/api/v1/jobs/compare", json=body).json()["detail"]["code"] == "duplicate_requirement"
    body["requirements"][-1]["id"] = "req-099"
    sync_review(body)
    assert client.post("/api/v1/jobs/compare", json=body).json()["detail"]["code"] == "unknown_requirement"


def test_exact_certification_name_documents_an_unverified_statement():
    body = payload("Backend Engineer\nRequired Skills\nITIL Foundation certification required", {"certifications": [{"name": "ITIL Foundation"}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].status == "documented"
    assert result.comparisons[0].candidate_evidence[0].field == "certifications.0.name"


def test_partial_certification_name_does_not_document_an_advanced_tier():
    body = payload("Backend Engineer\nCertifications\nITIL Foundation Practitioner certification required", {"certifications": [{"name": "ITIL Foundation"}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].status == "needs_review"
    assert result.comparisons[0].candidate_evidence[0].quote == "ITIL Foundation"


@pytest.mark.parametrize("quote", ["Python; email: fictional@example.com", "Python: contact https://example.com/person"])
def test_contact_information_in_free_text_is_excluded_from_evidence(quote):
    body = payload("Backend Engineer\nRequired Skills\nPython", {"experience": [{"description": quote}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].candidate_evidence == []


@pytest.mark.parametrize("source", ["We do not require a degree or years of experience.", "Nous ne demandons pas de diplôme.", "Habiter dans un quartier précis."])
def test_negative_and_residence_statements_are_not_requirements(source):
    result = DeterministicJobAnalyzer().analyze(f"Backend Engineer\nRequirements\nPython required\n{source}")
    assert [item.text for item in result.requirements] == ["Python required"]


@pytest.mark.parametrize("degree", ["Bachelor", "Bachelor's", "Bachelor’s"])
def test_possessive_degree_grammar_is_normalized_without_equivalence(degree):
    body = payload("Backend Engineer\nEducation\nBachelor’s degree in Computer Science required", {"education": [{"degree": degree, "field_of_study": "Computer Science"}]})
    assert compare_job(JobComparisonRequest.model_validate(body)).comparisons[0].status == "documented"


def test_language_level_needs_review_and_plain_language_documented():
    body = payload("Backend Engineer\nRequirements\nEnglish required\nFrench B2 required", {"languages": [{"name": "English"}, {"name": "French", "proficiency": "B2"}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert [item.status for item in result.comparisons] == ["documented", "needs_review"]


def test_capabilities_and_openapi(client):
    response = client.get("/api/v1/jobs/capabilities")
    assert response.status_code == 200
    capabilities = response.json()
    assert capabilities["review_assertion"] == "unverified_client_assertion"
    assert capabilities["authenticated_approval"] is False
    assert capabilities["persistence"] == "none"
    assert capabilities["external_model_calls"] is False
    assert {"/api/v1/jobs/analyze", "/api/v1/jobs/compare", "/api/v1/jobs/capabilities"} <= client.get("/openapi.json").json()["paths"].keys()
