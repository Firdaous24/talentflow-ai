"""Independent job corpus regressions and honest evaluation denominators."""

from copy import deepcopy

import pytest

from app.models.job import JobAnalysisResponse, JobComparisonResponse, RequirementComparison
from evaluate_jobs import evaluate, load_cases

CASES = load_cases()


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_independent_job_annotations(case):
    result = evaluate([case])
    assert result["cases"][0]["differences"] == []
    assert result["counts"]["excluded_clause_leaks"] == 0


def test_dataset_has_ten_distinct_synthetic_bilingual_scenarios():
    assert len(CASES) == len({case["id"] for case in CASES}) == 10
    assert any("Compétences requises" in case["text"] for case in CASES)
    assert any("Required Skills" in case["text"] for case in CASES)
    for case in CASES:
        assert set(case["expected_job"]) == {"title", "company", "location", "employment_type"}
        assert case["expected_requirements"]
        assert all(row["evidence"] in case["text"] for row in case["expected_requirements"])
        assert not set(case["candidate"]) & {"full_name", "email", "phone", "nationality", "date_of_birth", "location"}


class FixedAnalyzer:
    def __init__(self, output):
        self.output = output

    def analyze(self, text):
        return self.output


def fabricated_comparison(request):
    """Intentionally optimistic comparator used only to test missed denominators."""
    return JobComparisonResponse(
        comparisons=[RequirementComparison(
            requirement_id=row.id, requirement_text=row.text,
            original_requirement_text=row.text, category=row.category,
            classification=row.classification, status="documented", candidate_evidence=[],
            job_evidence=row.evidence, explanation="Synthetic metric-test output only.",
        ) for row in request.job_analysis.requirements], warnings=[],
    )


def metric_fixture():
    text = "Job title: Synthetic Developer\nRequired Skills\nPython\nPreferred Qualifications\nSQL\nResponsibilities\nDjango\n"
    case = {
        "id": "metric_test", "scenario": "Synthetic denominator test", "text": text,
        "expected_job": {"title": "Synthetic Developer", "company": None, "location": None, "employment_type": None},
        "expected_responsibilities": ["Django"], "excluded_evidence": ["Django"], "candidate": {},
        "expected_requirements": [
            {"key": "python", "category": "technical_skill", "classification": "required", "skills": ["Python"], "evidence": "Python", "status": "documented"},
            {"key": "sql", "category": "technical_skill", "classification": "preferred", "skills": ["SQL"], "evidence": "SQL", "status": "documented"},
        ],
    }
    start = text.index("Python")
    output = JobAnalysisResponse.model_validate({
        "job": {**case["expected_job"], "text": text, "responsibilities": ["Django"]},
        "requirements": [{"id": "req-001", "text": "Python", "category": "technical_skill", "classification": "required",
                          "technical_skills": [{"name": "Python", "category": "programming_language"}],
                          "evidence": [{"quote": "Python", "start": start, "end": start + len("Python")}]}],
    })
    return case, output


def test_missed_requirements_remain_in_all_recall_classification_and_status_denominators():
    case, output = metric_fixture()
    result = evaluate([case], FixedAnalyzer(output), fabricated_comparison)
    assert result["metrics"]["skill_precision"] == 1
    assert result["metrics"]["skill_recall"] == 0.5
    assert result["metrics"]["required_preferred_classification_accuracy"] == 0.5
    assert result["metrics"]["comparison_status_correctness"] == 0.5
    assert result["counts"]["comparison_expected"] == 2
    assert any(row["kind"] == "missing_requirement" for row in result["cases"][0]["differences"])


def test_unannotated_output_reduces_precision_and_cannot_receive_evidence_credit():
    case, output = metric_fixture()
    data = output.model_dump()
    start = case["text"].index("Django")
    data["requirements"].append({
        "id": "req-002", "text": "Django", "category": "technical_skill", "classification": "required",
        "technical_skills": [{"name": "Django", "category": "framework"}],
        "evidence": [{"quote": "Django", "start": start, "end": start + 6}],
    })
    result = evaluate([case], FixedAnalyzer(JobAnalysisResponse.model_validate(data)), fabricated_comparison)
    assert result["metrics"]["skill_precision"] == 0.5
    assert result["metrics"]["unsupported_requirement_rate"] == 0.5
    assert result["metrics"]["evidence_correctness"] == 0.5
    assert result["counts"]["excluded_clause_leaks"] == 1


def test_evidence_offsets_are_verified_against_original_source():
    case, output = metric_fixture()
    data = deepcopy(output.model_dump())
    data["requirements"][0]["evidence"][0]["start"] += 1
    data["requirements"][0]["evidence"][0]["end"] += 1
    result = evaluate([case], FixedAnalyzer(JobAnalysisResponse.model_validate(data)), fabricated_comparison)
    assert result["counts"]["requirements_matched"] == 1
    assert result["metrics"]["evidence_correctness"] == 0
    assert any(row["kind"] == "source_evidence" for row in result["cases"][0]["differences"])


def test_zero_predictions_do_not_skip_expected_comparison_or_classification_labels():
    case, output = metric_fixture()
    data = output.model_dump()
    data["requirements"] = []
    result = evaluate([case], FixedAnalyzer(JobAnalysisResponse.model_validate(data)), fabricated_comparison)
    assert result["metrics"]["skill_precision"] is None
    assert result["metrics"]["skill_recall"] == 0
    assert result["metrics"]["evidence_correctness"] is None
    assert result["metrics"]["required_preferred_classification_accuracy"] == 0
    assert result["metrics"]["comparison_status_correctness"] == 0
    assert result["counts"]["comparison_expected"] == 2
