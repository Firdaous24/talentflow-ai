"""Fictional post formatting, distinct technical concepts and source review."""

import pytest

from app.models.job import JobComparisonRequest
from app.services.jobs import DeterministicJobAnalyzer, compare_job, skills_in
from tests.test_jobs import payload, sync_review

ENVIRONMENT_HEADINGS = [
    "Environnement technique", "Stack technique", "Technologies", "Technologies utilisées", "Outils et technologies",
    "Technical Environment", "Technology Stack", "Tech Stack", "Tools and Technologies",
]
QUALIFICATION_HEADINGS = [
    ("Compétences techniques", "unspecified"), ("Compétences recherchées", "unspecified"),
    ("Profil recherché", "unspecified"), ("Votre profil", "unspecified"), ("Prérequis", "required"),
    ("Exigences", "unspecified"), ("Compétences obligatoires", "required"), ("Compétences souhaitées", "preferred"),
    ("Atouts", "preferred"), ("Required Skills", "required"), ("Preferred Skills", "preferred"), ("Must Have", "required"),
    ("Nice to Have", "preferred"), ("Qualifications", "unspecified"), ("Requirements", "unspecified"), ("Desired Qualifications", "preferred"),
]


@pytest.mark.parametrize("heading", ENVIRONMENT_HEADINGS)
@pytest.mark.parametrize("decoration", ["{}", "🧩 {} :", "2. {}!", "## {} —"])
def test_environment_headings_decorations_and_exact_offsets(heading, decoration):
    text = f"Integration Architect\r\n{decoration.format(heading.upper())}\r\n• Azure OpenAI / RAG / API\r\nMissions\r\nProduire les documents internes."
    analysis = DeterministicJobAnalyzer().analyze(text)
    assert len(analysis.requirements) == 1
    item = analysis.requirements[0]
    assert item.origin == "technical_environment"
    assert item.classification == "unspecified"
    assert {skill.name for skill in item.technical_skills} == {"Azure OpenAI", "RAG", "API"}
    assert item.evidence[0].quote == "Azure OpenAI / RAG / API"
    assert text[item.evidence[0].start:item.evidence[0].end] == item.evidence[0].quote
    assert analysis.job.responsibilities == ["Produire les documents internes."]


@pytest.mark.parametrize("heading,classification", QUALIFICATION_HEADINGS)
def test_qualification_headings_preserve_explicit_status(heading, classification):
    analysis = DeterministicJobAnalyzer().analyze(f"Backend Engineer\n✅ {heading}:\nPython / Docker")
    assert len(analysis.requirements) == 1
    assert analysis.requirements[0].origin == "qualification"
    assert analysis.requirements[0].classification == classification


def test_heading_in_ordinary_prose_does_not_reopen_company_section():
    text = "Backend Engineer\nRequired Skills\nPython\nAbout us\nTech Stack is a brochure about Azure.\nOur Requirements: Java is our internal product.\nPreferred Skills\nDocker"
    assert [item.text for item in DeterministicJobAnalyzer().analyze(text).requirements] == ["Python", "Docker"]


def test_inline_heading_retains_source_and_explicit_qualification_in_environment():
    text = "AI Engineer\n🛠 Technologies utilisées: Azure AI | Azure OpenAI\nPython knowledge is required."
    rows = DeterministicJobAnalyzer().analyze(text).requirements
    assert [(row.origin, row.classification) for row in rows] == [("technical_environment", "unspecified"), ("qualification", "required")]
    assert all(text[entry.start:entry.end] == entry.quote for row in rows for entry in row.evidence)


def test_runtime_dependency_is_environment_but_explicit_candidate_qualification_is_not():
    text = "AI Engineer\nTechnical Environment\nAzure OpenAI is required for our application deployment.\nPython proficiency required.\nCandidates must know RAG."
    rows = DeterministicJobAnalyzer().analyze(text).requirements
    assert [(item.origin, item.classification) for item in rows] == [("technical_environment", "unspecified"), ("qualification", "required"), ("qualification", "required")]


def test_apply_verb_inside_explicit_knowledge_qualification_is_preserved():
    text = "Backend Engineer\nRequired Skills\nKnowledge of how to apply Python is required."
    rows = DeterministicJobAnalyzer().analyze(text).requirements
    assert len(rows) == 1
    assert rows[0].classification == "required"


@pytest.mark.parametrize("heading", ["1 - Tech Stack", "+++ Technical Environment +++", "Tech Stack | Python", "🛠 Environnement technique ➡ Python"])
def test_more_punctuation_and_inline_list_headings(heading):
    inline = "Python" in heading
    text = f"Prototype Engineer\n{heading}" + ("" if inline else "\nPython")
    result = DeterministicJobAnalyzer().analyze(text)
    assert len(result.requirements) == 1
    assert result.requirements[0].origin == "technical_environment"
    assert result.requirements[0].text == "Python"


@pytest.mark.parametrize("delimiter", [" ➡ ", " | ", " -> "])
def test_inline_metadata_split_and_detailed_hybrid_schedule(delimiter):
    schedule = "Le premier mois sera réalisé en présentiel. À partir du deuxième mois, fonctionnement hybride."
    text = f"Poste: Architecte IA\nRabat/Technopolis{delimiter}Contrat: CDI{delimiter}Mode de travail: {schedule}\nEnvironnement technique\nOpenAI"
    job = DeterministicJobAnalyzer().analyze(text).job
    assert (job.location, job.employment_type, job.work_mode) == ("Rabat/Technopolis", "CDI", "Hybrid")
    assert job.metadata_evidence["work_mode"][0].quote == schedule
    assert all(text[entry.start:entry.end] == entry.quote for entries in job.metadata_evidence.values() for entry in entries)


def test_adjacent_labeled_metadata_without_delimiters():
    text = "Backend Engineer\nLocation: Bristol Contract: Permanent Work mode: Remote\nRequired Skills\nPython"
    job = DeterministicJobAnalyzer().analyze(text).job
    assert (job.location, job.employment_type, job.work_mode) == ("Bristol", "Permanent", "Remote")


@pytest.mark.parametrize("wording", ["To discuss", "À discuter avec l'équipe.", "Remote or on-site", "Hybrid or remote", "Hybride ou présentiel", "Possibly hybrid", "Not remote", "Sans télétravail", "Hybrid working is not offered.", "Le travail hybride est exclu.", "Télétravail possible selon les besoins."])
def test_unclear_and_negated_work_modes_remain_null(wording):
    result = DeterministicJobAnalyzer().analyze(f"Backend Engineer\nWork mode: {wording}\nRequired Skills\nPython")
    assert result.job.work_mode is None
    assert result.job.metadata_evidence["work_mode"][0].quote == wording
    assert any("work mode" in warning for warning in result.warnings)


def test_location_remote_does_not_infer_work_arrangement():
    job = DeterministicJobAnalyzer().analyze("Backend Engineer\nLocation: Remote\nRequired Skills\nPython").job
    assert job.location == "Remote"
    assert job.work_mode is None


@pytest.mark.parametrize("metadata", ["Location: Paris\nLocation: Lyon", "Location: Paris | Location: Lyon", "Location: Paris\nLocation: Lyon\nLocation: Paris"])
def test_conflicting_metadata_stays_null_and_retains_both_sources(metadata):
    text = f"Backend Engineer\n{metadata}\nRequired Skills\nPython"
    result = DeterministicJobAnalyzer().analyze(text)
    assert result.job.location is None
    assert {entry.quote for entry in result.job.metadata_evidence["location"]} == {"Paris", "Lyon"}
    assert any("Conflicting location" in warning for warning in result.warnings)


@pytest.mark.parametrize("line", ["Location: email@example.com", "Send your CV to Paris | Contract: CDI", "Contact: London", "Contact email: London@example.com", "Azure OpenAI ➡ Contract: CDI", "API / Microservices | Contract: CDI", "Great opportunity ➡ Contract: permanent", "Rejoignez Nova Exemple ➡ Contrat: CDI"])
def test_contact_and_application_text_is_not_location(line):
    job = DeterministicJobAnalyzer().analyze(f"Backend Engineer\n{line}\nRequired Skills\nPython").job
    assert job.location is None


@pytest.mark.parametrize("line", ["Envoyez votre CV à Python@example.com", "#Python #Azure #AI", "Apply using our Python form", "J'ai participé à une réunion de présentation.", "La plateforme Imaginium figure dans notre brochure interne.", "J'ai utilisé Python pour ce projet.", "Our company uses Java and Docker."])
def test_post_noise_does_not_create_qualifications(line):
    result = DeterministicJobAnalyzer().analyze(f"Backend Engineer\nVotre profil\nPython\n{line}")
    assert [item.text for item in result.requirements] == ["Python"]


@pytest.mark.parametrize("phrase,expected", [
    ("Azure OpenAI", {"Azure OpenAI"}), ("Azure AI", {"Azure AI"}), ("Microsoft Azure", {"Azure"}),
    ("Generative AI", {"Generative AI"}), ("AI Agents", {"AI Agents"}), ("AI Workflows", {"AI Workflows"}),
    ("Machine Learning", {"Machine Learning"}), ("ML", {"Machine Learning"}), ("MLOps", {"MLOps"}),
    ("REST APIs", {"REST APIs"}), ("API", {"API"}), ("HLD / LLD", {"HLD", "LLD"}),
    ("Cloud Computing", {"Cloud Computing"}), ("Microservices", {"Microservices"}),
])
def test_longest_aliases_keep_distinct_concepts(phrase, expected):
    assert {skill.name for skill in skills_in(phrase)} == expected


@pytest.mark.parametrize("phrase", ["J'ai utilisé ce portail.", "There is a cloud of uncertainty.", "Add 10 ml of liquid.", "OpenAIs and microservicesque", "#API #Python", "https://example.com/API/Python"])
def test_tokens_and_context_avoid_prose_false_positives(phrase):
    assert skills_in(phrase) == []


def test_lowercase_french_ai_verb_is_excluded_even_in_technical_environment():
    assert skills_in("J'ai présenté le projet", technical_context=True) == []


def test_technical_section_does_not_make_cloud_metaphor_a_technology():
    assert skills_in("There is a cloud of uncertainty.", technical_context=True) == []
    assert {item.name for item in skills_in("Cloud / AI", technical_context=True)} == {"Cloud Computing", "AI"}


@pytest.mark.parametrize("required", ["OpenAI", "Azure", "AI"])
def test_nested_azure_service_cannot_document_different_requirement(required):
    body = payload(f"AI Engineer\nRequired Skills\n{required}", {"technical_skills": [{"name": "Azure OpenAI", "category": "ai_ml"}]})
    result = compare_job(JobComparisonRequest.model_validate(body))
    assert result.comparisons[0].status == "not_documented"


def test_environment_review_classification_cannot_establish_required_qualification(client):
    body = payload("Prototype AI Engineer\nTech Stack\nPython", {"technical_skills": [{"name": "Python", "category": "programming_language"}]})
    body["requirements"][0]["classification"] = "required"
    sync_review(body)
    response = client.post("/api/v1/jobs/compare", json=body)
    assert response.status_code == 200
    row = response.json()["comparisons"][0]
    assert row["origin"] == "technical_environment"
    assert row["status"] == "needs_review"
    assert row["candidate_evidence"]
    assert any("does not turn" in note for note in row["review_notes"])


@pytest.mark.parametrize("tamper", ["origin", "work_mode", "metadata_evidence"])
def test_new_original_source_fields_are_revalidated(client, tamper):
    body = payload("AI Engineer\nWork mode: Hybrid\nTech Stack\nPython")
    if tamper == "origin":
        body["job_analysis"]["requirements"][0]["origin"] = "qualification"
    elif tamper == "work_mode":
        body["job_analysis"]["job"]["work_mode"] = "Remote"
    else:
        body["job_analysis"]["job"]["metadata_evidence"]["work_mode"][0]["start"] += 1
    assert client.post("/api/v1/jobs/compare", json=body).json()["detail"]["code"] == "source_mismatch"


def test_invalid_origin_and_metadata_contracts(client):
    body = payload("Prototype AI Engineer\nTech Stack\nPython")
    body["job_analysis"]["requirements"][0]["origin"] = "employer_score"
    assert client.post("/api/v1/jobs/compare", json=body).status_code == 422
    body = payload("Prototype AI Engineer\nTech Stack\nPython")
    body["job_analysis"]["job"]["metadata_evidence"]["contact"] = []
    assert client.post("/api/v1/jobs/compare", json=body).status_code == 422


def test_environment_only_analysis_warns_without_inventing_requirement():
    result = DeterministicJobAnalyzer().analyze("AI Engineer\nTech Stack\nPython / GenAI\nQualifications\nPython is not required.\nNo degree is required.")
    assert len(result.requirements) == 1
    assert any("no mandatory candidate qualifications" in warning for warning in result.warnings)
    assert not any(item.classification == "required" for item in result.requirements)
