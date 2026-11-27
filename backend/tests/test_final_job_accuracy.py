"""Fictional copied-post, explicit-threshold and source-bound BA regressions."""

from copy import deepcopy
import json
from pathlib import Path

import pytest

from app.services.jobs import DeterministicJobAnalyzer, business_concepts
from tests.test_jobs import payload


FIXTURE = json.loads((Path(__file__).parent / "fixtures/job_final_accuracy.json").read_text(encoding="utf-8"))


def compare(client, source, candidate):
    response = client.post("/api/v1/jobs/compare", json=payload(source, deepcopy(candidate)))
    assert response.status_code == 200, response.json()
    return response.json()


def test_exact_copied_french_post_has_six_source_exact_qualifications():
    source = FIXTURE["copied_job"]
    result = DeterministicJobAnalyzer().analyze(source)
    assert len(result.requirements) == 6
    assert result.job.text == source  # No global punctuation/backslash rewrite.
    assert result.requirements[0].classification == "required"
    assert result.requirements[4].classification == "preferred"
    assert result.requirements[5].category == "other"
    assert {skill.name for row in result.requirements for skill in row.technical_skills} == {"SQL", "GCP", "Teradata", "Airflow"}
    for row in result.requirements:
        assert row.text.endswith("\\")  # Trailing copy markers remain source-exact.
        for span in row.evidence:
            assert source[span.start:span.end] == span.quote == row.text


@pytest.mark.parametrize("artifact", ["\\", "\\n", "\\r\\n", "\\n\\n", "\\t", " ", "---", "***", "```", "[]", "...", "-", "1. ", "→", "* * *", "<br/>", "&nbsp;", "&#160;", "&emsp;"])
def test_formatting_only_clauses_do_not_become_requirements(artifact):
    source = f"Fictional Developer\nRequired Skills\nPython\n{artifact}\nSQL"
    result = DeterministicJobAnalyzer().analyze(source)
    assert [row.text for row in result.requirements] == ["Python", "SQL"]
    assert result.job.text == source


@pytest.mark.parametrize("clause", ["C++", "C#", ".NET", r"C:\data\new\records.csv", r"Regular expression: \\d+\\s+", r"SQL scripts in ./queries/*.sql", r"A literal \\n in test data", r"\R"])
def test_technical_punctuation_and_backslashes_are_not_globally_removed(clause):
    source = f"Fictional Developer\nQualifications\n{clause}"
    result = DeterministicJobAnalyzer().analyze(source)
    assert len(result.requirements) == 1
    assert result.requirements[0].text == clause
    span = result.requirements[0].evidence[0]
    assert source[span.start:span.end] == clause


@pytest.mark.parametrize("clause", [
    "Minimum 5 ans d'expérience sur un poste similaire.",
    "Au moins 3 ans d'expérience en analyse de données.",
    "5 years minimum", "At least 3 years of experience", "A minimum of 4 years of professional experience",
    "Expérience obligatoire", "Must have SQL", "SQL indispensable",
    "Expérience professionnelle : minimum 5 ans", "Professional experience of at least 3 years",
])
def test_explicit_qualification_thresholds_are_required(clause):
    source = f"Fictional Data Analyst\nPROFIL RECHERCHÉ\n{clause}"
    result = DeterministicJobAnalyzer().analyze(source)
    assert len(result.requirements) == 1
    assert result.requirements[0].classification == "required"


def test_required_qualifications_heading_sets_explicit_section_classification():
    result = DeterministicJobAnalyzer().analyze("Fictional Developer\nRequired qualifications\nSQL")
    assert len(result.requirements) == 1
    assert result.requirements[0].classification == "required"


@pytest.mark.parametrize("clause", [
    "3 ans d'expérience en SQL.",
    "SQL pour la conservation des données pendant au moins 5 ans.",
    'La brochure cite "Minimum 5 ans d\'expérience" à titre d\'exemple.',
    "Si le projet démarre, minimum 5 ans d'expérience seraient souhaitables.",
    "5 years of SQL reporting experience.",
    "Experience maintaining SQL records with a retention period of at least 5 years.",
    "Expérience SQL avec une durée de conservation des données d'au moins 5 ans.",
    "Minimum 5 years of experience may be considered.",
    "Minimum 5 years of experience would be ideal.",
    "Minimum 5 years of experience if possible.",
    '"Minimum 5 years of experience"',
    "Experience may require a minimum of 5 years.",
])
def test_duration_and_quoted_or_conditional_wording_are_not_unconditionally_mandatory(clause):
    result = DeterministicJobAnalyzer().analyze(f"Fictional Analyst\nQualifications\n{clause}")
    assert all(row.classification != "required" for row in result.requirements)


@pytest.mark.parametrize("clause", [
    "Minimum 5 ans d'expérience non requis.",
    "At least 3 years of experience is not required.",
    "Nous pourrions demander au moins 3 ans d'expérience.",
    "We might require a minimum of 5 years of experience in a future role.",
    "Minimum 5 years of experience are not mandatory.",
    "Not at least 3 years of experience.",
])
def test_negative_and_hypothetical_thresholds_are_not_positive_requirements(clause):
    result = DeterministicJobAnalyzer().analyze(f"Fictional Analyst\nQualifications\n{clause}")
    assert result.requirements == []


@pytest.mark.parametrize("preferred", ["un atout", "un atout majeur", "souhaité", "apprécié", "nice to have", "preferred"])
def test_explicit_preference_takes_priority_over_duration_threshold(preferred):
    source = f"Fictional Analyst\nQualifications\nMinimum 5 ans d'expérience : {preferred}."
    assert DeterministicJobAnalyzer().analyze(source).requirements[0].classification == "preferred"


def test_environment_duration_wording_is_not_promoted_to_a_candidate_qualification():
    source = "Fictional Engineer\nTechnical Environment\nAirflow / SQL, minimum 5 years of retained data."
    row = DeterministicJobAnalyzer().analyze(source).requirements[0]
    assert row.origin == "technical_environment"
    assert row.classification == "unspecified"


def test_inherited_preference_is_not_overridden_by_an_implicit_experience_threshold():
    source = "Fictional Analyst\nPreferred Qualifications\nMinimum 5 years of experience"
    assert DeterministicJobAnalyzer().analyze(source).requirements[0].classification == "preferred"


def test_required_heading_does_not_promote_a_quoted_example_to_a_current_threshold():
    source = 'Fictional Analyst\nRequired Skills\nThe brochure quotes "Minimum 5 years of experience" as an example.'
    rows = DeterministicJobAnalyzer().analyze(source).requirements
    assert all(row.classification != "required" for row in rows)


def test_realistic_comparison_keeps_mastery_and_duration_uncertain_and_tech_neutral(client):
    result = compare(client, FIXTURE["copied_job"], FIXTURE["candidate_with_business_evidence"])
    assert len(result["comparisons"]) == 6
    assert all(result["comparisons"][i]["status"] == "needs_review" for i in (0, 1, 2, 3, 5))
    assert result["comparisons"][4]["candidate_evidence"] == []
    assert result["comparisons"][5]["candidate_evidence"] == []
    overview = {item["name"]: item for item in result["technical_evidence"]}
    assert set(overview) == {"SQL", "GCP", "Teradata", "Airflow"}
    assert overview["SQL"]["candidate_evidence"]
    assert overview["Airflow"]["candidate_evidence"]
    assert overview["GCP"]["candidate_evidence"] == []
    assert overview["Teradata"]["candidate_evidence"] == []
    assert all(item["requires_interpretation"] for item in overview.values())


def test_observed_business_wording_returns_only_actual_source_supported_excerpts(client):
    candidate = FIXTURE["candidate_with_business_evidence"]
    row = compare(client, FIXTURE["copied_job"], candidate)["comparisons"][1]
    assert row["status"] == "needs_review"
    returned = {item.get("excerpt", {}).get("quote", item["quote"]) for item in row["candidate_evidence"]}
    assert "Recueil de besoins auprès des utilisateurs." in returned
    assert "Modélisation des processus avec UML." in returned
    assert "Rédaction de spécifications fonctionnelles et de cahiers des charges." in returned
    assert "Requêtes SQL pour vérifier des données de démonstration." not in returned
    full = candidate["experience"][0]["description"]
    for item in row["candidate_evidence"]:
        assert item["field"] == "experience.0.description"
        assert item["quote"] == full
        excerpt = item["excerpt"]
        assert full[excerpt["start"]:excerpt["end"]] == excerpt["quote"]


def test_sql_meetings_dashboards_or_voip_do_not_invent_business_evidence(client):
    row = compare(client, FIXTURE["copied_job"], FIXTURE["candidate_without_business_evidence"])["comparisons"][1]
    assert row["candidate_evidence"] == []
    assert row["status"] == "needs_review"


@pytest.mark.parametrize("modifier", ["3D", "financière", "statistique", "des données"])
def test_business_coordination_does_not_turn_other_modeling_into_process_modeling(modifier):
    wording = f"Recueil des besoins, modélisation {modifier} et spécifications fonctionnelles."
    assert "process_modeling" not in business_concepts(wording)


@pytest.mark.parametrize("requirement,positive,negative", [
    ("Recueil des besoins", "Recueil de besoins métier auprès des utilisateurs.", "Rédaction de spécifications fonctionnelles."),
    ("Analyse des besoins métier", "Analyse de besoins métier pour une démonstration.", "Création de tableaux de bord SQL."),
    ("Business requirements gathering", "Business requirements gathering workshops.", "Functional specifications documentation."),
    ("Process modeling", "Modélisation des processus métier.", "UML diagrams for a fictional system."),
    ("Modélisation des processus", "Process modelling workshops.", "Modélisation 3D de bâtiments."),
    ("UML", "Création de diagrammes UML sur données fictives.", "Modélisation des processus métier."),
    ("Functional specifications", "Rédaction de spécifications fonctionnelles.", "Rédaction de cahiers des charges."),
    ("Rédaction de cahiers des charges", "Rédaction d'un cahier des charges pour un outil fictif.", "Rédaction de spécifications fonctionnelles."),
])
def test_distinct_business_concepts_retrieve_corresponding_statements_only(client, requirement, positive, negative):
    source = f"Fictional Business Analyst\nQualifications\nMaîtrise : {requirement}"
    row = compare(client, source, {"experience": [{"description": positive}]})["comparisons"][0]
    assert row["candidate_evidence"], (requirement, business_concepts(requirement), business_concepts(positive))
    assert row["candidate_evidence"][0]["quote"] == positive
    assert row["status"] == "needs_review"
    negative_row = compare(client, source, {"experience": [{"description": negative}]})["comparisons"][0]
    assert negative_row["candidate_evidence"] == []
    assert negative_row["status"] == "needs_review"


@pytest.mark.parametrize("unsafe", [
    "Recueil des besoins.\nContact: fictional@example.com",
    "Recueil des besoins.\nNationality: Fictional.",
    "Aucune expérience de recueil des besoins.\nAnalyse de besoins métier.",
])
def test_business_aliases_never_bypass_whole_field_privacy_and_negation(unsafe, client):
    result = compare(client, FIXTURE["copied_job"], {"experience": [{"description": unsafe}]})
    assert result["comparisons"][1]["candidate_evidence"] == []


def test_business_evidence_requires_explicit_review_confirmation(client):
    request = payload(FIXTURE["copied_job"], FIXTURE["candidate_with_business_evidence"])
    request["review"]["candidate_confirmed"] = False
    response = client.post("/api/v1/jobs/compare", json=request)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "review_required"
