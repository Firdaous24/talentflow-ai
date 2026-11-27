"""Coverage counts, gaps and diffs derive only from compare_job and the candidate's own profile."""

import pytest
from conftest import SYNTHETIC_CVS, make_pdf

from app.api.v2.candidate import review_request
from app.models.candidate import CandidateProfile, TechnicalSkill
from app.models.job import ReviewedRequirement
from app.services import coverage
from app.services.extraction import DeterministicCandidateExtractor
from app.services.jobs import DeterministicJobAnalyzer, compare_job
from app.services.pdf import extract_pdf

JOB = """Backend Developer
Required qualifications:
- Python
- Docker
- Fluent English
Preferred qualifications:
- Kubernetes
- FastAPI
Technical environment: PostgreSQL, Redis
"""


@pytest.fixture(scope="module")
def candidate() -> CandidateProfile:
    return DeterministicCandidateExtractor().extract(extract_pdf(make_pdf(SYNTHETIC_CVS[0]["text"]))).candidate


def run(profile: CandidateProfile, reviewed: list[ReviewedRequirement] | None = None):
    analysis = DeterministicJobAnalyzer().analyze(JOB)
    requirements = reviewed or [ReviewedRequirement(id=item.id, text=item.text, category=item.category, classification=item.classification) for item in analysis.requirements]
    return compare_job(review_request(analysis, requirements, coverage.qualification_projection(profile)))


def test_counts_match_the_comparison_exactly(candidate):
    result = run(candidate)
    statuses = {item.requirement_text: (item.status, item.classification, item.origin) for item in result.comparisons}
    assert statuses == {
        "Python": ("documented", "required", "qualification"),
        "Docker": ("not_documented", "required", "qualification"),
        "Fluent English": ("needs_review", "required", "qualification"),
        "Kubernetes": ("not_documented", "preferred", "qualification"),
        "FastAPI": ("documented", "preferred", "qualification"),
        "PostgreSQL, Redis": ("needs_review", "unspecified", "technical_environment"),
    }
    counts = coverage.coverage_counts(result.comparisons)
    # « 1/3 requis · 1/2 souhaités · 1 à interpréter »: the environment clause is never counted.
    assert counts.model_dump() == {
        "required_documented": 1, "required_total": 3, "preferred_documented": 1, "preferred_total": 2,
        "unspecified_documented": 0, "unspecified_total": 0, "needs_review": 1,
    }


def test_counts_follow_the_reviewed_classification(candidate):
    analysis = DeterministicJobAnalyzer().analyze(JOB)
    reviewed = [ReviewedRequirement(id=item.id, text=item.text, category=item.category, classification="preferred" if item.text == "Docker" else item.classification) for item in analysis.requirements]
    counts = coverage.coverage_counts(run(candidate, reviewed).comparisons)
    assert (counts.required_total, counts.preferred_total) == (2, 3)


def test_a_new_documented_skill_changes_only_its_own_count(candidate):
    updated = candidate.model_copy(update={"technical_skills": [*candidate.technical_skills, TechnicalSkill(name="Docker", category="cloud_devops")]})
    counts = coverage.coverage_counts(run(updated).comparisons)
    assert (counts.required_documented, counts.required_total, counts.preferred_documented, counts.needs_review) == (2, 3, 1, 1)


def test_gaps_are_fixed_keys_and_never_new_content(candidate):
    result = run(candidate)
    gaps = coverage.gaps(result.comparisons)
    assert [(gap.requirement_text, gap.kind, gap.section, gap.reason) for gap in gaps] == [
        ("Docker", "add_if_true", "technical_skills", None),
        ("Fluent English", "interpretation", "languages", "language_level"),
        ("Kubernetes", "add_if_true", "technical_skills", None),
    ]
    # Every string a gap carries is the job's own requirement label or a fixed key.
    requirement_labels = {item.requirement_text for item in result.comparisons}
    for gap in gaps:
        values = [value for value in gap.model_dump().values() if isinstance(value, str)]
        assert all(value in requirement_labels or value in {gap.requirement_id, gap.category, gap.classification, gap.status, gap.kind, gap.section, gap.reason} for value in values)
    profile_text = candidate.model_dump_json()
    assert not any(gap.requirement_text in profile_text for gap in gaps if gap.kind == "add_if_true")


def test_projection_never_carries_identity_contact_employer_place_or_dates(candidate):
    projected = coverage.qualification_projection(candidate).model_dump_json()
    for value in ["Avery Example", "avery@example.com", "202 555 0101", "linkedin.com", "github.com", "Fictional Computing College", "2020", "2024", "Example Training"]:
        assert value not in projected


def test_profile_diff_lists_added_removed_and_changed_items(candidate):
    edited = candidate.model_copy(update={
        "email": None,
        "technical_skills": [skill for skill in candidate.technical_skills if skill.name != "Git"] + [TechnicalSkill(name="Docker", category="cloud_devops")],
    })
    fields, sections = coverage.profile_diff(candidate, edited)
    assert [(item.field, item.change) for item in fields] == [("email", "removed")]
    skills = next(section for section in sections if section.section == "technical_skills")
    assert (skills.added, skills.removed, skills.unchanged) == (["Docker"], ["Git"], 2)
    assert all(not section.added and not section.removed for section in sections if section.section != "technical_skills")
    same_fields, same_sections = coverage.profile_diff(candidate, candidate)
    assert same_fields == [] and all(not section.added and not section.removed for section in same_sections)
