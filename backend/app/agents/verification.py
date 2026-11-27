"""Independent source/path/span/provenance checks on deterministic comparison output."""

import hashlib
import json
import re

from app.agents.errors import WorkflowFault
from app.models.job import JobComparisonRequest, JobComparisonResponse
from app.services.job_vocabulary import norm, skills_in
from app.services.jobs import (
    CONTACT_TEXT,
    LIMITATIONS,
    PROTECTED,
    DeterministicJobAnalyzer,
    compare_requirement,
    qualification_leaves,
    technical_profile_index,
    validate_review,
)

PHONE = re.compile(r"(?<!\w)(?:\+\d[\d ().-]{6,}\d|\d{7,15}|\(?\d{3}\)?[- .]\d{3}[- .]\d{4}|(?:\d{2}[- .]){4}\d{2})(?!\w)")


def snapshot_hash(comparison) -> str:
    serialized = json.dumps(comparison.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def validate_minimization(request: JobComparisonRequest) -> None:
    """Reject obvious contact/protected text before any checkpoint is created.

    The strict existing qualification schema excludes identity/employer/location
    keys. Arbitrary free text cannot be proven anonymous; this is local-only.
    """
    def strings(value):
        if isinstance(value, str):
            yield value
        elif isinstance(value, dict):
            for child in value.values():
                yield from strings(child)
        elif isinstance(value, list):
            for child in value:
                yield from strings(child)
    for profile in (request.candidate, request.review.candidate_snapshot):
        for text in strings(profile.model_dump()):
            if CONTACT_TEXT.search(text) or PHONE.search(text) or PROTECTED.search(norm(text)):
                raise WorkflowFault("privacy_boundary", "Remove contact details and irrelevant personal information from qualification fields before starting the local workflow.", node="intake_validation")


def verify_evidence(request: JobComparisonRequest, result: JobComparisonResponse) -> None:
    """Reject source drift, invented fields/technologies, duplicates and changed rules."""
    def fail():
        raise WorkflowFault("evidence_inconsistent", "Evidence failed source, qualification-field or provenance verification. Recheck the reviewed documents and start a new workflow.", node="evidence_verification")

    validate_minimization(request)
    original = validate_review(request, DeterministicJobAnalyzer())
    originals = {item.id: item for item in original.requirements}
    reviewed = {item.id: item for item in request.requirements}
    if [item.requirement_id for item in result.comparisons] != [item.id for item in request.requirements]:
        fail()
    leaves = list(qualification_leaves(request.candidate))
    allowed = dict(leaves)
    technical_index = technical_profile_index(leaves)

    def check_candidate(evidence, technology=None):
        seen = set()
        for item in evidence:
            if allowed.get(item.field) != item.quote or item.unverified is not True:
                fail()
            span = item.excerpt
            if span and (not 0 <= span.start < span.end <= len(item.quote) or item.quote[span.start:span.end] != span.quote):
                fail()
            key = (item.field, item.quote, span.start if span else None, span.end if span else None)
            if key in seen:
                fail()
            seen.add(key)
            if technology and technology not in {skill.name for skill in skills_in(item.quote)}:
                fail()

    for row in result.comparisons:
        source, human = originals[row.requirement_id], reviewed[row.requirement_id]
        if (row.requirement_text, row.original_requirement_text, row.category, row.classification, row.origin) != (human.text, source.text, human.category, human.classification, source.origin):
            fail()
        if row.job_evidence != source.evidence:
            fail()
        if any(original.job.text[span.start:span.end] != span.quote for span in row.job_evidence):
            fail()
        check_candidate(row.candidate_evidence)
        # Reuse the existing row rule, rather than duplicate lexical/proficiency
        # semantics. This checks status AND evidence relevance, not just valid paths.
        if row != compare_requirement(source, human, leaves, technical_index):
            fail()

    expected_technologies = {}
    for human in request.requirements:
        source = originals[human.id]
        for skill in source.technical_skills:
            expected_technologies.setdefault(skill.name, (skill.category, []))[1].append(source)
    if len(result.technical_evidence) != len(expected_technologies) or {item.name for item in result.technical_evidence} != set(expected_technologies):
        fail()
    rows = {row.requirement_id: row for row in result.comparisons}
    for technology in result.technical_evidence:
        category, sources = expected_technologies[technology.name]
        if technology.category != category or len(technology.job_references) != len(sources):
            fail()
        for reference, source in zip(technology.job_references, sources, strict=True):
            if (reference.requirement_id, reference.origin, reference.classification, reference.evidence) != (source.id, source.origin, source.classification, source.evidence):
                fail()
        interpretation = any(source.origin == "technical_environment" or source.classification == "unspecified" or rows[source.id].status == "needs_review" for source in sources)
        if technology.requires_interpretation != interpretation:
            fail()
        check_candidate(technology.candidate_evidence, technology.name)
        if technology.candidate_evidence != technical_index.get(technology.name, []):
            fail()
    if result.method != "qualification-document-checklist-v1" or result.review_assertion != "unverified_client_assertion" or result.warnings != LIMITATIONS:
        fail()
