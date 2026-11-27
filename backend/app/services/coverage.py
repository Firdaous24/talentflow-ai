"""Candidate-space views derived from existing results (phase 7).

- Coverage counts come from `compare_job` results only: no score, no weight,
  no percentage. Technical-environment clauses are never counted, as in the
  comparison itself (design §3.2).
- Gaps list what is not documented, or needs a person's interpretation, with a
  fixed message key. They never write, suggest or generate candidate content:
  the candidate decides whether a criterion is true and adds it themself.
- The version diff compares the candidate's own profiles, item by item.
"""

import json
from typing import Literal

from pydantic import Field

from app.models.candidate import CandidateProfile, Schema
from app.models.job import (
    QualificationCertification,
    QualificationEducation,
    QualificationExperience,
    QualificationLanguage,
    QualificationProfile,
    QualificationProject,
    RequirementCategory,
    RequirementClassification,
    RequirementComparison,
)

GapKind = Literal["add_if_true", "interpretation"]
ProfileSection = Literal["education", "experience", "technical_skills", "projects", "certifications", "languages"]
InterpretationReason = Literal["duration_or_level", "equivalence", "language_level", "context"]

# Where a candidate would look in their own CV to add a missing criterion, if it is true.
GAP_SECTIONS: dict[str, ProfileSection] = {
    "technical_skill": "technical_skills",
    "experience": "experience",
    "education": "education",
    "certification": "certifications",
    "language": "languages",
    "other": "experience",
}
# Why a person must interpret a criterion; the interface shows a fixed, translated sentence.
INTERPRETATION_REASONS: dict[str, InterpretationReason] = {
    "experience": "duration_or_level",
    "education": "equivalence",
    "certification": "equivalence",
    "language": "language_level",
    "technical_skill": "context",
    "other": "context",
}
SECTIONS: tuple[ProfileSection, ...] = ("education", "experience", "technical_skills", "projects", "certifications", "languages")
CONTACT_FIELDS = ("full_name", "email", "phone", "linkedin_url", "github_url")


class CoverageCounts(Schema):
    """« x/y requis · a/b souhaités · n à interpréter », counted exactly as displayed."""

    required_documented: int = Field(ge=0)
    required_total: int = Field(ge=0)
    preferred_documented: int = Field(ge=0)
    preferred_total: int = Field(ge=0)
    unspecified_documented: int = Field(ge=0)
    unspecified_total: int = Field(ge=0)
    needs_review: int = Field(ge=0)


class Gap(Schema):
    requirement_id: str
    requirement_text: str
    category: RequirementCategory
    classification: RequirementClassification
    status: Literal["not_documented", "needs_review"]
    kind: GapKind
    section: ProfileSection
    reason: InterpretationReason | None = None


class SectionDiff(Schema):
    section: ProfileSection
    added: list[str]
    removed: list[str]
    unchanged: int


class FieldChange(Schema):
    field: str
    change: Literal["added", "removed", "changed"]


def counted(comparisons: list[RequirementComparison]) -> list[RequirementComparison]:
    return [item for item in comparisons if item.origin == "qualification"]


def coverage_counts(comparisons: list[RequirementComparison]) -> CoverageCounts:
    items = counted(comparisons)

    def count(classification: str, documented: bool) -> int:
        return sum(1 for item in items if item.classification == classification and (not documented or item.status == "documented"))

    return CoverageCounts(
        required_documented=count("required", True), required_total=count("required", False),
        preferred_documented=count("preferred", True), preferred_total=count("preferred", False),
        unspecified_documented=count("unspecified", True), unspecified_total=count("unspecified", False),
        needs_review=sum(1 for item in items if item.status == "needs_review"),
    )


def gaps(comparisons: list[RequirementComparison]) -> list[Gap]:
    result = []
    for item in counted(comparisons):
        if item.status == "documented":
            continue
        result.append(Gap(
            requirement_id=item.requirement_id, requirement_text=item.requirement_text, category=item.category,
            classification=item.classification, status=item.status,
            kind="add_if_true" if item.status == "not_documented" else "interpretation",
            section=GAP_SECTIONS[item.category],
            reason=INTERPRETATION_REASONS[item.category] if item.status == "needs_review" else None,
        ))
    return result


def qualification_projection(profile: CandidateProfile) -> QualificationProfile:
    """Qualification fields only: identity, contact, employers, places, dates and URLs never travel."""
    return QualificationProfile(
        education=[QualificationEducation(degree=item.degree, field_of_study=item.field_of_study) for item in profile.education],
        experience=[QualificationExperience(job_title=item.job_title, description=item.description, technologies=list(item.technologies)) for item in profile.experience],
        technical_skills=[skill.model_copy() for skill in profile.technical_skills],
        projects=[QualificationProject(name=item.name, description=item.description, technologies=list(item.technologies)) for item in profile.projects],
        certifications=[QualificationCertification(name=item.name) for item in profile.certifications],
        languages=[QualificationLanguage(name=item.name, proficiency=item.proficiency) for item in profile.languages],
    )


def item_label(section: ProfileSection, item: dict) -> str:
    parts = {
        "education": [item.get("degree"), item.get("field_of_study"), item.get("institution")],
        "experience": [item.get("job_title"), item.get("company")],
        "technical_skills": [item.get("name")],
        "projects": [item.get("name")],
        "certifications": [item.get("name"), item.get("issuer")],
        "languages": [item.get("name"), item.get("proficiency")],
    }[section]
    label = " · ".join(str(part) for part in parts if part)
    return label or (item.get("description") or "")[:80] or "—"


def profile_diff(old: CandidateProfile, new: CandidateProfile) -> tuple[list[FieldChange], list[SectionDiff]]:
    before, after = old.model_dump(mode="json"), new.model_dump(mode="json")
    fields = []
    for name in CONTACT_FIELDS:
        if before[name] != after[name]:
            change = "added" if before[name] is None else "removed" if after[name] is None else "changed"
            fields.append(FieldChange(field=name, change=change))
    sections = []
    for section in SECTIONS:
        old_items = [json.dumps(item, sort_keys=True) for item in before[section]]
        new_items = [json.dumps(item, sort_keys=True) for item in after[section]]
        remaining = list(old_items)
        added = []
        for item in new_items:
            if item in remaining:
                remaining.remove(item)
            else:
                added.append(item_label(section, json.loads(item)))
        removed = [item_label(section, json.loads(item)) for item in remaining]
        sections.append(SectionDiff(section=section, added=added, removed=removed, unchanged=len(new_items) - len(added)))
    return fields, sections
