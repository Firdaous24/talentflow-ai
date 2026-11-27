# Realistic job-post accuracy — Phase 4.1

Phase 4.1 improves the existing local French/English analyzer for copied job posts. It adds decorated headings, technical-environment provenance, conservative vocabulary, inline metadata and clearer review states. This remains a document checklist: no scores, rankings, eligibility decisions, employment recommendations, active LangGraph agents, authentication or database persistence are introduced.

## Reproduced failure and root causes

Before editing, the complete Phase 4 backend application was copied to `.artifacts/phase41-baseline/app`. A fictional Architecte IA description containing the six reported slash-separated lists produced **zero requirements**. With a labeled location line containing arrows, the analyzer put the entire location/contract/work-mode paragraph into `location` and left employment type null. The reproduction response is retained locally in `.artifacts/phase41-failure-before.json`.

The old section map did not recognize Environnement technique or Tech Stack. Technical lists therefore remained ordinary description text and failed the candidate-qualification gate. Heading parsing handled only a narrow exact label/colon form; it did not consistently support emojis or informal bilingual variants. Metadata stopped after the first colon, without independently bounding arrow/pipe-separated labels. The shared CV vocabulary lacked several job concepts and had no longest-phrase mechanism for nested services. Finally, the original contract had no way to distinguish an environment list from a candidate qualification, and the UI's zero-requirement message concealed that distinction.

## Extraction and review changes

`job_formatting.py` preserves original offsets while recognizing complete heading labels decorated with emojis, numbering, bullets, capitalization, accents and punctuation. Optional inline content is supported after colons or spaced dashes. English/French environment and tool/stack headings, Preferred Skills, Desired Qualifications, technical/profile headings and the existing responsibilities/qualification sections are supported. Heading words inside ordinary prose do not change scope. Contact/email/application calls and hashtag lines are ignored rather than becoming qualifications.

Environment rows retain `origin: "technical_environment"` and `classification: "unspecified"`. Required runtime dependencies are still environment information; qualification origin requires explicit candidate/knowledge/proficiency/experience wording. Required and preferred candidate criteria keep `origin: "qualification"`. A human can edit labels, but cannot silently add technologies, degrees, durations or other unsupported predicates. Original text, category/classification, origin and exact evidence remain immutable. Server reanalysis validates them on every comparison.

Environment rows always return `needs_review`, including after a human changes a classification to Required. Supporting profile mentions can be shown as unverified context, but an environment list cannot establish a mandatory candidate qualification or proficiency. Frontend review places environment rows in a separate section and explains their original unspecified status. Empty/partial states distinguish no supported job information, environment-only extraction, ambiguous classifications and warnings. Candidate confirmation, review acknowledgment, session retention and stale-result invalidation remain intact.

The job-only vocabulary copies the existing CV mappings and extends them without mutating CV extraction. Supported additions/aliases cover AI/IA, Generative AI/GenAI, LLM/LLMs, OpenAI, Microsoft Azure/Azure, Azure AI, Azure OpenAI, RAG, AI Agents, AI Workflows, Machine Learning/ML, MLOps, MLflow, Cloud Computing, Microservices, API, REST APIs, HLD and LLD. Categories reuse the existing schema. Longest non-overlapping phrases keep services/concepts distinct: Azure OpenAI does not imply OpenAI/Azure/AI; generic API does not imply REST APIs; AI, Machine Learning, LLMs and RAG are separate. Acronym, token, URL, hashtag, French `j'ai`, lowercase-unit and cloud-metaphor guards reduce false mentions. Job vocabulary changes do not automatically populate a candidate profile.

Metadata is extracted independently from qualifications. Arrows, pipes and adjacent labels bound title/company/location/employment type/work mode. A guarded short unlabeled location before explicit contract/work-mode labels supports copied posts without interpreting invitation prose or a technical list as a place. Explicit work mode becomes Hybrid, Remote or On-site; detailed schedules retain their exact quote. Negated, conditional, alternative or conflicting arrangements remain null with source evidence/warnings. Location Remote alone does not establish remote work.

`job.metadata_evidence` maps metadata fields to `{quote,start,end}` arrays; original requirements and comparisons add immutable `origin`, and `job.work_mode` is nullable. Offsets remain zero-based Unicode code points with exclusive end, including emoji, CRLF and decorated headings. Endpoints and method literals remain unchanged. The public capabilities endpoint describes the new origin boundary. Older in-memory analyses should be reanalyzed after an upgrade because current source/evidence must match fresh server output.

## Independent fictional corpus and reproducibility

The fourteen cases in `backend/tests/fixtures/jobs_realistic.json` were authored before running either analyzer. They cover all twelve requested scenarios plus ordinary-prose headings and partial/unknown/negative wording: French AI Architect, Azure AI, Generative AI, Cloud Architect, Data Engineer, ML Engineer, informal LinkedIn, mixed language, overlapping slash lists, no mandatory qualifications, inline hybrid metadata, contacts/hashtags/protected wording and challenging negatives. All companies and contacts are invented; no real advertisement or candidate is committed.

The fixture's unchanged SHA256 is `67fbc89de6cf3d68278a8d2c9de3610441be8f3b6f61c5d032c45ae12e1ee492`. The baseline runs in a separate interpreter with the frozen app first on its import path; current models or vocabularies cannot contaminate it. All twenty baseline source hashes match the preserved manifest. The recorded result also contains all twenty-two current application source hashes, verified against final workspace files. The local snapshot is excluded from Git; before/after counts and fingerprints are retained in [recorded results](../evaluation/job_realistic_results.json).

Technology units are unique canonical names **per annotated source clause**, so the same technology on another clause counts again. Required/preferred/unspecified classification and origin use all 38 expected clauses, including misses. Metadata reports explicit values separately from expected nulls, avoiding a majority-null headline. Source evidence requires exact original offsets and a quote contained within an independently positive clause; oversized quotations cannot hide unrelated text. False positives use the 35 independently annotated negative clauses as denominator. Unsupported rows include unannotated/source/category/technology errors and environment mentions incorrectly promoted to qualifications. Metric-integrity tests deliberately omit/duplicate predictions, invent equivalents, promote environments and tamper with evidence.

| Metric | Frozen Phase 4 baseline | Phase 4.1 |
| --- | --- | --- |
| Technical mention precision | 19/20 (95%) | 87/87 (100%) |
| Technical mention recall | 19/87 (21.84%) | 87/87 (100%) |
| Required/preferred/unspecified accuracy | 12/38 (31.58%) | 38/38 (100%) |
| Qualification/environment origin accuracy | 13/38 (34.21%) | 38/38 (100%) |
| Explicit metadata accuracy | 31/43 (72.09%) | 43/43 (100%) |
| All metadata, including expected nulls | 58/70 (82.86%) | 70/70 (100%) |
| Requirement evidence correctness | 16/27 (59.26%) | 38/38 (100%) |
| Metadata evidence correctness | 0/43 (0%) | 43/43 (100%) |
| False-positive negative-clause rate | 2/35 (5.71%) | 0/35 (0%) |
| Unsupported requirement rate | 14/27 (51.85%) | 0/38 (0%) |

All fourteen improved cases match their annotations. No ground-truth expectation was changed merely to obtain passing results. These are small development regressions that guided implementation, **not representative real-world accuracy or an unseen holdout**. Exact grouping can penalize alternative valid clause splits, and negative rates apply only to the annotated clauses.

From `backend/`, reproduce both implementations with the preserved local snapshot:

```powershell
.\.venv\Scripts\python.exe evaluate_jobs_realistic.py --baseline-root ../.artifacts/phase41-baseline --output ../evaluation/job_realistic_results.json --example-output ../evaluation/fictional_ai_architect_output.json
```

For current-only evaluation without that snapshot, omit `--baseline-root`. Docker's rebuilt test image includes the runner:

```powershell
docker compose -f docker-compose.yml -f compose.test.yaml run --rm --no-deps backend python evaluate_jobs_realistic.py
```

## Fictional AI Architect example

The authored AI Architect post returns:

| Field | Extracted value |
| --- | --- |
| Title | Architecte IA |
| Company | Atelier Azur Fictif |
| Location | Rabat/Technopolis |
| Employment type | CDI |
| Work mode | Hybrid |

Its six environment rows contain 19 clause-level technology mentions and **18 distinct names**. All six are unspecified environment information; no mandatory candidate qualification is invented. Azure, Azure AI and Azure OpenAI are separate mentions. The full schedule remains exact evidence: first month mainly on-site, then a hybrid arrangement. Responsibilities, application email and hashtags are excluded from the checklist. The complete real analyzer response is [fictional_ai_architect_output.json](../evaluation/fictional_ai_architect_output.json).

## Executed validation

The final backend suite passed **377 tests** on Windows and Docker: all previous 225 tests, 125 new formatting/vocabulary/comparison tests and 27 independent evaluator tests. The existing Starlette TestClient/httpx deprecation warning remains. The frontend passed **40 tests**, retaining all previous 33 and adding seven environment/metadata/review/empty-state cases. Strict TypeScript and Vite production builds passed.

The original ten-job evaluation retains 33/33 skills and 39/39 requirements, evidence and statuses. The eight-CV evaluation retains 202/202 fields and 48/48 skills; the four CV accuracy fixtures retain 176/176 fields and 38/38 skills. Shared CV services, schemas, dictionaries, dependency manifests, consent gates and session storage are unchanged. No live external model was used.

`docker compose up -d --build` succeeded with the existing three services. Frontend, backend and PostgreSQL are healthy; the original PostgreSQL container and `talentflow-ai_postgres_data` volume were preserved. Normal/development/test configurations validate with `--quiet`. No new service, credential, database table, destructive cleanup or commit/push was introduced.

All four Chromium workflows passed against the live API through Nginx: original English/two-column French CV review, dense CV accuracy/mobile, original job comparison/invalidation and the realistic AI post. The new workflow validates six environment lists, distinct technology names, location/CDI/Hybrid/source schedule, exact Unicode evidence, confirmed candidate gating, unsupported correction HTTP 422 and retry, environment-origin preservation after a Required label edit, comparison `needs_review`, route retention, source invalidation, responsive ordering/wrapping, refresh and no browser storage. Optional fictional screenshots are local ignored artifacts in `.artifacts/phase41-browser/`.

Browser reproduction after normal startup:

```powershell
docker build -t talentflow-ai-browser-test:local frontend/e2e
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway -v "${PWD}\backend\tests\fixtures:/fixtures:ro" talentflow-ai-browser-test:local node realistic-job-smoke.mjs
```

## Files changed in Phase 4.1

| Change | Files |
| --- | --- |
| New source formatting and job vocabulary | `backend/app/services/job_formatting.py`, `backend/app/services/job_vocabulary.py` |
| Updated contracts/service/capabilities | `backend/app/models/job.py`, `backend/app/services/jobs.py`, `backend/app/api/routes/jobs.py` |
| New backend regressions and evaluator | `backend/tests/test_jobs_realistic.py`, `backend/tests/test_jobs_realistic_evaluation.py`, `backend/tests/fixtures/jobs_realistic.json`, `backend/evaluate_jobs_realistic.py` |
| New measured/example artifacts | `evaluation/job_realistic_results.json`, `evaluation/fictional_ai_architect_output.json` |
| Updated frontend workflow/types/styles/tests | `frontend/src/pages/JobAnalysis.tsx`, `frontend/src/jobTypes.ts`, `frontend/src/jobAnalysis.css`, `frontend/src/test/jobAnalysis.test.tsx` |
| New UI fixtures and browser workflow | `frontend/src/test/jobFixtures.ts`, `frontend/e2e/realistic-job-smoke.mjs` |
| Updated test packaging | `backend/Dockerfile`, `frontend/e2e/Dockerfile` |
| Updated/new documentation | `README.md`, `docs/job_analysis_architecture.md`, `docs/job_analysis_accuracy.md` |

## Limits and Phase 5 recommendation

Rules remain conservative and vocabulary-bound. Unknown technologies, ambiguous prose, unusual delimiter/layout patterns, negation scope, alternate schedules and unfamiliar protected-language variants may be omitted or require review. Generic metadata inference is a heuristic, not geocoding. Lexical separation is not ontology reasoning: an Azure OpenAI mention does not prove OpenAI/Azure expertise, and no skill mention proves proficiency. Source statements and human corrections remain unverified; matching snapshots are consistency checks, not authenticated approvals.

For Phase 5, first build a broader unseen, independently annotated French/English holdout and error taxonomy, then add authenticated/auditable review records and purpose-limited persistence before shared deployment. Any optional job-model strategy should be evaluated against the same source, consent and environment/qualification boundaries. Candidate ranking and automated employment decisions remain outside this tool's purpose.
