"""Source-bound evaluation of independently annotated fictional realistic posts.

Expected annotations are static JSON, never inferred by either analyzer. Use
--baseline-root to load the frozen Phase 4 app in a separate interpreter; this
prevents current models or vocabularies from contaminating baseline predictions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

FIXTURE_PATH = Path(__file__).parent / "tests" / "fixtures" / "jobs_realistic.json"
METADATA_FIELDS = ("title", "company", "location", "employment_type", "work_mode")


def load_cases(path: Path = FIXTURE_PATH) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def ratio(correct: int, denominator: int) -> float | None:
    return correct / denominator if denominator else None


def source_span(text: str, quote: str) -> tuple[int, int]:
    """All independent annotations name an unambiguous complete source clause."""
    # Short clauses such as Python can also occur in a contact or hashtag. The
    # annotation therefore binds to an entire physical line, with bullet prefixes.
    cursor = 0
    for raw in text.splitlines(keepends=True):
        line = raw.rstrip("\r\n")
        trimmed = line.strip().lstrip("•-* ")
        if trimmed == quote:
            offset = line.index(quote)
            return cursor + offset, cursor + offset + len(quote)
        cursor += len(raw)
    positions = [index for index in range(len(text)) if text.startswith(quote, index)]
    if len(positions) != 1:
        raise ValueError(f"Ambiguous annotation quote: {quote!r}")
    return positions[0], positions[0] + len(quote)


def valid_evidence(evidence: dict[str, Any], text: str) -> bool:
    start, end, quote = evidence.get("start"), evidence.get("end"), evidence.get("quote")
    return (isinstance(start, int) and isinstance(end, int) and isinstance(quote, str)
            and 0 <= start < end <= len(text) and text[start:end] == quote)


def supports_span(row: dict[str, Any], span: tuple[int, int], text: str) -> bool:
    """Require real source offsets and overlap with an independently positive clause."""
    begin, finish = span
    return any(valid_evidence(evidence, text)
               and max(begin, evidence["start"]) < min(finish, evidence["end"])
               and (begin <= evidence["start"] < evidence["end"] <= finish
                    or evidence["start"] <= begin < finish <= evidence["end"])
               for evidence in row.get("evidence", []))


def positive_clause_evidence(row: dict[str, Any], span: tuple[int, int], text: str) -> bool:
    """An oversized exact quote must not receive independent clause-evidence credit."""
    begin, finish = span
    sources = row.get("evidence", [])
    return bool(sources) and all(valid_evidence(source, text)
                                 and begin <= source["start"] < source["end"] <= finish
                                 for source in sources)


def evaluate(cases=None, analyzer=None) -> dict[str, Any]:
    cases = load_cases() if cases is None else cases
    if analyzer is None:
        from app.services.jobs import DeterministicJobAnalyzer
        analyzer = DeterministicJobAnalyzer()
    counts = dict(
        technical_mentions_correct=0, technical_mentions_predicted=0, technical_mentions_expected=0,
        requirements_matched=0, requirements_predicted=0, requirements_expected=0,
        classification_correct=0, classification_expected=0,
        origin_correct=0, origin_expected=0,
        metadata_correct=0, metadata_expected=0,
        explicit_metadata_correct=0, explicit_metadata_expected=0,
        absent_metadata_correct=0, absent_metadata_expected=0,
        metadata_evidence_correct=0, metadata_evidence_expected=0,
        requirement_evidence_correct=0, requirement_evidence_predicted=0,
        negative_clauses_leaked=0, negative_clauses_expected=0,
        unsupported_requirements=0,
    )
    outputs = []
    for case in cases:
        text = case["text"]
        analysis = analyzer.analyze(text)
        data = analysis.model_dump(mode="json") if hasattr(analysis, "model_dump") else analysis
        predicted = data["requirements"]
        expected = case["expected_requirements"]
        spans = [source_span(text, row["evidence"]) for row in expected]
        remaining = set(range(len(predicted)))
        matched: dict[int, int] = {}
        differences = []
        for expected_index, annotation in enumerate(expected):
            index = next((index for index in sorted(remaining)
                          if supports_span(predicted[index], spans[expected_index], text)), None)
            if index is None:
                differences.append({"kind": "missing_requirement", "key": annotation["key"],
                                    "expected_evidence": annotation["evidence"]})
                continue
            remaining.remove(index)
            matched[expected_index] = index
            row = predicted[index]
            for field in ("category", "classification", "origin"):
                actual = row.get(field, "qualification" if field == "origin" else None)
                if actual != annotation[field]:
                    differences.append({"kind": field, "key": annotation["key"],
                                        "expected": annotation[field], "actual": actual})
            actual_skills = {skill["name"] for skill in row.get("technical_skills", [])}
            expected_skills = set(annotation["skills"])
            if actual_skills != expected_skills:
                differences.append({"kind": "technical_mentions", "key": annotation["key"],
                                    "missing": sorted(expected_skills - actual_skills),
                                    "extra": sorted(actual_skills - expected_skills)})

        # Technical mentions are matched independently of category/classification:
        # a recovered technology can receive recall credit even when its origin
        # is incorrectly promoted to a qualification. Repeated names on distinct
        # independently annotated source clauses are distinct units.
        available_mentions = {(index, skill) for index, row in enumerate(expected)
                              for skill in set(row["skills"])}
        correct_mentions = 0
        for row in predicted:
            for skill in {skill["name"] for skill in row.get("technical_skills", [])}:
                key = next((key for key in sorted(available_mentions)
                            if key[1] == skill and supports_span(row, spans[key[0]], text)), None)
                if key is not None:
                    available_mentions.remove(key)
                    correct_mentions += 1
        expected_mention_count = sum(len(set(row["skills"])) for row in expected)
        predicted_mention_count = sum(len({skill["name"] for skill in row.get("technical_skills", [])})
                                      for row in predicted)
        counts["technical_mentions_correct"] += correct_mentions
        counts["technical_mentions_expected"] += expected_mention_count
        counts["technical_mentions_predicted"] += predicted_mention_count
        counts["requirements_expected"] += len(expected)
        counts["requirements_predicted"] += len(predicted)
        counts["requirements_matched"] += len(matched)
        counts["classification_expected"] += len(expected)
        counts["classification_correct"] += sum(
            predicted[index]["classification"] == expected[annotation_index]["classification"]
            for annotation_index, index in matched.items())
        counts["origin_expected"] += len(expected)
        counts["origin_correct"] += sum(
            predicted[index].get("origin", "qualification") == expected[annotation_index]["origin"]
            for annotation_index, index in matched.items())
        counts["requirement_evidence_predicted"] += len(predicted)
        counts["requirement_evidence_correct"] += sum(
            positive_clause_evidence(predicted[index], spans[annotation_index], text)
            for annotation_index, index in matched.items())

        unsupported_indices = set(remaining)
        for annotation_index, index in matched.items():
            row, annotation = predicted[index], expected[annotation_index]
            extra_skills = {skill["name"] for skill in row.get("technical_skills", [])} - set(annotation["skills"])
            if (row["category"] != annotation["category"] or extra_skills
                    or not positive_clause_evidence(row, spans[annotation_index], text)
                    or annotation["origin"] == "technical_environment"
                    and (row.get("origin", "qualification") != "technical_environment"
                         or row["classification"] != "unspecified")):
                unsupported_indices.add(index)
        counts["unsupported_requirements"] += len(unsupported_indices)
        for index in sorted(unsupported_indices):
            differences.append({"kind": "unsupported_requirement", "actual": predicted[index]["text"]})

        leaked = []
        for clause in case["negative_clauses"]:
            span = source_span(text, clause)
            if any(supports_span(row, span, text)
                   or any(clause in evidence.get("quote", "") for evidence in row.get("evidence", []))
                   for row in predicted):
                leaked.append(clause)
        counts["negative_clauses_expected"] += len(case["negative_clauses"])
        counts["negative_clauses_leaked"] += len(leaked)
        if leaked:
            differences.append({"kind": "negative_clause_leak", "actual": leaked})

        actual_job = data["job"]
        for field in METADATA_FIELDS:
            value = case["expected_job"][field]
            actual = actual_job.get(field)
            correct = actual == value
            counts["metadata_expected"] += 1
            counts["metadata_correct"] += correct
            prefix = "explicit" if value is not None else "absent"
            counts[f"{prefix}_metadata_expected"] += 1
            counts[f"{prefix}_metadata_correct"] += correct
            if not correct:
                differences.append({"kind": "metadata", "field": field, "expected": value, "actual": actual})
            if value is None:
                continue
            counts["metadata_evidence_expected"] += 1
            quote = case["expected_metadata_evidence"][field]
            metadata_sources = actual_job.get("metadata_evidence", {}).get(field, [])
            expected_start = text.index(quote)
            correct_source = (correct and bool(metadata_sources)
                              and all(valid_evidence(source, text) for source in metadata_sources)
                              and any(source["start"] <= expected_start
                                      and expected_start + len(quote) <= source["end"]
                                      for source in metadata_sources))
            counts["metadata_evidence_correct"] += correct_source
            if not correct_source:
                differences.append({"kind": "metadata_evidence", "field": field,
                                    "expected_source": quote})
        outputs.append({
            "id": case["id"], "scenario": case["scenario"],
            "expected_requirements": len(expected), "predicted_requirements": len(predicted),
            "matched_requirements": len(matched),
            "technical_mentions": {"correct": correct_mentions, "predicted": predicted_mention_count,
                                   "expected": expected_mention_count},
            "expected_job": case["expected_job"],
            "actual_job": {field: actual_job.get(field) for field in METADATA_FIELDS},
            "differences": differences, "passed": not differences,
        })
    return {
        "dataset": "fictional-realistic-jobs-v1", "dataset_size": len(cases),
        "fixture_sha256": hashlib.sha256(FIXTURE_PATH.read_bytes()).hexdigest(),
        "methodology": {
            "annotations": "Independent static clauses, canonical names, all three classifications, origins, metadata and negative examples were written before analyzer execution.",
            "technical_mention_unit": "A unique canonical name on each independently annotated source clause. The same name on a different clause is another unit; aliases within one clause are one unit.",
            "technical_pairing": "One-to-one canonical names anchored to independently positive source spans, independent of predicted classification/category.",
            "classification_and_origin_denominator": "All expected clauses, including required, preferred, unspecified and extraction misses. Missing baseline origin is qualification.",
            "metadata": "Exact title/company/location/employment_type/work_mode across all cases. Explicit-value and expected-null checks are additionally reported separately, avoiding a majority-null headline.",
            "source_evidence": "Predicted requirements must have exact original Unicode offsets and quotes contained within their independently positive clause. Oversized quotes spanning unrelated text receive no evidence credit. Metadata evidence has its own explicit-field denominator; missing baseline evidence is incorrect.",
            "false_positive_denominator": "All independently annotated excluded clauses, not predicted skills or requirements. A negative clause leaking into any requirement is one false positive.",
            "unsupported_requirement": "A predicted row with no independently positive source clause, a source/category/technical-fact error, or an environment-only mention promoted to a qualification or required/preferred status.",
            "baseline_isolation": "Frozen app imported by --app-root in a separate interpreter, with no current app model or vocabulary imports.",
        },
        "counts": counts,
        "metrics": {
            "technical_mention_precision": ratio(counts["technical_mentions_correct"], counts["technical_mentions_predicted"]),
            "technical_mention_recall": ratio(counts["technical_mentions_correct"], counts["technical_mentions_expected"]),
            "classification_accuracy": ratio(counts["classification_correct"], counts["classification_expected"]),
            "origin_accuracy": ratio(counts["origin_correct"], counts["origin_expected"]),
            "metadata_accuracy": ratio(counts["metadata_correct"], counts["metadata_expected"]),
            "explicit_metadata_accuracy": ratio(counts["explicit_metadata_correct"], counts["explicit_metadata_expected"]),
            "absent_metadata_accuracy": ratio(counts["absent_metadata_correct"], counts["absent_metadata_expected"]),
            "metadata_evidence_correctness": ratio(counts["metadata_evidence_correct"], counts["metadata_evidence_expected"]),
            "source_evidence_correctness": ratio(counts["requirement_evidence_correct"], counts["requirement_evidence_predicted"]),
            "false_positive_rate": ratio(counts["negative_clauses_leaked"], counts["negative_clauses_expected"]),
            "unsupported_requirement_rate": ratio(counts["unsupported_requirements"], counts["requirements_predicted"]),
            "requirement_recall": ratio(counts["requirements_matched"], counts["requirements_expected"]),
        },
        "limitations": [
            "Fourteen fictional posts are development regressions, not representative real-world performance, independent holdouts or employment outcome evidence.",
            "The same expectations score before and after. New tests intentionally guide implementation; expectations must not be changed just to obtain passing metrics.",
            "Source-bound clause grouping can penalize a valid alternative extraction grouping; inspect per-case differences.",
            "False-positive rates apply only to the explicitly annotated negative clauses and cannot be extrapolated to arbitrary job advertisements.",
        ],
        "cases": outputs,
    }


def app_fingerprint(app_root: Path) -> dict[str, Any]:
    app_path = app_root / "app"
    files = {path.relative_to(app_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
             for path in sorted(app_path.rglob("*.py"))}
    return {"python_files": len(files), "sha256": files}


def evaluate_isolated(app_root: Path, fixture_path: Path) -> dict[str, Any]:
    command = [sys.executable, str(Path(__file__).resolve()), "--app-root", str(app_root.resolve()),
               "--fixture", str(fixture_path.resolve())]
    completed = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
    return json.loads(completed.stdout)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fixture", type=Path, default=FIXTURE_PATH)
    parser.add_argument("--app-root", type=Path, help="Import this app directory's parent before any app imports.")
    parser.add_argument("--baseline-root", type=Path, help="Frozen baseline app parent; evaluated in a fresh interpreter.")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--example-output", type=Path, help="Optional fictional AI Architect analysis JSON.")
    args = parser.parse_args()
    if args.app_root:
        sys.path.insert(0, str(args.app_root.resolve()))
    FIXTURE_PATH = args.fixture
    cases = load_cases(args.fixture)
    after = evaluate(cases)
    app_root = args.app_root or Path(__file__).parent
    after["app_fingerprint"] = app_fingerprint(app_root)
    if args.baseline_root:
        before = evaluate_isolated(args.baseline_root, args.fixture)
        result = {
            "dataset": after["dataset"], "dataset_size": after["dataset_size"],
            "fixture_sha256": after["fixture_sha256"],
            "baseline": "Frozen Phase 4 app, isolated import; exact source file SHA256 fingerprints included.",
            "before": before, "after": after,
        }
    else:
        result = after
    if args.example_output:
        from app.services.jobs import DeterministicJobAnalyzer
        example = DeterministicJobAnalyzer().analyze(next(case["text"] for case in cases if case["id"] == "ai_architect_fr"))
        args.example_output.write_text(json.dumps(example.model_dump(mode="json"), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
