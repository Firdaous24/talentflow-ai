"""Optional provider calls are simulated; no CV content leaves these tests."""
import json
import httpx
import pytest
from app.models.candidate import CandidateProfile
from app.services.llm import EvidenceCheckedExtractor, ModelExtraction, OpenAICompatibleProvider, ProviderFailure, ClaimEvidence, provider_configuration, strict_schema
from app.services.pdf import PDFText

class FakeProvider:
    def __init__(self, response=None, error=None): self.response, self.error = response, error
    def extract(self, sources):
        if self.error: raise self.error
        return self.response

def test_valid_model_evidence_is_accepted_and_attributed():
    provider = FakeProvider(ModelExtraction(candidate=CandidateProfile(full_name='Jordan Example'), evidence=[ClaimEvidence(field='full_name', source_ids=['text-0'])]))
    result = EvidenceCheckedExtractor(provider).extract(PDFText('Jordan Example\nSkills\nPython', 1))
    assert result.parsing_metadata.engine == 'llm'
    assert result.parsing_metadata.llm_status == 'succeeded'
    assert result.parsing_metadata.evidence[0].method == 'llm'
    assert [skill.name for skill in result.candidate.technical_skills] == ['Python']

def test_location_and_web_taxonomy_use_the_same_model_evidence_gate():
    candidate = CandidateProfile(experience=[{'job_title':'Developer', 'location':'Maroc'}], technical_skills=[{'name':'HTML','category':'web_technology'}])
    evidence = [ClaimEvidence(field='experience.0.job_title', source_ids=['text-1']), ClaimEvidence(field='experience.0.location', source_ids=['text-2']), ClaimEvidence(field='technical_skills.0.name', source_ids=['text-4'])]
    result = EvidenceCheckedExtractor(FakeProvider(ModelExtraction(candidate=candidate, evidence=evidence))).extract(PDFText('Experience\nDeveloper\nMaroc\nSkills\nHTML', 1))
    assert result.parsing_metadata.llm_status == 'succeeded'
    assert result.candidate.experience[0].location == 'Maroc'

def test_empty_model_result_keeps_local_profile():
    result = EvidenceCheckedExtractor(FakeProvider(ModelExtraction(candidate=CandidateProfile(), evidence=[]))).extract(PDFText('Skills\nPython', 1))
    assert result.parsing_metadata.llm_status == 'fallback'
    assert [skill.name for skill in result.candidate.technical_skills] == ['Python']

@pytest.mark.parametrize('name,source', [('Invented Person', 'text-0'), ('Jordan Example', 'missing')])
def test_hallucinated_or_missing_evidence_falls_back(name, source):
    provider = FakeProvider(ModelExtraction(candidate=CandidateProfile(full_name=name), evidence=[ClaimEvidence(field='full_name', source_ids=[source])]))
    result = EvidenceCheckedExtractor(provider).extract(PDFText('Jordan Example\nSkills\nPython', 1))
    assert result.parsing_metadata.engine == 'deterministic-v2'
    assert result.candidate.full_name == 'Jordan Example'
    assert result.parsing_metadata.llm_status == 'fallback'

def test_wrong_section_skill_and_category_are_rejected():
    candidate = CandidateProfile(technical_skills=[{'name': 'Python', 'category': 'programming_language'}])
    evidence = [ClaimEvidence(field='technical_skills.0.name', source_ids=['text-1'])]
    result = EvidenceCheckedExtractor(FakeProvider(ModelExtraction(candidate=candidate, evidence=evidence))).extract(PDFText('Profil\nJe souhaite apprendre Python.\nSkills\nSQL', 1))
    assert result.parsing_metadata.llm_status == 'fallback'
    assert [skill.name for skill in result.candidate.technical_skills] == ['SQL']
    candidate.technical_skills[0].category = 'database'
    result = EvidenceCheckedExtractor(FakeProvider(ModelExtraction(candidate=candidate, evidence=evidence))).extract(PDFText('Skills\nPython', 1))
    assert result.parsing_metadata.llm_status == 'fallback'

@pytest.mark.parametrize('status', [401, 429, 500])
def test_provider_http_errors_never_leak_payload(status):
    provider = OpenAICompatibleProvider('https://provider.example/v1', 'configured-model', 'test-only-key', httpx.MockTransport(lambda request: httpx.Response(status, json={'error': 'sensitive CV content'})))
    with pytest.raises(ProviderFailure) as caught: provider.extract([])
    assert 'sensitive' not in str(caught.value)

@pytest.mark.parametrize('body', ['not json', '{"choices":[]}', '{"choices":[{"message":{"content":"not json"}}]}', '{"choices":[{"message":{"refusal":"no"}}]}'])
def test_provider_invalid_json_and_refusals(body):
    provider = OpenAICompatibleProvider('https://provider.example/v1', 'configured-model', 'test-only-key', httpx.MockTransport(lambda request: httpx.Response(200, content=body)))
    assert EvidenceCheckedExtractor(provider).extract(PDFText('Skills\nPython', 1)).parsing_metadata.llm_status == 'fallback'

def test_timeout_fallback():
    def timeout(request): raise httpx.ReadTimeout('private text', request=request)
    provider = OpenAICompatibleProvider('https://provider.example/v1', 'configured-model', 'test-only-key', httpx.MockTransport(timeout))
    result = EvidenceCheckedExtractor(provider).extract(PDFText('Skills\nPython', 1))
    assert 'provider_timeout' in result.parsing_metadata.warnings[-1]
    assert 'private' not in result.parsing_metadata.warnings[-1]

def test_actual_provider_request_uses_schema_and_configured_model():
    def respond(request):
        payload = json.loads(request.content)
        assert payload['model'] == 'configured-model'
        assert payload['response_format']['json_schema']['strict'] is True
        assert request.url.path == '/v1/chat/completions'
        return httpx.Response(200, json={'choices': [{'message': {'content': json.dumps({'candidate': CandidateProfile().model_dump(mode='json'), 'evidence': []})}}]})
    provider = OpenAICompatibleProvider('https://provider.example/v1', 'configured-model', 'test-only-key', httpx.MockTransport(respond))
    assert provider.extract([]).candidate.full_name is None
    schema = strict_schema(); assert set(schema['required']) == {'candidate', 'evidence'}

def test_default_config_and_consent_gate(client, monkeypatch):
    for name in ('LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'): monkeypatch.delenv(name, raising=False)
    assert client.get('/api/v1/candidates/extraction-config').json()['available'] is False
    response = client.post('/api/v1/candidates/parse', data={'use_llm': 'true'}, files={'file': ('fake.pdf', b'%PDF-', 'application/pdf')})
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'consent_required'

def test_public_config_never_exposes_credentials(monkeypatch):
    for name, value in {'LLM_PROVIDER': 'openai-compatible', 'LLM_BASE_URL': 'https://provider.example/v1', 'LLM_MODEL': 'configured-model', 'LLM_API_KEY': 'secret-test-only'}.items(): monkeypatch.setenv(name, value)
    config = provider_configuration(); assert config['available'] is True; assert 'secret-test-only' not in json.dumps(config)
    monkeypatch.setenv('LLM_BASE_URL', 'http://['); assert provider_configuration()['available'] is False
    monkeypatch.setenv('LLM_BASE_URL', 'https://provider.example:bad/v1'); assert provider_configuration()['available'] is False
