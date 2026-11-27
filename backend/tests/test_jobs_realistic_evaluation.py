"""Independent realistic-post regressions and deliberately adversarial metrics."""

from copy import deepcopy
import hashlib

import pytest

from evaluate_jobs_realistic import (
    FIXTURE_PATH, evaluate, evaluate_isolated, load_cases, source_span,
)

CASES = load_cases()


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_realistic_source_bound_annotations(case):
    result = evaluate([case])
    assert result["cases"][0]["differences"] == []
    assert result["counts"]["negative_clauses_leaked"] == 0


def test_independent_corpus_has_distinct_fictional_scenarios_and_all_three_labels():
    assert len(CASES) == len({case["id"] for case in CASES}) == 14
    assert {row["classification"] for case in CASES for row in case["expected_requirements"]} == {
        "required", "preferred", "unspecified",
    }
    assert {row["origin"] for case in CASES for row in case["expected_requirements"]} == {
        "qualification", "technical_environment",
    }
    for case in CASES:
        assert set(case["expected_job"]) == {"title", "company", "location", "employment_type", "work_mode"}
        assert set(case["expected_metadata_evidence"]) == {
            field for field, value in case["expected_job"].items() if value is not None
        }
        for row in case["expected_requirements"]:
            begin, finish = source_span(case["text"], row["evidence"])
            assert case["text"][begin:finish] == row["evidence"]
        for clause in case["negative_clauses"]:
            assert clause in case["text"]
        assert "example.com" in case["text"] or not "@" in case["text"]


class FixedAnalyzer:
    def __init__(self, output):
        self.output = output

    def analyze(self, text):
        return self.output


def fixture():
    text = "Job title: Synthetic Engineer\nRequired Skills\nPython\nPreferred Skills\nSQL\nTech Stack\nAzure OpenAI\nResponsibilities\nDjango\nNot a qualification\n"
    expected_job = {"title": "Synthetic Engineer", "company": None, "location": None,
                    "employment_type": None, "work_mode": None}
    case = {
        "id": "metric_fixture", "scenario": "Synthetic metric-integrity example", "text": text,
        "expected_job": expected_job,
        "expected_metadata_evidence": {"title": "Synthetic Engineer"},
        "expected_requirements": [
            {"key": "python", "category": "technical_skill", "classification": "required",
             "origin": "qualification", "skills": ["Python"], "evidence": "Python"},
            {"key": "sql", "category": "technical_skill", "classification": "preferred",
             "origin": "qualification", "skills": ["SQL"], "evidence": "SQL"},
            {"key": "service", "category": "technical_skill", "classification": "unspecified",
             "origin": "technical_environment", "skills": ["Azure OpenAI"], "evidence": "Azure OpenAI"},
        ],
        "negative_clauses": ["Django", "Not a qualification"],
    }
    title_start = text.index("Synthetic Engineer")
    output = {
        "job": {**expected_job, "text": text, "metadata_evidence": {
            "title": [{"quote": "Synthetic Engineer", "start": title_start,
                       "end": title_start + len("Synthetic Engineer")}],
        }},
        "requirements": [predicted_row(text, "Python", "required", "qualification")],
    }
    return case, output


def predicted_row(text, quote, classification="required", origin="qualification"):
    start = text.index(quote)
    return {"id": "req-001", "text": quote, "category": "technical_skill",
            "classification": classification, "origin": origin,
            "technical_skills": [{"name": quote, "category": "tool"}],
            "evidence": [{"quote": quote, "start": start, "end": start + len(quote)}]}


def test_extraction_misses_stay_in_unspecified_classification_and_origin_denominators():
    case, output = fixture()
    result = evaluate([case], FixedAnalyzer(output))
    assert result["metrics"]["technical_mention_precision"] == 1
    assert result["metrics"]["technical_mention_recall"] == pytest.approx(1 / 3)
    assert result["metrics"]["classification_accuracy"] == pytest.approx(1 / 3)
    assert result["metrics"]["origin_accuracy"] == pytest.approx(1 / 3)
    assert result["counts"]["classification_expected"] == 3
    assert result["counts"]["origin_expected"] == 3


def test_empty_predictions_are_not_reported_as_perfect_precision_or_evidence():
    case, output = fixture()
    output["requirements"] = []
    result = evaluate([case], FixedAnalyzer(output))
    assert result["metrics"]["technical_mention_precision"] is None
    assert result["metrics"]["source_evidence_correctness"] is None
    assert result["metrics"]["technical_mention_recall"] == 0
    assert result["metrics"]["classification_accuracy"] == 0
    assert result["metrics"]["origin_accuracy"] == 0


def test_negative_clause_denominator_is_independent_of_prediction_count():
    case, output = fixture()
    output["requirements"].append(predicted_row(case["text"], "Django"))
    result = evaluate([case], FixedAnalyzer(output))
    assert result["counts"]["negative_clauses_expected"] == 2
    assert result["counts"]["negative_clauses_leaked"] == 1
    assert result["metrics"]["false_positive_rate"] == 0.5
    assert result["metrics"]["technical_mention_precision"] == 0.5
    assert result["metrics"]["unsupported_requirement_rate"] == 0.5
    assert result["metrics"]["source_evidence_correctness"] == 0.5


def test_environment_mistaken_for_mandatory_qualification_is_unsupported():
    case, output = fixture()
    output["requirements"] = [predicted_row(case["text"], "Azure OpenAI")]
    result = evaluate([case], FixedAnalyzer(output))
    assert result["metrics"]["technical_mention_precision"] == 1
    assert result["metrics"]["technical_mention_recall"] == pytest.approx(1 / 3)
    assert result["metrics"]["origin_accuracy"] == 0
    assert result["metrics"]["classification_accuracy"] == 0
    assert result["metrics"]["unsupported_requirement_rate"] == 1


def test_invented_subservice_equivalence_reduces_precision():
    case, output = fixture()
    row = predicted_row(case["text"], "Azure OpenAI", "unspecified", "technical_environment")
    row["technical_skills"].append({"name": "Azure AI", "category": "ai_ml"})
    output["requirements"] = [row]
    result = evaluate([case], FixedAnalyzer(output))
    assert result["metrics"]["technical_mention_precision"] == 0.5
    assert result["metrics"]["unsupported_requirement_rate"] == 1


def test_corrupted_offsets_receive_neither_mention_nor_evidence_credit():
    case, output = fixture()
    output["requirements"][0]["evidence"][0]["start"] += 1
    output["requirements"][0]["evidence"][0]["end"] += 1
    result = evaluate([case], FixedAnalyzer(output))
    assert result["metrics"]["technical_mention_precision"] == 0
    assert result["metrics"]["source_evidence_correctness"] == 0
    assert result["metrics"]["unsupported_requirement_rate"] == 1


def test_exact_but_oversized_source_quote_cannot_hide_negative_clauses():
    case, output = fixture()
    output["requirements"][0]["evidence"] = [{"quote": case["text"], "start": 0, "end": len(case["text"])}]
    result = evaluate([case], FixedAnalyzer(output))
    assert result["metrics"]["technical_mention_precision"] == 1
    assert result["metrics"]["source_evidence_correctness"] == 0
    assert result["metrics"]["unsupported_requirement_rate"] == 1
    assert result["counts"]["negative_clauses_leaked"] == 2
    assert result["metrics"]["false_positive_rate"] == 1


def test_duplicate_predictions_cannot_double_count_one_independent_mention():
    case, output = fixture()
    output["requirements"].append(deepcopy(output["requirements"][0]))
    result = evaluate([case], FixedAnalyzer(output))
    assert result["counts"]["technical_mentions_correct"] == 1
    assert result["counts"]["technical_mentions_predicted"] == 2
    assert result["metrics"]["technical_mention_precision"] == 0.5
    assert result["metrics"]["unsupported_requirement_rate"] == 0.5


def test_explicit_metadata_is_reported_separately_from_absent_fields():
    case, output = fixture()
    output["job"]["title"] = None
    result = evaluate([case], FixedAnalyzer(output))
    assert result["counts"]["explicit_metadata_expected"] == 1
    assert result["counts"]["absent_metadata_expected"] == 4
    assert result["metrics"]["explicit_metadata_accuracy"] == 0
    assert result["metrics"]["absent_metadata_accuracy"] == 1
    assert result["metrics"]["metadata_accuracy"] == 0.8
    assert result["metrics"]["metadata_evidence_correctness"] == 0


def test_valid_metadata_value_with_invalid_evidence_loses_source_credit():
    case, output = fixture()
    output["job"]["metadata_evidence"]["title"][0]["start"] += 1
    result = evaluate([case], FixedAnalyzer(output))
    assert result["metrics"]["explicit_metadata_accuracy"] == 1
    assert result["metrics"]["metadata_evidence_correctness"] == 0


def test_fresh_interpreter_imports_requested_app_without_current_model_contamination(tmp_path):
    app = tmp_path / "app"
    service = app / "services"
    service.mkdir(parents=True)
    (app / "__init__.py").write_text("", encoding="utf-8")
    (service / "__init__.py").write_text("", encoding="utf-8")
    (service / "jobs.py").write_text(
        "class DeterministicJobAnalyzer:\n"
        "    def analyze(self, text):\n"
        "        return {'job': {'title': 'Isolated fake analyzer marker'}, 'requirements': []}\n",
        encoding="utf-8",
    )
    result = evaluate_isolated(tmp_path, FIXTURE_PATH)
    assert result["counts"]["requirements_predicted"] == 0
    assert all(case["actual_job"]["title"] == "Isolated fake analyzer marker" for case in result["cases"])
    assert result["app_fingerprint"]["python_files"] == 3
    expected_hash = hashlib.sha256((service / "jobs.py").read_bytes()).hexdigest()
    assert result["app_fingerprint"]["sha256"]["app/services/jobs.py"] == expected_hash
    assert result["fixture_sha256"] == hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest()


def test_source_clause_annotation_prefers_full_line_over_same_word_in_contacts():
    case = next(case for case in CASES if case["id"] == "contacts_hashtags_protected_fr")
    start, end = source_span(case["text"], "Python")
    assert case["text"][start - 1] == "\n"
    assert case["text"][end] == "\n"
