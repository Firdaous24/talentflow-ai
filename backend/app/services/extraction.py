"""Conservative, replaceable extraction rules for supported English CV layouts."""

import re
from typing import Protocol, TypeVar

from pydantic import BaseModel, ValidationError

from app.models.candidate import (
    CandidateProfile, Certification, ContactInformation, CVParsingResponse,
    Education, Language, ParsingMetadata, Project, TechnicalSkill, WorkExperience,
)
from app.services.pdf import PDFText


class CandidateExtractor(Protocol):
    def extract(self, document: PDFText) -> CVParsingResponse: ...


SECTION_ALIASES = {
    "education": "education", "academic background": "education",
    "professional experience": "experience", "work experience": "experience", "experience": "experience",
    "technical skills": "skills", "skills": "skills", "technologies": "skills",
    "projects": "projects", "personal projects": "projects",
    "certifications": "certifications", "certificates": "certifications",
    "languages": "languages", "spoken languages": "languages",
    "summary": "other", "profile": "other", "interests": "other", "references": "other",
    "contact": "contact", "contact information": "contact", "personal information": "contact",
}
# Deliberately small and auditable. Matching a mention never establishes proficiency.
TECHNOLOGIES = {
    "programming_language": {"Python": ("python",), "JavaScript": ("javascript",), "TypeScript": ("typescript",), "Java": ("java",), "SQL": ("sql",), "C++": ("c++",), "C#": ("c#",), "Go": ("golang",)},
    "framework": {"FastAPI": ("fastapi",), "Django": ("django",), "Flask": ("flask",), "React": ("react", "react.js"), "Node.js": ("node.js", "nodejs")},
    "database": {"PostgreSQL": ("postgresql", "postgres"), "MySQL": ("mysql",), "MongoDB": ("mongodb",), "Redis": ("redis",), "SQLite": ("sqlite",)},
    "ai_ml": {"PyTorch": ("pytorch",), "TensorFlow": ("tensorflow",), "scikit-learn": ("scikit-learn", "sklearn"), "pandas": ("pandas",), "NumPy": ("numpy",), "LangGraph": ("langgraph",)},
    "cloud_devops": {"Docker": ("docker",), "Kubernetes": ("kubernetes", "k8s"), "AWS": ("aws", "amazon web services"), "Azure": ("azure",), "GitHub Actions": ("github actions",)},
    "tool": {"Git": ("git",), "Power BI": ("power bi",), "Tableau": ("tableau",), "Excel": ("excel",)},
}
M = TypeVar("M", bound=BaseModel)


def extract_skills(text: str) -> list[TechnicalSkill]:
    result = []
    for category, names in TECHNOLOGIES.items():
        for name, aliases in names.items():
            if any(re.search(r"(?<![\w+#])" + re.escape(alias) + r"(?![\w+#])", text, re.I) for alias in aliases):
                result.append(TechnicalSkill(name=name, category=category))
    return result


def detect_sections(text: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {"contact": []}
    current = "contact"
    for raw in text.replace("\f", "\n").splitlines():
        line = raw.strip().lstrip("• ")
        if not line:
            sections.setdefault(current, []).append("")
            continue
        heading, _, inline = line.partition(":")
        key = SECTION_ALIASES.get(heading.strip().casefold())
        if heading.strip().casefold() == "technologies" and current in {"experience", "projects"} and inline.strip():
            key = None
        if key is not None:
            current = key
            sections.setdefault(current, [])
            if inline.strip():
                sections[current].append(inline.strip())
        elif line.isupper() and ":" not in line and len(line.split()) <= 5 and current != "contact":
            current = "other"
        else:
            sections.setdefault(current, []).append(line)
    return sections


def validated_fields(model: type[M], fields: dict, warnings: list[str], section: str) -> M | None:
    """Discard invalid fields individually, without leaking their values into warnings."""
    while True:
        try:
            return model.model_validate(fields)
        except ValidationError as error:
            if any(item["type"] == "missing" for item in error.errors()):
                warnings.append(f"An incomplete {section} entry was omitted.")
                return None
            for item in error.errors():
                key = item["loc"][0]
                fields.pop(key, None)
                warnings.append(f"Invalid {section}.{key} was omitted.")


def labeled_records(lines: list[str], model: type[M], labels: dict[str, str], anchors: set[str], warnings: list[str], section: str) -> list[M]:
    records: list[M] = []
    fields: dict = {}
    unsupported = False

    def flush() -> None:
        nonlocal fields
        if fields:
            record = validated_fields(model, fields, warnings, section)
            if record is not None and any(value for value in record.model_dump().values()):
                records.append(record)
            fields = {}

    for line in lines:
        if not line:
            flush()
            continue
        label, separator, value = line.partition(":")
        key = labels.get(label.casefold().strip()) if separator else None
        if key is None or not value.strip():
            unsupported = True
            continue
        if key in anchors and key in fields:
            flush()
        if key in fields:
            warnings.append(f"Ambiguous {section}.{key}; later value omitted.")
            continue
        if key == "technologies":
            fields[key] = [skill.name for skill in extract_skills(value)]
        else:
            fields[key] = value.strip()
    flush()
    if unsupported:
        warnings.append(f"Some {section} text was not mapped by the supported labeled-field rules.")
    return records


class DeterministicCandidateExtractor:
    def extract(self, document: PDFText) -> CVParsingResponse:
        warnings = list(document.warnings)
        warnings.append("Deterministic extraction is partial; unrecognized layouts and unlabeled fields may be omitted. Review all extracted information.")
        sections = detect_sections(document.text)
        contact_text = "\n".join(sections.get("contact", []))
        fields: dict = {}
        labels = {"name": "full_name", "full name": "full_name", "email": "email", "phone": "phone", "telephone": "phone", "linkedin": "linkedin_url", "github": "github_url"}
        for line in sections.get("contact", []):
            label, separator, value = line.partition(":")
            key = labels.get(label.casefold().strip()) if separator else None
            if key and value.strip():
                if key in fields and fields[key] != value.strip():
                    warnings.append(f"Multiple contact values for {key}; first value retained.")
                else:
                    fields[key] = value.strip()
        # Unlabeled email and profile URLs are recognized only in the contact area.
        patterns = {
            "email": r"(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
            "linkedin_url": r"https?://(?:www\.)?linkedin\.com/in/[A-Za-z0-9_/%-]+",
            "github_url": r"https?://(?:www\.)?github\.com/[A-Za-z0-9_-]+(?![\w/-])",
        }
        for key, pattern in patterns.items():
            values = list(dict.fromkeys(re.findall(pattern, contact_text, re.I)))
            if key not in fields and len(values) == 1:
                fields[key] = values[0]
            elif len(values) > 1:
                warnings.append(f"Multiple contact values for {key}; review required.")
        contact = validated_fields(ContactInformation, fields, warnings, "contact") or ContactInformation()
        candidate = CandidateProfile(**contact.model_dump())
        candidate.education = labeled_records(sections.get("education", []), Education, {"degree": "degree", "institution": "institution", "field of study": "field_of_study", "start date": "start_date", "end date": "end_date"}, {"degree", "institution"}, warnings, "education")
        candidate.experience = labeled_records(sections.get("experience", []), WorkExperience, {"job title": "job_title", "company": "company", "start date": "start_date", "end date": "end_date", "description": "description", "technologies": "technologies"}, {"job_title", "company"}, warnings, "experience")
        candidate.projects = labeled_records(sections.get("projects", []), Project, {"project": "name", "name": "name", "description": "description", "technologies": "technologies", "github": "github_url"}, {"name"}, warnings, "projects")
        skill_text = "\n".join(sections.get("skills", []))
        candidate.technical_skills = extract_skills(skill_text)
        for line in sections.get("languages", []):
            if not line:
                continue
            match = re.fullmatch(r"(English|French|Arabic|Spanish|German|Portuguese|Italian|Mandarin)(?:\s*[:\-]\s*(Native|Fluent|Advanced|Intermediate|Basic|A[12]|B[12]|C[12]))?", line, re.I)
            if match:
                candidate.languages.append(Language(name=match[1].title(), proficiency=match[2]))
            else:
                warnings.append("A language entry could not be reliably identified.")
        candidate.certifications = labeled_records(sections.get("certifications", []), Certification, {"certification": "name", "name": "name", "issuer": "issuer", "date": "date"}, {"name"}, warnings, "certifications")
        for key in ("full_name", "email", "phone", "linkedin_url", "github_url", "education", "experience", "technical_skills", "projects", "languages", "certifications"):
            if not getattr(candidate, key):
                warnings.append(f"{key} could not be reliably identified.")
        if skill_text:
            warnings.append("Skills are dictionary-matched mentions in the skills section; proficiency and unsupported technologies are not inferred.")
        return CVParsingResponse(candidate=candidate, parsing_metadata=ParsingMetadata(page_count=document.page_count, warnings=list(dict.fromkeys(warnings))))
