"""Candidate contracts: unknown values remain null or empty collections."""

import re
from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, HttpUrl, ValidationInfo, field_validator

Text = Annotated[str, Field(min_length=1, max_length=2000)]
def validate_date_label(value: str) -> str:
    if value != "Present":
        parts = value.split("-")
        date(int(parts[0]), int(parts[1]) if len(parts) > 1 else 1, int(parts[2]) if len(parts) > 2 else 1)
    return value


DateLabel = Annotated[str, Field(pattern=r"^(?:\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?|Present)$"), AfterValidator(validate_date_label)]
SkillCategory = Literal["programming_language", "framework", "database", "ai_ml", "cloud_devops", "tool"]


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, validate_assignment=True)


class ContactInformation(Schema):
    full_name: Text | None = None
    email: Annotated[str, Field(max_length=254, pattern=r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")] | None = None
    phone: Text | None = None
    linkedin_url: HttpUrl | None = None
    github_url: HttpUrl | None = None

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
        if value is not None and (not re.fullmatch(r"\+?[\d ()\-.]+", value) or not 7 <= len(re.sub(r"\D", "", value)) <= 15):
            raise ValueError("Phone must contain 7 to 15 digits.")
        return value

    @field_validator("linkedin_url", "github_url")
    @classmethod
    def validate_profile_url(cls, value: HttpUrl | None, info: ValidationInfo) -> HttpUrl | None:
        domain = "linkedin.com" if info.field_name == "linkedin_url" else "github.com"
        if value is not None and (value.host not in {domain, f"www.{domain}"} or value.username or value.password):
            raise ValueError("Unexpected profile URL host or credentials.")
        return value


class WorkExperience(Schema):
    job_title: Text | None = None
    company: Text | None = None
    start_date: DateLabel | None = None
    end_date: DateLabel | None = None
    description: Text | None = None
    technologies: list[Text] = Field(default_factory=list)


class Education(Schema):
    degree: Text | None = None
    institution: Text | None = None
    field_of_study: Text | None = None
    start_date: DateLabel | None = None
    end_date: DateLabel | None = None


class TechnicalSkill(Schema):
    name: Text
    category: SkillCategory


class Project(Schema):
    name: Text | None = None
    description: Text | None = None
    technologies: list[Text] = Field(default_factory=list)
    github_url: HttpUrl | None = None


class Language(Schema):
    name: Text
    proficiency: Text | None = None


class Certification(Schema):
    name: Text
    issuer: Text | None = None
    date: DateLabel | None = None


class CandidateProfile(ContactInformation):
    education: list[Education] = Field(default_factory=list)
    experience: list[WorkExperience] = Field(default_factory=list)
    technical_skills: list[TechnicalSkill] = Field(default_factory=list)
    projects: list[Project] = Field(default_factory=list)
    languages: list[Language] = Field(default_factory=list)
    certifications: list[Certification] = Field(default_factory=list)


class ParsingMetadata(Schema):
    status: Literal["partial"] = "partial"
    page_count: int = Field(ge=1, le=10)
    warnings: list[str] = Field(default_factory=list)
    engine: Literal["deterministic-v1"] = "deterministic-v1"


class CVParsingResponse(Schema):
    candidate: CandidateProfile
    parsing_metadata: ParsingMetadata
