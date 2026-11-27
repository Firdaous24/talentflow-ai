# Comparison results UX — Phase 4.2

The results view provides a compact document-evidence overview with expandable source details. Candidate selection, explicit profile confirmation and the separate job review remain independent steps. Every session profile remains selectable; comparison still requires both reviews.

## Interface

- **Comparison summary** counts the actual `documented`, `not_documented` and `needs_review` rows returned by the API. These counts describe evidence statuses, not candidate quality or suitability.
- **Technical Evidence Overview** separates canonical technologies mentioned in both documents from **No supporting mention found in the reviewed CV**. Each technology appears once, with its source references aggregated. Expand a technology to inspect job excerpts, source character offsets and reviewed qualification-field references.
- **Requires interpretation** identifies the source clauses whose existing comparison status requires human review. Technical environment lists retain their original provenance and always require interpretation, including when a reviewer edits their classification.
- **Requirement evidence cards** initially show the title, classification, status, technology chips and a concise explanation. Expand a card to inspect original job evidence, unverified candidate excerpts, corrected/original labels, interpretation notes and warnings.
- **Job context and source evidence** keeps job metadata available in a disclosure on the results view, so the summary appears earlier. Source and requirements views retain the full metadata display.
- **All / Documented / Not documented / Needs review** filters operate on existing response rows in the browser. They do not send another comparison request or remove stored results. Expand-all and collapse-all controls apply to evidence cards.

The source, reviewed requirements and comparison tabs retain the current job session. Editing the source or reviewed requirements invalidates old comparison results. Saving profile edits revokes confirmation and invalidates its results while retaining the selected candidate. Data remains in React memory; refresh/clear removes it.

Filters and expansion controls are local presentation state. Returning to the results view restores the stored comparison data without a backend call; presentation controls can reset when the view remounts. Original quotes remain complete in expanded details. Collapsed long titles are visually limited to two lines while retaining their accessible text.

## Source of technical evidence

The comparison response adds `technical_evidence`, an array defaulting to empty for backward-compatible response construction. Existing comparison rows, statuses, method and review assertion retain their semantics. No comparison request field is added.

Each entry contains:

```text
name, category
job_references[]:
  requirement_id, origin, classification
  evidence[]: quote, start, end
candidate_evidence[]: field, quote, unverified=true
requires_interpretation
```

The backend first applies the existing review/snapshot checks and reconstructs the original analysis. It then aggregates the canonical technologies from the selected source-validated requirements and environment clauses. Repeated names retain every corresponding requirement/source reference. Candidate mentions come from the existing privacy-filtered qualification leaves and canonical longest-phrase vocabulary, indexed once per comparison. Names, contacts, employers, institutions, locations, dates and URLs remain excluded from the structured comparison payload.

The frontend renders this structured evidence. It does not recognize technologies using substring similarity, fabricate missing technologies when the field is unavailable, infer equivalent tools or change the underlying comparison status. Azure OpenAI/OpenAI, Azure AI/Azure, RAG/GraphRAG, AI Agents/AI, REST APIs/API and Machine Learning/MLOps remain distinct concepts.

Job references retain exact original excerpts and immutable character offsets. Their classification describes the original source; the existing comparison row separately preserves the reviewer's classification. Candidate references identify the reviewed qualification field, rather than claiming an original PDF page position that this purpose-limited API does not receive.

## Meaning and limitations

An explicit CV mention is unverified evidence of a statement. It does not establish expertise, proficiency, years, seniority, accreditation or technical equivalence. No supporting mention means none was found in the submitted reviewed qualification fields; it does not establish absence of ability.

Environment-only rows stay `needs_review` even when their technologies appear in both documents. Their context does not establish mandatory or preferred candidate qualifications. A technical overlap can therefore coexist with zero documented qualification rows.

The overview covers the analyzer's supported requirements/environment clauses, rather than every word in a raw job advertisement. The existing conservative privacy, contact and negation filters can omit an entire qualification field. Unknown vocabulary, ambiguous short lowercase acronyms and indirect/cross-language claims can remain unrecognized. Original CV extraction and reviewed qualification statements are distinct sources; this overview uses the reviewed statements. Review assertions remain unauthenticated client workflow claims. There are no scores, rankings, suitability labels or hiring recommendations.

Free-text qualification fields can still contain personal information not recognized by the conservative filters. Review and remove irrelevant personal details before confirmation. The structured projection and existing filters are retained rather than presented as a complete de-identification system.

## Validation

Use the existing frontend test target, backend pytest and normal production Compose startup. The browser QA image uses fictional PDFs generated in memory and real local API responses.

Executed on 2026-10-15:

- **429 backend tests passed** on Windows and in the Linux Docker test image, including 29 new canonical/provenance/privacy/compatibility cases. The existing Starlette/httpx deprecation warning remains.
- **69 frontend tests passed** across seven files, including nine new results regressions. Coverage includes counts, neutral labels, distinct nested names, repeated references without response mutation, old/empty responses, filters without API calls, accessible expansion/focus, warning deduplication, source/profile invalidation and the existing candidate workflow.
- **Strict TypeScript checks and the Vite production build passed**, including the final compact-chip and job-context refinements. No application dependency or component library was added.
- **All six Chromium workflows passed**: CV review, dense CV accuracy, job comparison, realistic job descriptions, native mouse/keyboard candidate selection, and the new comparison results workflow. The final results check uses a fictional reviewed CV against the six-list French AI Architect fixture. Its real response has 18 distinct technologies, five CV overlaps, 13 without supporting CV mentions, and status counts **0 documented / 0 not documented / 6 needs review**. Those fixture counts are asserted by tests; the production interface derives its values dynamically from each response.
- Browser checks inspected all exact job/CV quotes and references, aggregated two AI source clauses into one technology, expanded evidence with the keyboard, filtered all statuses, and followed an interpretation link from a filter that hid its card. These presentation actions generated no additional job API POSTs. Removing RAG while retaining GraphRAG in the reviewed profile changed only the supported overlap as expected after reconfirmation. Profile/source edits invalidated old results. The 390-pixel mobile layout passed horizontal-overflow checks, including expanded cards.
- **`docker compose config --quiet` and `docker compose up -d --build` succeeded**. Frontend, backend and PostgreSQL are healthy. The original PostgreSQL container and `talentflow-ai_postgres_data` volume are preserved. No data was reset, and no commit or push was made.

Browser QA initially exposed two test-harness assumptions: mobile navigation must be opened before clicking a sidebar link, and profile edits disable the existing results tab rather than removing it. The harness now checks those actual behaviors. One optional QA-image build encountered a Docker cache snapshot error; rebuilding that image with `--no-cache` succeeded without deleting Docker data. Normal application Compose startup was successful.

### Reproduce checks

From the project root, with Docker available:

```powershell
docker build --target test -t talentflow-ai-backend-test:local backend
docker run --rm talentflow-ai-backend-test:local
docker build --target test -t talentflow-ai-frontend-test:local frontend
docker run --rm talentflow-ai-frontend-test:local npm test
docker compose config --quiet
docker compose up -d --build
docker build -t talentflow-ai-browser-test:local frontend/e2e
New-Item -ItemType Directory -Force -Path .artifacts/phase42 | Out-Null
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway -v "${PWD}\backend\tests\fixtures:/fixtures:ro" -v "${PWD}\.artifacts\phase42:/screenshots" -e SCREENSHOT_DIR=/screenshots talentflow-ai-browser-test:local node comparison-results-smoke.mjs
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway -e NATIVE_MOUSE=1 talentflow-ai-browser-test:local node comparison-workflow-smoke.mjs
```

The normal frontend image build runs `tsc -b && vite build` with `strict: true`. The optional browser helper uses the existing image's Xvfb/XTest libraries for native popup mouse interaction; it adds no application infrastructure. Other retained browser scripts are `smoke.mjs`, `accuracy-smoke.mjs`, `job-smoke.mjs` and `realistic-job-smoke.mjs`; fixture-based scripts use the read-only `/fixtures` mount above.

### Screenshots

Local generated QA artifacts, inspected at desktop and mobile sizes:

- [Desktop overview and compact cards](../.artifacts/phase42/comparison-results-desktop.png)
- [Expanded source details](../.artifacts/phase42/comparison-results-expanded.png)
- [Mobile overview and cards](../.artifacts/phase42/comparison-results-mobile.png)

These fictional screenshots are ignored QA outputs and can be regenerated with the command above.

## Files created and modified for Phase 4.2

| Files | Change |
| --- | --- |
| `backend/app/models/job.py` | Additive `TechnicalEvidence`/`TechnicalJobReference` response contracts |
| `backend/app/services/jobs.py` | Canonical aggregation over source-validated requirements and indexed filtered qualification fields |
| `backend/tests/test_technical_evidence.py` | 29 backend regressions |
| `frontend/src/components/ComparisonResults.tsx`, `frontend/src/comparisonResults.css` | New compact results component, accessible controls and responsive styling |
| `frontend/src/jobTypes.ts` | Optional typed technical overview for old/new response compatibility |
| `frontend/src/pages/JobAnalysis.tsx`, `frontend/src/jobAnalysis.css` | Integrate the new component, remove the long inline results renderer and fold results metadata |
| `frontend/src/test/comparisonResults.test.tsx` | Nine results regressions |
| `frontend/src/test/jobAnalysis.test.tsx`, `frontend/src/test/comparisonWorkflow.test.tsx` | Preserve existing review/invalidation cases while inspecting expanded evidence |
| `frontend/e2e/comparison-results-smoke.mjs`, `frontend/e2e/Dockerfile` | New real-API desktop/mobile browser workflow and QA image inclusion |
| `README.md`, `docs/comparison_results_ux.md` | Feature overview, contract, limitations and actual verification |

Candidate/session providers, comparison request shape, existing technology vocabulary, extraction services, dependency manifests, Compose configuration and PostgreSQL data are unchanged by this phase. Earlier evaluation artifacts remain historical measurements rather than being rewritten for a results presentation change.
