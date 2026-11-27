"""Authored fictional CV boundaries, independently rendered as real PDFs.

Expected sections and entry associations are fixed before the Phase 4.3 parser
changes. No real candidate information or binary CV fixtures are stored.
"""

import pymupdf
import pytest

from app.services.extraction import DeterministicCandidateExtractor, detect_sections
from app.services.pdf import PDFText, extract_pdf
from app.services.sections import section_heading

ACADEMIC_HEADINGS = (
    "Academic Projects",
    "University Projects",
    "Selected Academic Projects",
    "Projets académiques",
    "Projets universitaires",
    "Projets scolaires",
    "Projets personnels",
)


def fictional_boundary_pdf(project_heading="Academic Projects", second_role="Data Analyst"):
    """Fixed one-column layout: two jobs, then one clearly named project."""
    rows = [
        ("Alex Fictional", True),
        ("Professional Experience", True),
        ("Developer | Fictional Platform", True),
        ("2021 - 2022", False),
        ("- Built a Python service for a fictional internal catalogue.", False),
        (f"{second_role} | Fictional Data Lab", True),
        ("2022 - 2024", False),
        ("- Queried SQL datasets for fictional reporting workshops.", False),
        (project_heading, True),
        ("Inventory Prototype : Built an academic SQLite inventory demo.", True),
        ("- Tested the academic project with a fictional dataset.", False),
        ("Technical Skills", True),
        ("Python, SQL, SQLite", False),
    ]
    with pymupdf.open() as pdf:
        page = pdf.new_page()
        for index, (text, bold) in enumerate(rows):
            page.insert_text(
                (40, 40 + index * 25), text,
                fontname="hebo" if bold else "helv", fontsize=10,
            )
        return pdf.tobytes()


@pytest.mark.parametrize("heading", ACADEMIC_HEADINGS)
def test_academic_heading_stops_experience_and_preserves_project_sources(heading):
    document = extract_pdf(fictional_boundary_pdf(project_heading=heading))
    # Isolate recognition from layout: PyMuPDF must retain the exact source row.
    assert any(line.text == heading for line in document.lines)
    result = DeterministicCandidateExtractor().extract(document)
    candidate = result.candidate
    assert len(candidate.experience) == 2
    assert len(candidate.projects) == 1
    assert candidate.experience[0].job_title == "Developer"
    assert candidate.experience[0].company == "Fictional Platform"
    assert candidate.experience[0].start_date == "2021"
    assert candidate.experience[0].end_date == "2022"
    assert candidate.experience[0].technologies == ["Python"]
    assert candidate.experience[1].job_title == "Data Analyst"
    assert candidate.experience[1].company == "Fictional Data Lab"
    assert candidate.experience[1].start_date == "2022"
    assert candidate.experience[1].end_date == "2024"
    assert candidate.experience[1].technologies == ["SQL"]
    assert candidate.projects[0].name == "Inventory Prototype"
    assert candidate.projects[0].technologies == ["SQLite"]
    assert all("academic" not in (entry.description or "") for entry in candidate.experience)
    assert "academic" in candidate.projects[0].description
    evidence = result.parsing_metadata.evidence
    assert evidence and all(item.quote in document.text for item in evidence)
    assert all(
        "academic" not in item.quote
        for item in evidence if item.field.startswith("experience.")
    )
    assert any(item.field.startswith("projects.0.") and "academic" in item.quote for item in evidence)
    assert any("review" in warning.lower() for warning in result.parsing_metadata.warnings)


@pytest.mark.parametrize("role", ["Data Analyst", "Business Analyst", "Business Intelligence Analyst", "Analyste fonctionnel"])
def test_explicit_role_titles_start_distinct_entries_with_local_dates_and_skills(role):
    document = extract_pdf(fictional_boundary_pdf(project_heading="Projects", second_role=role))
    result = DeterministicCandidateExtractor().extract(document)
    assert len(result.candidate.experience) == 2
    first, second = result.candidate.experience
    assert first.job_title == "Developer" and second.job_title == role
    assert (first.start_date, first.end_date) == ("2021", "2022")
    assert (second.start_date, second.end_date) == ("2022", "2024")
    assert first.technologies == ["Python"]
    assert second.technologies == ["SQL"]
    assert "SQL" not in first.description
    assert "Python" not in second.description
    assert not any("Ambiguous experience date" in warning for warning in result.parsing_metadata.warnings)
    first_sources = {item.source_id for item in result.parsing_metadata.evidence if item.field.startswith("experience.0.")}
    second_sources = {item.source_id for item in result.parsing_metadata.evidence if item.field.startswith("experience.1.")}
    assert first_sources and second_sources and first_sources.isdisjoint(second_sources)


@pytest.mark.parametrize("line", [
    "- Reviewed academic projects with Python during the job.",
    "Academic projects were discussed with business users.",
    "- Business Analyst mentoring on SQL reports.",
])
def test_project_and_role_words_inside_responsibilities_do_not_create_sections_or_jobs(line):
    text = "Professional Experience\nDeveloper | Fictional Platform\n2021 - 2022\n" + line
    result = DeterministicCandidateExtractor().extract(PDFText(text, 1))
    assert len(result.candidate.experience) == 1
    assert result.candidate.projects == []
    assert line in result.candidate.experience[0].description


def test_academic_project_without_job_metadata_does_not_fabricate_employer_or_dates():
    document = PDFText(
        "Experience\nJob title: Developer\nDescription: Built a fictional Python service.\n"
        "Projets académiques\nInventory Prototype : Built a fictional SQLite demo.\n"
        "- Compared academic snapshots labelled 2020 - 2024.",
        1,
        ("Synthetic source warning retained.",),
    )
    result = DeterministicCandidateExtractor().extract(document)
    assert len(result.candidate.experience) == 1
    assert len(result.candidate.projects) == 1
    experience = result.candidate.experience[0]
    assert experience.company is None
    assert experience.start_date is None and experience.end_date is None
    assert "2020" not in experience.description
    assert "2020 - 2024" in result.candidate.projects[0].description
    assert "Synthetic source warning retained." in result.parsing_metadata.warnings
    assert document.text.endswith("- Compared academic snapshots labelled 2020 - 2024.")


def test_live_parse_api_keeps_academic_projects_separate(client):
    response = client.post(
        "/api/v1/candidates/parse",
        files={"file": ("fictional-boundaries.pdf", fictional_boundary_pdf(), "application/pdf")},
    )
    assert response.status_code == 200
    candidate = response.json()["candidate"]
    assert len(candidate["experience"]) == 2 and len(candidate["projects"]) == 1
    assert candidate["experience"][1]["technologies"] == ["SQL"]
    assert candidate["projects"][0]["technologies"] == ["SQLite"]


def test_supported_project_heading_control_has_no_existing_merge():
    result = DeterministicCandidateExtractor().extract(extract_pdf(fictional_boundary_pdf("Projects")))
    assert len(result.candidate.experience) == 2 and len(result.candidate.projects) == 1
    assert result.candidate.experience[1].technologies == ["SQL"]
    assert detect_sections("Projects\nInventory Prototype : Fictional.")["projects"]
    assert section_heading("Projects")[0] == "projects"
