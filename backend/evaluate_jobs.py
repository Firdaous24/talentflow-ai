"""Evaluate local job analysis against independently authored fictional annotations.

The analyzer is never used to construct the expected annotations. Missing
requirements remain in classification/status denominators; unexpected output
counts against precision and unsupported-requirement metrics.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from app.models.job import (
    JobComparisonRequest,
    JobReviewAssertion,
    QualificationProfile,
    ReviewedRequirement,
)
from app.services.jobs import DeterministicJobAnalyzer, compare_job

FIXTURE_PATH = Path(__file__).parent / "tests" / "fixtures" / "job_descriptions.json"


def load_cases(path: Path = FIXTURE_PATH) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def comparison_request(analysis, candidate: dict[str, Any]) -> JobComparisonRequest:
    """Synthetic workflow assertion, explicitly not authenticated approval."""
    profile = QualificationProfile.model_validate(candidate)
    reviewed = [ReviewedRequirement(id=row.id, text=row.text, category=row.category,
                                    classification=row.classification)
                for row in analysis.requirements]
    return JobComparisonRequest(
        candidate=profile, job_analysis=analysis, requirements=reviewed,
        review=JobReviewAssertion(candidate_confirmed=True, candidate_snapshot=profile,
                                 requirements_reviewed=True, requirement_snapshot=reviewed),
    )


def _source_match(row, expected: dict[str, Any]) -> bool:
    """Pair source-bound semantic clauses; no generated IDs are ground truth."""
    return (row.category == expected["category"]
            and {skill.name for skill in row.technical_skills} == set(expected["skills"])
            and any(expected["evidence"] in evidence.quote for evidence in row.evidence))


def _valid_source_evidence(row, text: str, expected: dict[str, Any]) -> bool:
    return bool(row.evidence) and all(
        0 <= source.start < source.end <= len(text)
        and text[source.start:source.end] == source.quote
        and expected["evidence"] in source.quote
        for source in row.evidence
    )


def _ratio(correct: int, denominator: int) -> float | None:
    return correct / denominator if denominator else None


def evaluate(cases=None, analyzer=None, comparator=None) -> dict[str, Any]:
    cases = load_cases() if cases is None else cases
    analyzer = DeterministicJobAnalyzer() if analyzer is None else analyzer
    comparator = compare_job if comparator is None else comparator
    counts = dict(
        skill_correct=0, skill_predicted=0, skill_expected=0,
        requirements_matched=0, requirements_predicted=0, requirements_expected=0,
        classification_correct=0, classification_expected=0,
        evidence_correct=0, evidence_predicted=0,
        unsupported_requirements=0, comparison_correct=0, comparison_expected=0,
        metadata_correct=0, metadata_expected=0,
        responsibilities_correct=0, responsibilities_expected=0,
        excluded_clause_leaks=0,
    )
    outputs = []
    for case in cases:
        analysis = analyzer.analyze(case["text"])
        expected = case["expected_requirements"]
        predicted = analysis.requirements
        statuses = {}
        if predicted:
            comparison = comparator(comparison_request(analysis, case["candidate"]))
            statuses = {row.requirement_id: row.status for row in comparison.comparisons}
        remaining = set(range(len(predicted)))
        matched = {}
        differences = []
        for annotation in expected:
            index = next((index for index in sorted(remaining)
                          if _source_match(predicted[index], annotation)), None)
            if index is None:
                differences.append({"requirement": annotation["key"], "kind": "missing_requirement",
                                    "expected": annotation})
                continue
            remaining.remove(index)
            row = predicted[index]
            matched[annotation["key"]] = row
            if row.classification != annotation["classification"]:
                differences.append({"requirement": annotation["key"], "kind": "classification",
                                    "expected": annotation["classification"], "actual": row.classification})
            if not _valid_source_evidence(row, case["text"], annotation):
                differences.append({"requirement": annotation["key"], "kind": "source_evidence"})
            if statuses.get(row.id) != annotation["status"]:
                differences.append({"requirement": annotation["key"], "kind": "comparison_status",
                                    "expected": annotation["status"], "actual": statuses.get(row.id)})
        for index in sorted(remaining):
            differences.append({"kind": "unsupported_requirement", "actual": predicted[index].model_dump(mode="json")})

        predicted_skills = {skill.name for row in predicted for skill in row.technical_skills}
        expected_skills = {skill for row in expected for skill in row["skills"]}
        counts["skill_correct"] += len(predicted_skills & expected_skills)
        counts["skill_predicted"] += len(predicted_skills)
        counts["skill_expected"] += len(expected_skills)
        counts["requirements_matched"] += len(matched)
        counts["requirements_predicted"] += len(predicted)
        counts["requirements_expected"] += len(expected)
        counts["unsupported_requirements"] += len(remaining)
        explicit = [row for row in expected if row["classification"] in {"required", "preferred"}]
        counts["classification_expected"] += len(explicit)
        counts["classification_correct"] += sum(
            row["key"] in matched and matched[row["key"]].classification == row["classification"]
            for row in explicit
        )
        counts["evidence_predicted"] += len(predicted)
        counts["evidence_correct"] += sum(
            row["key"] in matched and _valid_source_evidence(matched[row["key"]], case["text"], row)
            for row in expected
        )
        counts["comparison_expected"] += len(expected)
        counts["comparison_correct"] += sum(
            row["key"] in matched and statuses.get(matched[row["key"]].id) == row["status"]
            for row in expected
        )
        actual_job = analysis.job.model_dump()
        for field, value in case["expected_job"].items():
            counts["metadata_expected"] += 1
            counts["metadata_correct"] += actual_job[field] == value
            if actual_job[field] != value:
                differences.append({"kind": "job_metadata", "field": field,
                                    "expected": value, "actual": actual_job[field]})
        expected_responsibilities = case["expected_responsibilities"]
        counts["responsibilities_expected"] += len(expected_responsibilities)
        counts["responsibilities_correct"] += sum(
            line in analysis.job.responsibilities for line in expected_responsibilities)
        leaked = [line for line in case["excluded_evidence"]
                  if any(line in source.quote or line == row.text
                         for row in predicted for source in row.evidence)]
        counts["excluded_clause_leaks"] += len(leaked)
        if leaked:
            differences.append({"kind": "excluded_clause_leak", "actual": leaked})
        outputs.append({
            "id": case["id"], "scenario": case["scenario"],
            "expected_requirements": len(expected), "predicted_requirements": len(predicted),
            "matched_requirements": len(matched),
            "expected_skills": sorted(expected_skills), "predicted_skills": sorted(predicted_skills),
            "comparison_statuses": statuses, "differences": differences,
            "passed": not differences,
        })

    return {
        "dataset": "fictional-jobs-v1", "dataset_size": len(cases),
        "methodology": {
            "source": str(FIXTURE_PATH.relative_to(Path(__file__).parent)),
            "expected_annotations": "Authored before analyzer execution; synthetic profiles and companies only.",
            "pairing": "One-to-one category, canonical skill set and independently annotated source excerpt; no generated IDs used as labels.",
            "skill_unit": "Unique canonical skill names per job across qualification clauses.",
            "classification_denominator": "All independently annotated required/preferred clauses, including extraction misses.",
            "evidence_denominator": "All extracted requirements; unsupported requirements cannot receive evidence credit.",
            "comparison_denominator": "All expected qualification clauses, including extraction misses.",
            "review": "Synthetic unverified client workflow assertions, not authenticated approvals.",
        },
        "counts": counts,
        "metrics": {
            "skill_precision": _ratio(counts["skill_correct"], counts["skill_predicted"]),
            "skill_recall": _ratio(counts["skill_correct"], counts["skill_expected"]),
            "required_preferred_classification_accuracy": _ratio(counts["classification_correct"], counts["classification_expected"]),
            "evidence_correctness": _ratio(counts["evidence_correct"], counts["evidence_predicted"]),
            "unsupported_requirement_rate": _ratio(counts["unsupported_requirements"], counts["requirements_predicted"]),
            "comparison_status_correctness": _ratio(counts["comparison_correct"], counts["comparison_expected"]),
            "requirement_recall": _ratio(counts["requirements_matched"], counts["requirements_expected"]),
            "explicit_job_metadata_correctness": _ratio(counts["metadata_correct"], counts["metadata_expected"]),
        },
        "limitations": [
            "Ten small fictional, primarily heading-based job descriptions are a development regression corpus, not a representative employment benchmark.",
            "The same deterministic engine authors predictions only; expected annotations are static and must not be changed merely to improve metrics.",
            "Exact source-bound clause pairing can penalize alternative grouping of valid requirements; inspect every reported difference.",
            "Synthetic comparison labels evaluate documented mentions and conservative review behavior, not candidate ability, eligibility or hiring outcomes.",
            "A clean result on these examples does not establish accuracy for arbitrary prose, other languages, degree equivalence, complex alternatives or protected-language variants.",
        ],
        "cases": outputs,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Optional JSON artifact path; parent directory must already exist.")
    args = parser.parse_args()
    result = evaluate()
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
