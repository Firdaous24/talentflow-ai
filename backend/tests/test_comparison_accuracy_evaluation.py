"""Frozen corpus integrity and adversarial evaluator denominator checks."""

from copy import deepcopy
import hashlib
import json

import pytest

from evaluate_comparison_accuracy import (
    field_value, load_cases, score_predictions, source_span,
    valid_candidate_source, verify_freeze,
    verify_app_manifest, valid_span,
)

CASES = load_cases()


def test_comparison_accuracy_corpus_is_frozen_and_independent():
    assert verify_freeze() == "9d945092e74ee40ce4d742513e3d614cac7105629f7187fda8840a5b239154c1"
    assert len(CASES) == len({case["id"] for case in CASES}) == 16
    assert sum("segmentation" in case for case in CASES) == 4
    assert sum(len(case["requirements"]) for case in CASES) == 46
    assert sum(len(row["technologies"]) for case in CASES for row in case["requirements"]) == 48


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_independent_annotations_point_into_their_authored_sources(case):
    for requirement in case["requirements"]:
        start, end = source_span(case["job_text"], requirement["quote"])
        assert case["job_text"][start:end] == requirement["quote"]
        assert requirement["classification"] in {"required", "preferred", "unspecified"}
        assert requirement["origin"] in {"qualification", "technical_environment"}
        for evidence in requirement["evidence"]:
            original = field_value(case["profile"], evidence["field"])
            assert original is not None and evidence["quote"] in original


def metric_fixture():
    text = "Job title: Synthetic Developer\nRequired Skills\nSQL\nPreferred Qualifications\nPython\n"
    description = "Used SQL for synthetic tables.\nWrote unrelated notes."
    case = {"id": "denominators", "scenario": "Evaluator-only synthetic test", "job_text": text,
        "profile": {"experience": [{"description": description}]},
        "requirements": [
            {"key": "sql", "quote": "SQL", "technologies": ["SQL"], "classification": "required", "origin": "qualification", "status": "documented",
             "evidence": [{"field": "experience.0.description", "quote": "Used SQL for synthetic tables."}]},
            {"key": "python", "quote": "Python", "technologies": ["Python"], "classification": "preferred", "origin": "qualification", "status": "not_documented", "evidence": []},
        ]}
    start = text.index("SQL")
    prediction = {"id": case["id"], "analysis": {"requirements": [{"id": "req-001", "text": "SQL", "classification": "required", "origin": "qualification",
        "technical_skills": [{"name": "SQL"}], "evidence": [{"quote": "SQL", "start": start, "end": start + 3}]}]},
        "comparison": {"comparisons": [{"requirement_id": "req-001", "status": "documented", "candidate_evidence": [
            {"field": "experience.0.description", "quote": description}]}], "technical_evidence": []}}
    return case, prediction


def test_missing_requirements_penalize_recall_classification_origin_and_status():
    case, prediction = metric_fixture()
    result = score_predictions([case], [prediction])
    metrics = result["metrics"]
    assert metrics["technology_mention_precision"] == 1
    assert metrics["technology_mention_recall"] == 0.5
    assert metrics["qualification_classification_accuracy"] == 0.5
    assert metrics["source_origin_accuracy"] == 0.5
    assert metrics["comparison_status_correctness"] == 0.5
    assert result["counts"]["status_expected"] == 2


def test_full_fields_can_be_relevant_but_do_not_receive_concise_boundary_credit():
    case, prediction = metric_fixture()
    result = score_predictions([case], [prediction])
    assert result["metrics"]["evidence_relevance_precision"] == 1
    assert result["metrics"]["candidate_source_evidence_correctness"] == 1
    assert result["metrics"]["excerpt_boundary_correctness"] == 0
    assert result["metrics"]["evidence_relevance_recall"] == 1


def test_additive_exact_excerpts_receive_boundary_credit_and_tampering_does_not():
    case, prediction = metric_fixture()
    evidence = prediction["comparison"]["comparisons"][0]["candidate_evidence"][0]
    quote = case["requirements"][0]["evidence"][0]["quote"]
    evidence["excerpt"] = {"quote": quote, "start": 0, "end": len(quote)}
    result = score_predictions([case], [prediction])
    assert result["metrics"]["excerpt_boundary_correctness"] == 1
    evidence["excerpt"]["start"] = 1
    result = score_predictions([case], [prediction])
    assert result["metrics"]["candidate_source_evidence_correctness"] == 0
    assert result["metrics"]["unsupported_evidence_rate"] == 1
    assert result["metrics"]["evidence_relevance_recall"] == 0


def test_missing_all_output_retains_independent_evidence_and_status_denominators():
    result = score_predictions(CASES, [])
    counts, metrics = result["counts"], result["metrics"]
    assert counts["evidence_expected"] == 39
    assert counts["status_expected"] == 46
    assert counts["segmentation_expected"] == 60
    assert metrics["technology_mention_precision"] is None
    assert metrics["technology_mention_recall"] == 0
    assert metrics["comparison_status_correctness"] == 0
    assert metrics["evidence_relevance_recall"] == 0
    assert metrics["cv_complete_segmentation_rate"] == 0


def test_unexpected_technology_and_unsupported_evidence_reduce_precision():
    case, prediction = metric_fixture()
    row = deepcopy(prediction["analysis"]["requirements"][0])
    row["id"] = "req-002"
    row["technical_skills"] = [{"name": "GCP"}]
    prediction["analysis"]["requirements"].append(row)
    prediction["comparison"]["comparisons"].append({"requirement_id": "req-002", "status": "documented",
        "candidate_evidence": [{"field": "experience.0.description", "quote": case["profile"]["experience"][0]["description"]}]})
    result = score_predictions([case], [prediction])
    assert result["metrics"]["technology_mention_precision"] == 0.5
    assert result["metrics"]["unsupported_evidence_rate"] == 0.5
    assert result["counts"]["job_source_predicted"] == 2
    assert result["metrics"]["job_source_evidence_correctness"] == 0.5


def test_candidate_source_reference_cannot_point_to_an_unrelated_field():
    assert not valid_candidate_source({"field": "projects.0.description", "quote": "SQL"},
                                     {"experience": [{"description": "SQL"}]})


def test_privacy_output_leaks_and_accepted_identity_fields_are_counted():
    case, prediction = metric_fixture()
    case["privacy_canaries"] = ["candidate@example.invalid"]
    case["forbidden_profile_fields"] = {"email": "candidate@example.invalid"}
    prediction["comparison"]["warning"] = "candidate@example.invalid"
    prediction["privacy_field_rejections"] = {"email": False}
    result = score_predictions([case], [prediction])
    assert result["counts"]["privacy_expected"] == 2
    assert result["metrics"]["privacy_exclusion_accuracy"] == 0


def test_duplicate_overview_and_checklist_source_excerpts_do_not_inflate_counts():
    case, prediction = metric_fixture()
    evidence = deepcopy(prediction["comparison"]["comparisons"][0]["candidate_evidence"])
    prediction["comparison"]["technical_evidence"] = [{"name": "SQL", "job_references": [{"requirement_id": "req-001"}],
                                                       "candidate_evidence": evidence}]
    result = score_predictions([case], [prediction])
    assert result["counts"]["evidence_predicted"] == 1
    assert result["counts"]["evidence_recalled"] == 1


def test_baseline_manifest_verifies_files_and_refuses_tampered_or_extra_code(tmp_path):
    source = tmp_path / "app"
    source.mkdir()
    module = source / "__init__.py"
    module.write_text("# Frozen synthetic engine\n", encoding="utf-8")
    digest = hashlib.sha256(module.read_bytes()).hexdigest()
    (tmp_path / "manifest.json").write_text(json.dumps({"label": "Synthetic frozen baseline",
        "files": {"app/__init__.py": digest}}), encoding="utf-8")
    assert verify_app_manifest(tmp_path)["verified_python_files"] == 1
    module.write_text("# Changed engine\n", encoding="utf-8")
    with pytest.raises(ValueError, match="baseline app files differ"):
        verify_app_manifest(tmp_path)
    module.write_text("# Frozen synthetic engine\n", encoding="utf-8")
    (source / "extra.py").write_text("# Unmanifested module\n", encoding="utf-8")
    with pytest.raises(ValueError, match="baseline app files differ"):
        verify_app_manifest(tmp_path)


def test_unicode_source_offsets_use_python_characters_after_emoji_and_accents():
    text = "🚀 Équipe fictive\nSQL\n"
    start, end = source_span(text, "SQL")
    assert valid_span({"quote": "SQL", "start": start, "end": end}, text)
    # An astral emoji is two UTF-16 code units and one Python character. A
    # browser-derived UTF-16 offset cannot silently receive source credit.
    assert not valid_span({"quote": "SQL", "start": start + 1, "end": end + 1}, text)
