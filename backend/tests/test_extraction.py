"""Independent deterministic extraction and schema validation tests."""

import pytest
from pydantic import ValidationError

from app.models.candidate import CandidateProfile, Education, ParsingMetadata
from app.services.extraction import DeterministicCandidateExtractor, extract_skills
from app.services.pdf import PDFText
from conftest import SYNTHETIC_CVS


@pytest.mark.parametrize("fixture", SYNTHETIC_CVS, ids=lambda fixture: fixture["scenario"])
def test_extraction_independent_of_pdf(fixture: dict) -> None:
    result = DeterministicCandidateExtractor().extract(PDFText(fixture["text"], 1))
    assert {skill.name for skill in result.candidate.technical_skills} == set(fixture["skills"])


def test_explicit_structured_fields() -> None:
    extractor = DeterministicCandidateExtractor()
    candidate = extractor.extract(PDFText(SYNTHETIC_CVS[0]["text"], 1)).candidate
    assert candidate.full_name == "Avery Example"
    assert candidate.phone == "+1 202 555 0101"
    assert candidate.education[0].institution == "Fictional Computing College"
    assert candidate.education[0].start_date == "2020"
    assert candidate.projects[0].technologies == ["Python", "FastAPI"]
    assert candidate.languages[0].proficiency == "Fluent"
    assert candidate.certifications[0].issuer == "Example Training"
    experience = extractor.extract(PDFText(SYNTHETIC_CVS[1]["text"], 1)).candidate.experience[0]
    assert experience.company == "Fictional Analytics Lab"
    assert experience.technologies == ["SQL", "pandas"]


def test_no_inference_from_summary_or_dates() -> None:
    result = DeterministicCandidateExtractor().extract(PDFText("Summary\nI want to learn Python.\nExperience\n2020 - 2022 Example Incorporated\nLanguages\nPython\nEducation\nDegree: BSc\nStart date: someday", 1))
    assert result.candidate.full_name is None
    assert result.candidate.technical_skills == []
    assert result.candidate.experience == []
    assert result.candidate.languages == []
    assert result.candidate.education[0].start_date is None
    assert "Invalid education.start_date was omitted." in result.parsing_metadata.warnings


def test_skill_boundaries_aliases_and_deduplication() -> None:
    assert {skill.name for skill in extract_skills("JavaScript Java Python Python3 CPython Python C++ C# sklearn postgres GitHub Go go to work")} == {"JavaScript", "Java", "Python", "C++", "C#", "scikit-learn", "PostgreSQL"}


def test_multiple_records_and_ambiguous_contacts() -> None:
    result = DeterministicCandidateExtractor().extract(PDFText("Email: first@example.com\nEmail: second@example.com\nExperience\nJob title: Developer\nCompany: Example One\nJob title: Engineer\nCompany: Example Two", 1))
    assert len(result.candidate.experience) == 2
    assert result.candidate.experience[1].company == "Example Two"
    assert any("Multiple contact" in warning for warning in result.parsing_metadata.warnings)


@pytest.mark.parametrize("fields", [{"email": "invalid"}, {"phone": "2020"}, {"github_url": "https://evil.example/user"}, {"linkedin_url": "javascript:alert(1)"}, {"unexpected": "value"}])
def test_candidate_schema_rejects_invalid_values(fields: dict) -> None:
    with pytest.raises(ValidationError):
        CandidateProfile(**fields)


def test_independent_collection_defaults() -> None:
    first, second = CandidateProfile(), CandidateProfile()
    first.education.append(Education(degree="BSc"))
    assert second.education == []
    with pytest.raises(ValidationError):
        ParsingMetadata(page_count=11)


def test_invalid_required_certification_name_does_not_loop() -> None:
    result = DeterministicCandidateExtractor().extract(PDFText("Certifications\nName: " + "x" * 2001, 1))
    assert result.candidate.certifications == []
    assert any("incomplete certifications" in warning for warning in result.parsing_metadata.warnings)


@pytest.mark.parametrize("value", ["2023-02-29", "2024-31", "0000", "2024-13", "yesterday"])
def test_calendar_date_validation(value: str) -> None:
    with pytest.raises(ValidationError):
        Education(start_date=value)


@pytest.mark.parametrize("value", ["2024", "2024-02", "2024-02-29", "Present"])
def test_valid_date_precision(value: str) -> None:
    assert Education(end_date=value).end_date == value
