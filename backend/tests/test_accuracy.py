"""Formatting regressions and adversarial cases; only fictional CV content."""
import pytest
from app.models.candidate import CandidateProfile
from app.services.extraction import DeterministicCandidateExtractor, extract_skills
from app.services.multilingual import date_value
from app.services.pdf import PDFText, extract_pdf, normalize_text
from accuracy_support import REGRESSION_FIXTURES, make_accuracy_pdf

@pytest.mark.parametrize('fixture', REGRESSION_FIXTURES, ids=lambda value: value['id'])
def test_accuracy_ground_truth(fixture):
    result = DeterministicCandidateExtractor().extract(extract_pdf(make_accuracy_pdf(fixture)))
    expected = CandidateProfile.model_validate(fixture['ground_truth']).model_dump(mode='json')
    actual = result.candidate.model_dump(mode='json')
    # Dictionaries and technology lists have no semantic ordering.
    for value in (actual, expected):
        value['technical_skills'].sort(key=lambda item: item['name'])
        for row in value['experience'] + value['projects']: row['technologies'].sort()
    assert actual == expected

@pytest.mark.parametrize('fixture', REGRESSION_FIXTURES, ids=lambda value: value['id'])
def test_accuracy_api_contract(client, fixture):
    response = client.post('/api/v1/candidates/parse', files={'file': ('fictional-regression.pdf', make_accuracy_pdf(fixture), 'application/pdf')})
    assert response.status_code == 200
    assert len(response.json()['candidate']['projects']) == len(fixture['ground_truth'].get('projects', []))
    assert response.json()['parsing_metadata']['llm_status'] == 'not_requested'

@pytest.mark.parametrize('month,value', [('Fév.', '02'), ('Févr.', '02'), ('Janv.', '01'), ('Juil.', '07'), ('Août', '08'), ('Sept.', '09'), ('Déc.', '12'), ('Apr.', '04'), ('Jun.', '06'), ('Jul.', '07'), ('Aug.', '08'), ('Sep.', '09')])
def test_month_abbreviations(month, value):
    assert date_value(month + ' 2026') == '2026-' + value

def test_entry_evidence_for_repeated_dates_and_institutions():
    result = DeterministicCandidateExtractor().extract(extract_pdf(make_accuracy_pdf(REGRESSION_FIXTURES[0])))
    evidence = result.parsing_metadata.evidence
    assert next(item.quote for item in evidence if item.field == 'education.1.end_date') == '2021–2023'
    first = next(item.source_id for item in evidence if item.field == 'education.0.institution')
    second = next(item.source_id for item in evidence if item.field == 'education.1.institution')
    assert first != second
    assert next(item.quote for item in evidence if item.field == 'experience.0.start_date') == 'Fév. 2026 – Août 2026'

def test_unknown_employer_and_date_ambiguity_stay_missing():
    result = DeterministicCandidateExtractor().extract(PDFText('Experience\nDeveloper – Data & APIs\n2024 - 2025\n2023 - 2026\nMetadata One\nMetadata Two\n- Built a demo.', 1))
    row = result.candidate.experience[0]
    assert row.job_title == 'Developer – Data & APIs'
    assert row.company is None and row.start_date is None and row.end_date is None
    assert row.description == '- Built a demo.'
    assert any('Ambiguous experience date' in warning for warning in result.parsing_metadata.warnings)

def test_organization_prefix_is_not_another_role():
    result = DeterministicCandidateExtractor().extract(PDFText('Experience\nDeveloper – Backend APIs\nEngineering Laboratory\nFeb. 2024 - Aug. 2024\n- Built a demo.', 1))
    assert len(result.candidate.experience) == 1
    assert result.candidate.experience[0].company == 'Engineering Laboratory'

def test_role_words_in_responsibility_bullets_do_not_create_jobs():
    result = DeterministicCandidateExtractor().extract(PDFText('Experience\nDeveloper | Demo Lab\n2024 - 2025\n- Developer mentoring with Python.\n- Data Analyst collaboration on SQL dashboards.', 1))
    assert len(result.candidate.experience) == 1
    assert result.candidate.experience[0].description == '- Developer mentoring with Python.\n- Data Analyst collaboration on SQL dashboards.'

def test_responsibility_and_project_dates_are_content_not_job_metadata():
    result = DeterministicCandidateExtractor().extract(PDFText('Experience\nDeveloper | Demo Lab\n- Built reports covering 2020 - 2024.\nProjects\nReport 2020 - 2024 : A fictional analysis with Python.', 1))
    assert result.candidate.experience[0].start_date is None
    assert '2020 - 2024' in result.candidate.experience[0].description
    assert result.candidate.projects[0].name == 'Report 2020 - 2024'

def test_unknown_month_is_not_an_employer_or_responsibility():
    result = DeterministicCandidateExtractor().extract(PDFText('Experience\nDeveloper\nUnk. 2024 - Present\n- Built a demo.', 1))
    assert result.candidate.experience[0].company is None
    assert result.candidate.experience[0].start_date is None
    assert result.candidate.experience[0].description == '- Built a demo.'

def test_wrapped_role_keeps_company_and_source_evidence_separate():
    fixture = {'id':'wrapped-role', 'rows':[
        {'text':'Alex Fictif','y':30,'size':20,'bold':True},
        {'text':'Experience','y':90,'bold':True},
        {'text':'Stagiaire PFE – Intelligence Artificielle & GraphRAG','y':110,'width':200,'bold':True,'date':'Fév. 2026 – Août 2026'},
        {'text':'Atelier Exemple','y':145,'bold':True},
        {'text':'- Built a fictional GraphRAG prototype.','y':165},
    ]}
    result = DeterministicCandidateExtractor().extract(extract_pdf(make_accuracy_pdf(fixture)))
    assert len(result.candidate.experience) == 1
    assert result.candidate.experience[0].job_title == 'Stagiaire PFE – Intelligence Artificielle & GraphRAG'
    assert result.candidate.experience[0].company == 'Atelier Exemple'
    references = [value for value in result.parsing_metadata.evidence if value.field == 'experience.0.job_title']
    assert len(references) == 2
    assert all('2026' not in value.quote and 'Atelier' not in value.quote for value in references)

def test_wrapped_degree_retains_specialization_and_institution():
    fixture = {'id':'wrapped-degree', 'rows':[
        {'text':'Education','y':90,'bold':True},
        {'text':"Diplôme d'Ingénieur d'État en Informatique",'y':110,'width':145,'bold':True,'date':'2023–2026'},
        {'text':'Institut Exemple','y':145,'bold':True},
    ]}
    result = DeterministicCandidateExtractor().extract(extract_pdf(make_accuracy_pdf(fixture)))
    assert result.candidate.education[0].degree == "Diplôme d'Ingénieur d'État en Informatique"
    assert result.candidate.education[0].field_of_study == 'Informatique'
    assert result.candidate.education[0].institution == 'Institut Exemple'
    assert len([value for value in result.parsing_metadata.evidence if value.field == 'education.0.degree']) == 2

def test_inline_specialization_does_not_merge_into_institution():
    result = DeterministicCandidateExtractor().extract(PDFText('Formation\nBaccalauréat – Sciences Physiques et Chimiques — Lycée Exemple\n2020 - 2021', 1))
    row = result.candidate.education[0]
    assert row.degree == 'Baccalauréat – Sciences Physiques et Chimiques'
    assert row.institution == 'Lycée Exemple'
    assert row.field_of_study == 'Sciences Physiques et Chimiques'

def test_plain_description_is_not_a_project_or_url_technology():
    extractor = DeterministicCandidateExtractor()
    result = extractor.extract(PDFText('Projects\nBuilt a demo: it has no reliable title.\nSkills\nnotHTML CSSology Salesforceish talendish', 1))
    assert result.candidate.projects == [] and result.candidate.technical_skills == []
    assert extract_skills('https://github.com/example/python-css-project') == []
    assert extract_skills('HTTPS://GITHUB.COM/example/Python-CSS-project', include_github=True) == []
    assert extractor.extract(PDFText('Projects\nHTTPS://GITHUB.COM/example/Python-CSS-project', 1)).candidate.projects == []
    assert extract_skills('I would like to learn Salesforce and Talend.') == []

def test_technical_project_title_and_labeled_entries_can_mix():
    result = DeterministicCandidateExtractor().extract(PDFText('Projects\nNode.js & REST API : A fictional demo with CSS.\nName: Demo Portal\nDescription: Built with HTML.\nTechnologies: React', 1))
    assert len(result.candidate.projects) == 2
    assert result.candidate.projects[0].name == 'Node.js & REST API'
    assert set(result.candidate.projects[0].technologies) == {'Node.js', 'REST APIs', 'CSS'}
    assert set(result.candidate.projects[1].technologies) == {'HTML', 'React'}

def test_wrapped_role_and_description_limits_warn_without_silent_loss():
    # Explicit supported title + very long source description.
    result = DeterministicCandidateExtractor().extract(PDFText('Experience\nDeveloper – Platform APIs\nExample Workshop\n- ' + 'Responsibilities ' * 160, 1))
    assert len(result.candidate.experience[0].description) == 2000
    assert any('truncated' in warning for warning in result.parsing_metadata.warnings)
    assert normalize_text('Arti\ufb01cielle') == 'Artificielle'
