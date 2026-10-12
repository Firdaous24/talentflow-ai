"""Real synthetic PDFs, French/English contracts and conservative edge cases."""
import pytest
import pymupdf
from app.models.candidate import CandidateProfile
from app.services.extraction import DeterministicCandidateExtractor, detect_sections, extract_skills
from app.services.multilingual import date_value
from app.services.pdf import PDFText, extract_pdf
from multilingual_support import FIXTURES, make_layout_pdf

@pytest.mark.parametrize('fixture', FIXTURES, ids=lambda value: value['id'])
def test_multilingual_pdf_ground_truth(fixture):
    result = DeterministicCandidateExtractor().extract(extract_pdf(make_layout_pdf(fixture)))
    expected = CandidateProfile.model_validate(fixture['ground_truth'])
    assert result.candidate.model_dump(mode='json') == expected.model_dump(mode='json')
    assert result.parsing_metadata.status == 'partial'
    for evidence in result.parsing_metadata.evidence:
        assert evidence.quote
        assert evidence.page == 1

@pytest.mark.parametrize('fixture', FIXTURES, ids=lambda value: value['id'])
def test_multilingual_live_api_contract(client, fixture):
    response = client.post('/api/v1/candidates/parse', files={'file': ('fictional.pdf', make_layout_pdf(fixture), 'application/pdf')})
    assert response.status_code == 200
    assert response.json()['candidate']['full_name'] == fixture['name']
    assert response.json()['parsing_metadata']['engine'] == 'deterministic-v2'

def test_layout_retains_geometry_fonts_and_separates_columns():
    document = extract_pdf(make_layout_pdf(FIXTURES[2]))
    assert len({line.region for line in document.lines}) >= 3
    assert all(line.spans and len(line.bbox) == 4 for line in document.lines)
    assert any(span.flags & 16 for line in document.lines for span in line.spans)
    assert document.text.index('Arabe:') < document.text.index('Data Analyst')
    result = DeterministicCandidateExtractor().extract(document)
    assert result.candidate.experience[0].technologies == ['SQL']
    assert 'Python' not in result.candidate.experience[0].technologies

@pytest.mark.parametrize('heading', ['COMPÉTENCES TECHNIQUES:', 'competences techniques', 'Compétences techniques !!!'])
def test_normalized_section_aliases(heading):
    assert detect_sections(heading + '\nPython')['skills'] == ['Python']

def test_ordinary_prose_and_nonheader_names_are_not_headings_or_identity():
    result = DeterministicCandidateExtractor().extract(PDFText('Profil\nFormation de collègues avec Python.\nExpérience professionnelle\nA travaillé avec Jordan Example.', 1))
    assert result.candidate.full_name is None
    assert result.candidate.technical_skills == []
    assert result.candidate.experience == []

@pytest.mark.parametrize('value,expected', [('février 2024', '2024-02'), ('août 2023', '2023-08'), ("aujourd’hui", 'Present'), ('Present', 'Present'), ('2021', '2021'), ('someday', None)])
def test_date_normalization_preserves_precision(value, expected):
    assert date_value(value) == expected

def test_duplicate_skills_and_local_mentions():
    result = DeterministicCandidateExtractor().extract(PDFText('Compétences techniques\nPython Python sklearn Neo4j GitHub\nProfil\nJe voudrais apprendre Java.', 1))
    assert {skill.name for skill in result.candidate.technical_skills} == {'Python', 'scikit-learn', 'Neo4j', 'GitHub'}
    assert len(result.candidate.technical_skills) == 4

def test_mixed_french_labels_and_school_first_education():
    extractor = DeterministicCandidateExtractor()
    result = extractor.extract(PDFText('Formation\nDiplôme: Master\nInstitution: Université Exemple\nDébut: septembre 2020\nFin: juin 2022', 1))
    assert result.candidate.education[0].degree == 'Master'
    assert result.candidate.education[0].start_date == '2020-09'
    result = extractor.extract(PDFText('Formation\nUniversité Exemple\nMaster en informatique\n2020 - 2022', 1))
    assert result.candidate.education[0].institution == 'Université Exemple'
    assert result.candidate.education[0].field_of_study == 'informatique'

def test_leading_dates_and_multiline_description_evidence():
    result = DeterministicCandidateExtractor().extract(PDFText('Experience\n2020 - 2022\nDeveloper | Demo One\nBuilt APIs.\nTested systems.\n2022 - Present\nEngineer | Demo Two\nBuilt reports.', 1))
    assert len(result.candidate.experience) == 2
    assert result.candidate.experience[0].start_date == '2020'
    assert result.candidate.experience[1].start_date == '2022'
    assert len([v for v in result.parsing_metadata.evidence if v.field == 'experience.0.description']) == 2

def test_ambiguous_header_phone_stays_missing():
    result = DeterministicCandidateExtractor().extract(PDFText('Jordan Example\n+212 612 345 678\n+212 623 456 789\nSkills\nPython', 1))
    assert result.candidate.phone is None
    assert any('Multiple phone' in warning for warning in result.parsing_metadata.warnings)

def test_right_aligned_dates_do_not_become_an_unrelated_column():
    with pymupdf.open() as pdf:
        page = pdf.new_page(); page.insert_text((40, 40), 'Jordan Example', fontsize=20)
        for y, title, dates in [(100, 'Software Engineer | Demo One', '2022 - Present'), (200, 'Backend Developer | Demo Two', '2020 - 2022'), (300, 'Developer | Demo Three', '2018 - 2020')]:
            if y == 100: page.insert_text((40, 80), 'Professional Experience')
            page.insert_text((40, y), title); page.insert_text((430, y), dates, fontsize=9)
        document = extract_pdf(pdf.tobytes())
    assert not any('Two-column' in warning for warning in document.warnings)
    result = DeterministicCandidateExtractor().extract(document)
    assert len(result.candidate.experience) == 3
    assert result.candidate.experience[1].start_date == '2020'
