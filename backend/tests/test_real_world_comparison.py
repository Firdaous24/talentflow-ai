"""Pre-tuning fictional French Data BA and exact evidence-boundary regressions."""

from copy import deepcopy

from pydantic import ValidationError
import pytest

from app.models.job import CandidateRequirementEvidence
from app.services.jobs import DeterministicJobAnalyzer
from tests.test_jobs import payload


FRENCH_DATA_BA = """Poste : Data Business Analyst
Entreprise : Atelier Données Fictif
Lieu : Rabat
Contrat : CDI
Mode de travail : Hybride
Responsabilités
Recueillir les besoins et accompagner les utilisateurs.
Profil recherché
Minimum 5 ans d'expérience sur un poste similaire (Business Analyst, Data Analyst ou Data Product Owner).
Maîtrise du recueil des besoins, de la modélisation des processus et de la rédaction des spécifications fonctionnelles.
Solide background Data avec une maîtrise avancée et indispensable du langage SQL.
Capacité à intervenir techniquement sur la partie développement et connaissance de la stack technique (GCP, Teradata, Airflow, etc.).
Une expérience préalable dans le secteur des télécommunications constitue un atout significatif.
Excellentes compétences en communication et en analyse.
"""

PROFESSIONAL_DESCRIPTION = """Recueil des besoins auprès des utilisateurs.
Modélisation de processus en UML.
Rédaction de spécifications fonctionnelles.
Validation de requêtes SQL pour la qualité des données.
Administration de réseaux VoIP."""

FRENCH_CANDIDATE = {
    "experience": [{"job_title": "Stagiaire Business Analyst", "description": PROFESSIONAL_DESCRIPTION}],
    "technical_skills": [{"name": "SQL", "category": "programming_language"}],
    "projects": [{"name": "Pipeline académique", "description": "Orchestration de flux de données avec Apache Airflow."}],
}


def compared(client, text=FRENCH_DATA_BA, candidate=None):
    response = client.post("/api/v1/jobs/compare", json=payload(text, deepcopy(candidate or FRENCH_CANDIDATE)))
    assert response.status_code == 200, response.json()
    return response.json()


def source_field(candidate, path):
    value = candidate
    for component in path.split("."):
        value = value[int(component)] if isinstance(value, list) else value[component]
    return value


def test_fictional_french_data_ba_detects_parenthetical_stack_without_inventing_mastery(client):
    analysis = DeterministicJobAnalyzer().analyze(FRENCH_DATA_BA)
    assert len(analysis.requirements) == 6
    assert {skill.name for item in analysis.requirements for skill in item.technical_skills} == {"SQL", "GCP", "Teradata", "Airflow"}
    assert analysis.requirements[2].classification == "required"
    assert analysis.requirements[3].classification == "unspecified"
    assert analysis.requirements[3].origin == "qualification"
    assert analysis.requirements[4].classification == "preferred"
    assert all(FRENCH_DATA_BA[span.start:span.end] == span.quote for item in analysis.requirements for span in item.evidence)

    data = compared(client)
    rows = data["comparisons"]
    assert rows[0]["status"] == "needs_review"
    assert rows[1]["status"] == "needs_review"
    assert rows[2]["status"] == "needs_review"
    assert rows[3]["status"] == "needs_review"
    assert rows[4]["candidate_evidence"] == []  # VoIP is not sector employment.
    overview = {item["name"]: item for item in data["technical_evidence"]}
    assert set(overview) == {"SQL", "GCP", "Teradata", "Airflow"}
    assert overview["SQL"]["candidate_evidence"]
    assert overview["Airflow"]["candidate_evidence"]
    assert overview["GCP"]["candidate_evidence"] == []
    assert overview["Teradata"]["candidate_evidence"] == []
    assert overview["Airflow"]["requires_interpretation"] is True


@pytest.mark.parametrize("heading,clause", [
    ("Profil recherché", "Connaissance de la stack technique (GCP, Teradata, Apache Airflow)."),
    ("Candidate qualifications", "Knowledge of the technical stack (Google Cloud Platform, Teradata, Airflow)."),
    ("Environnement technique", "GCP / Teradata / Airflow"),
    ("Technical Environment", "GCP, Teradata, Apache Airflow"),
    ("🧩 Stack technique :", "• GCP | Teradata | Airflow"),
])
def test_cloud_stack_names_in_realistic_french_english_lists(heading, clause):
    source = f"Fictional Data Engineer\n{heading}\n{clause}"
    analysis = DeterministicJobAnalyzer().analyze(source)
    assert {skill.name for item in analysis.requirements for skill in item.technical_skills} == {"GCP", "Teradata", "Airflow"}
    assert all(source[evidence.start:evidence.end] == evidence.quote for item in analysis.requirements for evidence in item.evidence)


@pytest.mark.parametrize("clause", [
    "Airflow is not required.",
    "Aucune connaissance de GCP n'est requise.",
    "We might adopt Airflow in the future.",
    "Nous envisageons éventuellement Teradata pour un futur prototype.",
    "Good Clinical Practice (GCP) compliance.",
])
def test_negative_hypothetical_and_ambiguous_cloud_mentions_do_not_become_supported_requirements(clause):
    source = f"Fictional Data Engineer\nQualifications\nPython required\n{clause}"
    analysis = DeterministicJobAnalyzer().analyze(source)
    names = {skill.name for item in analysis.requirements for skill in item.technical_skills}
    assert names == {"Python"}


def test_precise_sql_excerpt_keeps_full_original_field_and_unicode_offsets(client):
    candidate = {"experience": [{"description": "Présentation du projet 🧪.\nAnalyse des données avec SQL.\nOrganisation des réunions hebdomadaires."}]}
    data = compared(client, "Data Engineer\nRequired Skills\nAdvanced SQL proficiency required", candidate)
    evidence = data["comparisons"][0]["candidate_evidence"][0]
    assert evidence["quote"] == candidate["experience"][0]["description"]
    excerpt = evidence["excerpt"]
    assert excerpt["quote"] == "Analyse des données avec SQL."
    assert evidence["quote"][excerpt["start"]:excerpt["end"]] == excerpt["quote"]
    assert data["comparisons"][0]["status"] == "needs_review"
    technical = next(item for item in data["technical_evidence"] if item["name"] == "SQL")
    assert technical["candidate_evidence"][0]["excerpt"] == excerpt


@pytest.mark.parametrize("relevant", [
    "Used SQL for a demonstration. However, advanced proficiency has not been independently assessed.",
    "Requêtes SQL sur des données fictives. Cependant, la maîtrise avancée reste à vérifier.",
])
def test_adjacent_contrast_qualifier_stays_with_relevant_sentence(client, relevant):
    full = f"Organized team meetings.\n{relevant}"
    data = compared(client, "Fictional Data Engineer\nRequired Skills\nAdvanced SQL proficiency required", {"experience": [{"description": full}]})
    evidence = data["comparisons"][0]["candidate_evidence"][0]
    assert evidence["quote"] == full
    assert evidence["excerpt"]["quote"] == relevant
    assert full[evidence["excerpt"]["start"]:evidence["excerpt"]["end"]] == relevant
    assert data["comparisons"][0]["status"] == "needs_review"


def test_business_analysis_retrieval_shows_exact_relevant_bullets_without_claiming_mastery(client):
    data = compared(client)
    row = data["comparisons"][1]
    assert row["status"] == "needs_review"
    assert row["candidate_evidence"]
    excerpts = {item.get("excerpt", {}).get("quote", item["quote"]) for item in row["candidate_evidence"]}
    assert "Recueil des besoins auprès des utilisateurs." in excerpts
    assert "Modélisation de processus en UML." in excerpts
    assert "Rédaction de spécifications fonctionnelles." in excerpts
    assert "Administration de réseaux VoIP." not in excerpts
    for item in row["candidate_evidence"]:
        full = source_field(FRENCH_CANDIDATE, item["field"])
        assert item["quote"] == full
        span = item["excerpt"]
        assert full[span["start"]:span["end"]] == span["quote"]


def test_duration_requirement_never_uses_academic_project_as_professional_experience(client):
    candidate = {"projects": [{"name": "Business Analyst", "description": "Recueil des besoins et analyse des données SQL."}]}
    text = "Fictional Data Analyst\nRequirements\nMinimum 5 years of Business Analyst experience required"
    row = compared(client, text, candidate)["comparisons"][0]
    assert row["candidate_evidence"] == []
    assert row["status"] == "not_documented"
    assert "5" in row["original_requirement_text"]


def test_generic_french_overlap_does_not_fabricate_sector_evidence(client):
    text = "Fictional Data Analyst\nProfil recherché\nUne expérience préalable dans le secteur des télécommunications constitue un atout significatif."
    candidate = {"experience": [{"description": "Participation dans une équipe de recherche et présentation des résultats."}]}
    row = compared(client, text, candidate)["comparisons"][0]
    assert row["candidate_evidence"] == []
    assert row["status"] == "not_documented"


@pytest.mark.parametrize("unsafe", [
    "Python and SQL.\nNationality Fictional.",
    "SQL analysis.\nContact: fictional@example.com",
    "No SQL experience.\nWorked on reporting.",
])
def test_concise_excerpt_does_not_bypass_whole_field_privacy_or_negation(unsafe, client):
    candidate = {"experience": [{"description": unsafe}]}
    data = compared(client, "Fictional Data Analyst\nRequired Skills\nSQL", candidate)
    assert data["comparisons"][0]["candidate_evidence"] == []
    assert data["technical_evidence"][0]["candidate_evidence"] == []


def test_old_evidence_contract_omits_optional_excerpt_without_shortening():
    evidence = CandidateRequirementEvidence(field="technical_skills.0.name", quote="SQL")
    assert evidence.model_dump(mode="json") == {"field": "technical_skills.0.name", "quote": "SQL", "unverified": True}


def test_excerpt_contract_rejects_fabricated_or_out_of_range_spans():
    valid = {"field": "experience.0.description", "quote": "A first sentence. SQL queries.", "excerpt": {"quote": "SQL queries.", "start": 18, "end": 30}}
    # Construct offsets from independently specified source, then require exact
    # equality; an excerpt is never a free-standing generated paraphrase.
    valid["excerpt"]["start"] = valid["quote"].index("SQL queries.")
    valid["excerpt"]["end"] = len(valid["quote"])
    assert CandidateRequirementEvidence.model_validate(valid).quote == valid["quote"]
    for tamper in ("quote", "start", "end"):
        wrong = deepcopy(valid)
        wrong["excerpt"][tamper] = "SQL mastery" if tamper == "quote" else 999
        with pytest.raises(ValidationError):
            CandidateRequirementEvidence.model_validate(wrong)
