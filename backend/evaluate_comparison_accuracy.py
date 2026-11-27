"""Frozen, independent comparison evaluation with isolated before/after engines.

Run with --baseline-root ../.artifacts/phase43-baseline to compare an immutable
app snapshot to current production code in separate interpreter processes.
Expected annotations and their SHA-256 are never generated from predictions.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

BACKEND_ROOT = Path(__file__).resolve().parent
FIXTURE_PATH = BACKEND_ROOT / "tests" / "fixtures" / "comparison_accuracy.json"
MANIFEST_PATH = FIXTURE_PATH.with_suffix(".manifest.json")


def load_cases(path: Path = FIXTURE_PATH) -> list[dict[str, Any]]:
    return json.loads(path.read_text(encoding="utf-8"))["cases"]


def verify_freeze(path: Path = FIXTURE_PATH, manifest_path: Path = MANIFEST_PATH) -> str:
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    if digest != manifest["sha256"]:
        raise ValueError("Frozen independent comparison fixture hash changed; investigate rather than silently relabeling.")
    return digest


def app_fingerprint(app_root: Path) -> dict[str, str]:
    return {path.relative_to(app_root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted((app_root / "app").rglob("*.py"))}


def verify_app_manifest(app_root: Path) -> dict[str, Any]:
    """Refuse a changed/mixed baseline rather than silently reporting a before."""
    manifest_path = app_root / "manifest.json"
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw.decode("utf-8-sig"))
    actual = app_fingerprint(app_root)
    if actual != manifest["files"]:
        raise ValueError("Frozen baseline app files differ from their manifest; before/after evaluation was refused.")
    return {"label": manifest.get("label"), "date": manifest.get("date"),
            "manifest_sha256": hashlib.sha256(raw).hexdigest(),
            "verified_python_files": len(actual), "files": actual}


def ratio(correct: int, denominator: int) -> float | None:
    return correct / denominator if denominator else None


def field_value(profile: dict[str, Any], path: str) -> str | None:
    value: Any = profile
    try:
        for key in path.split("."):
            value = value[int(key)] if isinstance(value, list) else value[key]
    except (KeyError, IndexError, TypeError, ValueError):
        return None
    return value if isinstance(value, str) else None


def source_span(text: str, quote: str) -> tuple[int, int]:
    cursor = 0
    for raw in text.splitlines(keepends=True):
        line = raw.rstrip("\r\n")
        if line.strip().lstrip("-*• ") == quote:
            start = cursor + line.index(quote)
            return start, start + len(quote)
        cursor += len(raw)
    positions = [index for index in range(len(text)) if text.startswith(quote, index)]
    if len(positions) != 1:
        raise ValueError(f"Independent source annotation is ambiguous: {quote!r}")
    return positions[0], positions[0] + len(quote)


def valid_span(source: dict[str, Any], text: str) -> bool:
    start, end, quote = source.get("start"), source.get("end"), source.get("quote")
    return (isinstance(start, int) and isinstance(end, int) and isinstance(quote, str)
            and 0 <= start < end <= len(text) and text[start:end] == quote)


def selected_quote(evidence: dict[str, Any]) -> str:
    excerpt = evidence.get("excerpt")
    return excerpt["quote"] if isinstance(excerpt, dict) and isinstance(excerpt.get("quote"), str) else evidence.get("quote", "")


def valid_candidate_source(evidence: dict[str, Any], profile: dict[str, Any]) -> bool:
    original = field_value(profile, evidence.get("field", ""))
    quote = evidence.get("quote")
    if not original or not isinstance(quote, str) or quote not in original:
        return False
    # Legacy full fields and exact source-bound spans are both source-grounded.
    # The additive excerpt, if supplied, must point into the preserved quote.
    excerpt = evidence.get("excerpt")
    return excerpt is None or isinstance(excerpt, dict) and valid_span(excerpt, quote)


def normalized_bullet(value: str) -> str:
    return re.sub(r"^\s*[-*•]\s*", "", value).strip()


def _predict(cases: list[dict[str, Any]], app_root: Path) -> list[dict[str, Any]]:
    """Worker only: imports occur after selecting the isolated app root."""
    sys.path.insert(0, str(app_root.resolve()))
    from pydantic import ValidationError

    from app.models.job import JobComparisonRequest, JobReviewAssertion, QualificationProfile, ReviewedRequirement
    from app.services.extraction import DeterministicCandidateExtractor
    from app.services.jobs import DeterministicJobAnalyzer, compare_job
    from app.services.pdf import PDFText

    outputs = []
    for case in cases:
        analysis = DeterministicJobAnalyzer().analyze(case["job_text"])
        profile = QualificationProfile.model_validate(case["profile"])
        reviewed = [ReviewedRequirement(id=row.id, text=row.text, category=row.category,
                                        classification=row.classification)
                    for row in analysis.requirements]
        comparison, comparison_error = {"comparisons": [], "technical_evidence": []}, None
        if reviewed:
            request = JobComparisonRequest(candidate=profile, job_analysis=analysis, requirements=reviewed,
                review=JobReviewAssertion(candidate_confirmed=True, candidate_snapshot=profile,
                                         requirements_reviewed=True, requirement_snapshot=reviewed))
            try:
                comparison = compare_job(request).model_dump(mode="json")
            except ValueError as error:
                comparison_error = str(error)
        segmentation = None
        if "cv_text" in case:
            segmentation = DeterministicCandidateExtractor().extract(PDFText(case["cv_text"], 1)).candidate.model_dump(mode="json")
        privacy = {}
        for field, canary in case.get("forbidden_profile_fields", {}).items():
            try:
                QualificationProfile.model_validate({**case["profile"], field: canary})
                privacy[field] = False
            except ValidationError:
                privacy[field] = True
        outputs.append({"id": case["id"], "analysis": analysis.model_dump(mode="json"),
                        "comparison": comparison, "comparison_error": comparison_error,
                        "segmentation": segmentation, "privacy_field_rejections": privacy})
    return outputs


def isolated_predictions(app_root: Path, fixture_path: Path = FIXTURE_PATH) -> list[dict[str, Any]]:
    result = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--predict",
                             "--app-root", str(app_root.resolve()), "--fixture", str(fixture_path.resolve())],
                            capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def _candidate_evidence(prediction: dict[str, Any], row: dict[str, Any], annotation: dict[str, Any]) -> list[dict[str, Any]]:
    comparison = prediction["comparison"]
    related = next((item for item in comparison.get("comparisons", []) if item["requirement_id"] == row["id"]), {})
    evidence = list(related.get("candidate_evidence", []))
    for skill in comparison.get("technical_evidence", []):
        if skill["name"] in annotation["technologies"] and any(
            reference["requirement_id"] == row["id"] for reference in skill["job_references"]
        ):
            evidence.extend(skill.get("candidate_evidence", []))
    return list({(item.get("field"), selected_quote(item)): item for item in evidence}.values())


def score_predictions(cases: list[dict[str, Any]], predictions: list[dict[str, Any]]) -> dict[str, Any]:
    """Score independently annotated units; missing output never shrinks truth."""
    counts = dict(
        technology_correct=0, technology_predicted=0, technology_expected=0,
        classification_correct=0, classification_expected=0, origin_correct=0, origin_expected=0,
        job_source_correct=0, job_source_predicted=0,
        comparison_source_correct=0, comparison_source_predicted=0,
        overview_source_correct=0, overview_source_predicted=0,
        overview_mentions_correct=0, overview_mentions_expected=0,
        candidate_source_correct=0, candidate_source_predicted=0,
        segmentation_correct=0, segmentation_expected=0, segmented_cvs_correct=0, segmented_cvs_expected=0,
        relevant_evidence=0, evidence_predicted=0, evidence_expected=0, evidence_recalled=0,
        excerpt_boundaries_correct=0, unsupported_evidence=0,
        privacy_correct=0, privacy_expected=0,
        status_correct=0, status_expected=0,
        requirements_matched=0, requirements_expected=0, requirements_predicted=0,
    )
    by_id = {prediction["id"]: prediction for prediction in predictions}
    output_cases = []
    for case in cases:
        prediction = by_id.get(case["id"], {"analysis": {"requirements": []}, "comparison": {}, "segmentation": None})
        actual = prediction["analysis"]["requirements"]
        expected = case["requirements"]
        counts["requirements_expected"] += len(expected)
        counts["requirements_predicted"] += len(actual)
        counts["classification_expected"] += len(expected)
        counts["origin_expected"] += len(expected)
        counts["status_expected"] += len(expected)
        counts["technology_expected"] += sum(len(row["technologies"]) for row in expected)
        counts["overview_mentions_expected"] += sum(len(row["technologies"]) for row in expected)
        counts["technology_predicted"] += sum(len(row.get("technical_skills", [])) for row in actual)
        counts["job_source_predicted"] += len(actual)
        differences = []
        remaining = set(range(len(actual)))
        matched = {}
        annotation_by_id = {}
        for annotation in expected:
            begin, finish = source_span(case["job_text"], annotation["quote"])
            index = next((index for index in sorted(remaining) if any(
                valid_span(source, case["job_text"]) and max(begin, source["start"]) < min(finish, source["end"])
                for source in actual[index].get("evidence", []))), None)
            counts["evidence_expected"] += len(annotation["evidence"])
            if index is None:
                differences.append({"key": annotation["key"], "kind": "missing_requirement"})
                continue
            remaining.remove(index)
            row = actual[index]
            matched[annotation["key"]] = row["id"]
            annotation_by_id[row["id"]] = annotation
            counts["requirements_matched"] += 1
            skills = {skill["name"] for skill in row.get("technical_skills", [])}
            counts["technology_correct"] += len(skills & set(annotation["technologies"]))
            if skills != set(annotation["technologies"]):
                differences.append({"key": annotation["key"], "kind": "technologies",
                                    "expected": annotation["technologies"], "actual": sorted(skills)})
            for field, metric in (("classification", "classification_correct"), ("origin", "origin_correct")):
                correct = row.get(field, "qualification" if field == "origin" else None) == annotation[field]
                counts[metric] += correct
                if not correct:
                    differences.append({"key": annotation["key"], "kind": field,
                                        "expected": annotation[field], "actual": row.get(field)})
            sources = row.get("evidence", [])
            source_correct = bool(sources) and all(valid_span(source, case["job_text"])
                and begin <= source["start"] < source["end"] <= finish for source in sources)
            counts["job_source_correct"] += source_correct
            if not source_correct:
                differences.append({"key": annotation["key"], "kind": "job_source_boundary"})
            comparison = next((item for item in prediction["comparison"].get("comparisons", [])
                               if item["requirement_id"] == row["id"]), {})
            correct_status = comparison.get("status") == annotation["status"]
            counts["status_correct"] += correct_status
            if not correct_status:
                differences.append({"key": annotation["key"], "kind": "status",
                                    "expected": annotation["status"], "actual": comparison.get("status")})
            evidence = _candidate_evidence(prediction, row, annotation)
            recalled = set()
            for item in evidence:
                counts["candidate_source_predicted"] += 1
                counts["evidence_predicted"] += 1
                grounded = valid_candidate_source(item, case["profile"])
                counts["candidate_source_correct"] += grounded
                selected = selected_quote(item)
                relevant_indices = [index for index, truth in enumerate(annotation["evidence"])
                    if item.get("field") == truth["field"] and truth["quote"] in selected]
                forbidden = any(quote in selected for quote in annotation.get("forbidden_evidence", []))
                relevant = grounded and bool(relevant_indices) and not forbidden
                counts["relevant_evidence"] += relevant
                counts["unsupported_evidence"] += not relevant
                if relevant:
                    recalled.update(relevant_indices)
                boundary = relevant and any(normalized_bullet(selected) == normalized_bullet(annotation["evidence"][index]["quote"])
                                            for index in relevant_indices)
                counts["excerpt_boundaries_correct"] += boundary
                if not relevant or not boundary:
                    differences.append({"key": annotation["key"], "kind": "evidence_boundary" if relevant else "unsupported_evidence",
                                        "field": item.get("field"), "selected_quote": selected,
                                        "source_grounded": grounded})
            counts["evidence_recalled"] += len(recalled)
            for index, truth in enumerate(annotation["evidence"]):
                if index not in recalled:
                    differences.append({"key": annotation["key"], "kind": "missing_supporting_excerpt", "expected": truth})
        for index in sorted(remaining):
            row = actual[index]
            differences.append({"kind": "unexpected_requirement", "actual": row["text"]})
            unsupported = _candidate_evidence(prediction, row,
                {"technologies": [skill["name"] for skill in row.get("technical_skills", [])]})
            for item in unsupported:
                counts["evidence_predicted"] += 1
                counts["candidate_source_predicted"] += 1
                counts["candidate_source_correct"] += valid_candidate_source(item, case["profile"])
                counts["unsupported_evidence"] += 1

        # Output citations also need source checks; checking only analyzer
        # quotes would miss fabricated provenance in the actual comparison UI.
        for comparison in prediction["comparison"].get("comparisons", []):
            counts["comparison_source_predicted"] += 1
            annotation = annotation_by_id.get(comparison["requirement_id"])
            sources = comparison.get("job_evidence", [])
            begin, finish = source_span(case["job_text"], annotation["quote"]) if annotation else (-1, -1)
            correct = annotation is not None and bool(sources) and all(
                valid_span(source, case["job_text"]) and begin <= source["start"] < source["end"] <= finish
                for source in sources)
            counts["comparison_source_correct"] += correct
            if not correct:
                differences.append({"kind": "comparison_source_citation", "requirement_id": comparison["requirement_id"]})
        credited_overview_mentions = set()
        for technical in prediction["comparison"].get("technical_evidence", []):
            for reference in technical.get("job_references", []):
                counts["overview_source_predicted"] += 1
                annotation = annotation_by_id.get(reference["requirement_id"])
                sources = reference.get("evidence", [])
                begin, finish = source_span(case["job_text"], annotation["quote"]) if annotation else (-1, -1)
                correct = (annotation is not None and technical["name"] in annotation["technologies"]
                    and reference.get("classification") == annotation["classification"]
                    and reference.get("origin") == annotation["origin"] and bool(sources)
                    and all(valid_span(source, case["job_text"]) and begin <= source["start"] < source["end"] <= finish
                            for source in sources))
                counts["overview_source_correct"] += correct
                if correct:
                    credited_overview_mentions.add((reference["requirement_id"], technical["name"]))
                else:
                    differences.append({"kind": "overview_source_citation", "requirement_id": reference["requirement_id"], "technology": technical["name"]})
        counts["overview_mentions_correct"] += len(credited_overview_mentions)

        if "segmentation" in case:
            counts["segmented_cvs_expected"] += 1
            cv_differences = []
            profile = prediction.get("segmentation") or {}
            for collection, records in case["segmentation"].items():
                rows = profile.get(collection, [])
                counts["segmentation_expected"] += 1
                count_correct = len(rows) == len(records)
                counts["segmentation_correct"] += count_correct
                if not count_correct:
                    cv_differences.append({"collection": collection, "kind": "entry_count", "expected": len(records), "actual": len(rows)})
                for index, truth in enumerate(records):
                    row = rows[index] if index < len(rows) else None
                    for field in ("job_title", "company", "name"):
                        if field in truth:
                            counts["segmentation_expected"] += 1
                            correct = row is not None and row.get(field) == truth[field]
                            counts["segmentation_correct"] += correct
                            if not correct:
                                cv_differences.append({"collection": collection, "index": index, "field": field,
                                                       "expected": truth[field], "actual": row.get(field) if row else None})
                    description = row.get("description") or "" if row else ""
                    for field, negate in (("contains", False), ("excludes", True)):
                        for phrase in truth[field]:
                            counts["segmentation_expected"] += 1
                            correct = row is not None and ((phrase not in description) if negate else phrase in description)
                            counts["segmentation_correct"] += correct
                            if not correct:
                                cv_differences.append({"collection": collection, "index": index,
                                                       "kind": field, "phrase": phrase})
            counts["segmented_cvs_correct"] += not cv_differences
            if cv_differences:
                differences.append({"kind": "cv_segmentation", "details": cv_differences})

        serialized = json.dumps(prediction.get("comparison", {}), ensure_ascii=False)
        for canary in case.get("privacy_canaries", []):
            counts["privacy_expected"] += 1
            safe = canary not in serialized
            counts["privacy_correct"] += safe
            if not safe:
                differences.append({"kind": "privacy_canary_leak", "canary": canary})
        for field in case.get("forbidden_profile_fields", {}):
            counts["privacy_expected"] += 1
            rejected = prediction.get("privacy_field_rejections", {}).get(field, False)
            counts["privacy_correct"] += rejected
            if not rejected:
                differences.append({"kind": "private_profile_field_accepted", "field": field})
        if prediction.get("comparison_error"):
            differences.append({"kind": "comparison_error", "actual": prediction["comparison_error"]})
        output_cases.append({"id": case["id"], "scenario": case["scenario"],
                             "matched_requirements": matched, "differences": differences, "passed": not differences})

    return {"dataset_size": len(cases), "counts": counts, "metrics": {
        "technology_mention_precision": ratio(counts["technology_correct"], counts["technology_predicted"]),
        "technology_mention_recall": ratio(counts["technology_correct"], counts["technology_expected"]),
        "qualification_classification_accuracy": ratio(counts["classification_correct"], counts["classification_expected"]),
        "source_origin_accuracy": ratio(counts["origin_correct"], counts["origin_expected"]),
        "job_source_evidence_correctness": ratio(counts["job_source_correct"], counts["job_source_predicted"]),
        "comparison_source_citation_correctness": ratio(counts["comparison_source_correct"], counts["comparison_source_predicted"]),
        "technical_overview_citation_correctness": ratio(counts["overview_source_correct"], counts["overview_source_predicted"]),
        "technical_overview_mention_recall": ratio(counts["overview_mentions_correct"], counts["overview_mentions_expected"]),
        "candidate_source_evidence_correctness": ratio(counts["candidate_source_correct"], counts["candidate_source_predicted"]),
        "cv_segmentation_assertion_accuracy": ratio(counts["segmentation_correct"], counts["segmentation_expected"]),
        "cv_complete_segmentation_rate": ratio(counts["segmented_cvs_correct"], counts["segmented_cvs_expected"]),
        "evidence_relevance_precision": ratio(counts["relevant_evidence"], counts["evidence_predicted"]),
        "evidence_relevance_recall": ratio(counts["evidence_recalled"], counts["evidence_expected"]),
        "excerpt_boundary_correctness": ratio(counts["excerpt_boundaries_correct"], counts["evidence_predicted"]),
        "unsupported_evidence_rate": ratio(counts["unsupported_evidence"], counts["evidence_predicted"]),
        "privacy_exclusion_accuracy": ratio(counts["privacy_correct"], counts["privacy_expected"]),
        "comparison_status_correctness": ratio(counts["status_correct"], counts["status_expected"]),
        "requirement_recall": ratio(counts["requirements_matched"], counts["requirements_expected"]),
    }, "cases": output_cases}


def evaluate(baseline_root: Path | None = None, fixture_path: Path = FIXTURE_PATH) -> dict[str, Any]:
    digest = verify_freeze(fixture_path)
    baseline_provenance = verify_app_manifest(baseline_root) if baseline_root is not None else None
    cases = load_cases(fixture_path)
    current = score_predictions(cases, isolated_predictions(BACKEND_ROOT, fixture_path))
    result = {
        "dataset": "comparison-accuracy-v1", "fixture_sha256": digest,
        "current_app_fingerprint": app_fingerprint(BACKEND_ROOT),
        "methodology": {
            "independence": "Static annotations were frozen and SHA-256 recorded before executing this corpus or tuning production code.",
            "isolation": "Baseline and current app imports run in separate interpreter processes; neither engine generates expected labels.",
            "technology_unit": "Canonical technology per independently annotated source clause, preserving repeated source references.",
            "classification_and_status_denominators": "All independently annotated clauses, including extraction misses; classifications include unspecified environment context.",
            "source_evidence": "Job quotes and Unicode offsets must lie within independently annotated clauses. Candidate field/quote and optional excerpt offsets must match submitted source.",
            "evidence_unit": "Unique field/excerpt per clause, unioning checklist and source-referenced technical overview evidence. Full-field excerpts can earn relevance credit but lose boundary credit.",
            "evidence_recall": "All independently expected supporting excerpts remain in the denominator even when a requirement or all evidence is missing.",
            "segmentation": "Four independent realistic plain-text CVs test exact entry counts, title/employer/project associations and required/forbidden description content, without conflating PDF geometry.",
            "privacy": "Reserved-domain fictional canaries must not appear in outputs; identity/contact fields must be rejected by the qualification-only schema.",
            "review": "Synthetic unverified workflow assertions, never authenticated human approvals.",
        },
        "current": current,
        "limitations": [
            "Sixteen small authored development scenarios do not represent real-world recruitment accuracy or population performance.",
            "Strict frozen status taxonomy expects needs_review for an unsupported telecom-sector interpretation; product policy may reasonably use not_documented. This discrepancy remains visible rather than relabeled.",
            "Conservative privacy filtering may omit safe lines when a complete reviewed source field also contains personal data; evidence recall exposes this tradeoff.",
            "Exact clause and concise-excerpt annotations can penalize alternative valid grouping or evidence choices; detailed differences require human inspection.",
            "Plain-text segmentation isolates section/entry logic; separate PDF/layout tests and Chromium workflows cover file ingestion and rendering.",
            "These are document evidence tests, not measurements of ability, proficiency, industry equivalence, suitability or employment outcomes.",
        ],
    }
    if baseline_root is not None:
        result["baseline"] = score_predictions(cases, isolated_predictions(baseline_root, fixture_path))
        # Also catch edits made while the isolated baseline worker was running.
        if verify_app_manifest(baseline_root) != baseline_provenance:
            raise ValueError("Frozen baseline provenance changed during evaluation.")
        result["baseline_provenance"] = baseline_provenance
        result["metric_delta"] = {name: (value - result["baseline"]["metrics"][name]
            if value is not None and result["baseline"]["metrics"][name] is not None else None)
            for name, value in current["metrics"].items()}
    return result


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-root", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--fixture", type=Path, default=FIXTURE_PATH)
    parser.add_argument("--predict", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--app-root", type=Path, default=BACKEND_ROOT, help=argparse.SUPPRESS)
    args = parser.parse_args()
    result = _predict(load_cases(args.fixture), args.app_root) if args.predict else evaluate(args.baseline_root, args.fixture)
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
