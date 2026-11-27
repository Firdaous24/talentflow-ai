"""Session-only job analysis and qualification-document comparison contracts."""

from typing import Annotated, Literal

from pydantic import ConfigDict, Field, field_validator, model_validator

from app.models.candidate import Schema, SkillCategory, TechnicalSkill, Text

RequirementCategory = Literal["technical_skill", "experience", "education", "certification", "language", "other"]
RequirementClassification = Literal["required", "preferred", "unspecified"]
RequirementOrigin = Literal["qualification", "technical_environment"]
JobMetadataField = Literal["title", "company", "location", "employment_type", "work_mode"]


class JobAnalyzeRequest(Schema):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    text: Annotated[str, Field(min_length=30, max_length=30000)]

    @field_validator("text")
    @classmethod
    def meaningful_text(cls, value: str) -> str:
        if len(value.strip()) < 30 or sum(character.isalpha() for character in value) < 15 or "\x00" in value:
            raise ValueError("Enter a job description with at least 30 meaningful characters and no null bytes.")
        return value


class RequirementEvidence(Schema):
    quote: Annotated[str, Field(min_length=1, max_length=30000)]
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class JobSkill(Schema):
    name: Text
    category: SkillCategory


class JobRequirement(Schema):
    id: Annotated[str, Field(pattern=r"^req-\d{3}$")]
    text: Text
    category: RequirementCategory
    classification: RequirementClassification
    origin: RequirementOrigin = "qualification"
    technical_skills: list[JobSkill] = Field(default_factory=list, max_length=100)
    evidence: list[RequirementEvidence] = Field(min_length=1, max_length=10)
    warnings: list[Text] = Field(default_factory=list, max_length=20)


class JobDescription(Schema):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    title: Text | None = None
    company: Text | None = None
    location: Text | None = None
    employment_type: Text | None = None
    work_mode: Text | None = None
    metadata_evidence: dict[JobMetadataField, list[RequirementEvidence]] = Field(default_factory=dict)
    text: Annotated[str, Field(min_length=30, max_length=30000)]
    responsibilities: list[Text] = Field(default_factory=list, max_length=100)


class JobAnalysisResponse(Schema):
    job: JobDescription
    requirements: list[JobRequirement] = Field(default_factory=list, max_length=150)
    warnings: list[Text] = Field(default_factory=list, max_length=100)
    method: Literal["deterministic-v1"] = "deterministic-v1"


class ReviewedRequirement(Schema):
    """Editable labels; immutable extraction and source stay in job_analysis."""

    id: Annotated[str, Field(pattern=r"^req-\d{3}$")]
    text: Text
    category: RequirementCategory
    classification: RequirementClassification


class QualificationEducation(Schema):
    degree: Text | None = None
    field_of_study: Text | None = None


class QualificationExperience(Schema):
    job_title: Text | None = None
    description: Text | None = None
    technologies: list[Text] = Field(default_factory=list, max_length=100)


class QualificationProject(Schema):
    name: Text | None = None
    description: Text | None = None
    technologies: list[Text] = Field(default_factory=list, max_length=100)


class QualificationCertification(Schema):
    name: Text


class QualificationLanguage(Schema):
    name: Text
    proficiency: Text | None = None


class QualificationProfile(Schema):
    """Purpose-limited snapshot: contact, identity, employers and URLs are forbidden."""

    education: list[QualificationEducation] = Field(default_factory=list, max_length=100)
    experience: list[QualificationExperience] = Field(default_factory=list, max_length=100)
    technical_skills: list[TechnicalSkill] = Field(default_factory=list, max_length=100)
    projects: list[QualificationProject] = Field(default_factory=list, max_length=100)
    certifications: list[QualificationCertification] = Field(default_factory=list, max_length=100)
    languages: list[QualificationLanguage] = Field(default_factory=list, max_length=100)


class JobReviewAssertion(Schema):
    candidate_confirmed: bool
    candidate_snapshot: QualificationProfile
    requirements_reviewed: bool
    requirement_snapshot: list[ReviewedRequirement] = Field(min_length=1, max_length=150)


class JobComparisonRequest(Schema):
    candidate: QualificationProfile
    job_analysis: JobAnalysisResponse
    requirements: list[ReviewedRequirement] = Field(min_length=1, max_length=150)
    review: JobReviewAssertion


class CandidateEvidenceExcerpt(Schema):
    """Exact Unicode-character offsets into the legacy full field quotation."""

    quote: Text
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class CandidateRequirementEvidence(Schema):
    field: Text
    quote: Text
    unverified: Literal[True] = True
    excerpt: CandidateEvidenceExcerpt | None = Field(default=None, exclude_if=lambda value: value is None)

    @model_validator(mode="after")
    def exact_excerpt(self):
        if self.excerpt is not None:
            span = self.excerpt
            if not span.start < span.end <= len(self.quote) or self.quote[span.start:span.end] != span.quote:
                raise ValueError("Evidence excerpts must exactly match their source field and Unicode character offsets.")
        return self


class RequirementComparison(Schema):
    requirement_id: str
    requirement_text: Text
    original_requirement_text: Text
    category: RequirementCategory
    classification: RequirementClassification
    origin: RequirementOrigin = "qualification"
    status: Literal["documented", "not_documented", "needs_review"]
    candidate_evidence: list[CandidateRequirementEvidence] = Field(default_factory=list)
    job_evidence: list[RequirementEvidence]
    explanation: Text
    review_notes: list[Text] = Field(default_factory=list)


class TechnicalJobReference(Schema):
    """An immutable analyzed source clause, independent of reviewed labels."""

    requirement_id: Annotated[str, Field(pattern=r"^req-\d{3}$")]
    origin: RequirementOrigin
    classification: RequirementClassification
    evidence: list[RequirementEvidence] = Field(min_length=1, max_length=10)


class TechnicalEvidence(Schema):
    """Canonical lexical mentions only; no ability or qualification conclusion."""

    name: Text
    category: SkillCategory
    job_references: list[TechnicalJobReference] = Field(min_length=1, max_length=150)
    candidate_evidence: list[CandidateRequirementEvidence] = Field(default_factory=list)
    requires_interpretation: bool


class JobComparisonResponse(Schema):
    comparisons: list[RequirementComparison]
    warnings: list[Text]
    technical_evidence: list[TechnicalEvidence] = Field(default_factory=list)
    review_assertion: Literal["unverified_client_assertion"] = "unverified_client_assertion"
    method: Literal["qualification-document-checklist-v1"] = "qualification-document-checklist-v1"
