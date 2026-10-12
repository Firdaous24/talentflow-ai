# CV extraction accuracy and profile refinement — Phase 3.6

This phase refines the existing deterministic parser and profile view. It adds no runtime service, matching workflow, agents, authentication or candidate persistence. Default startup remains `docker compose up -d --build`, with the UI at http://localhost:5173 and Swagger at http://127.0.0.1:8000/docs.

## Root causes and changes

- A generic dash split turned role subtitles into company names and truncated complete degrees. Experience now reserves `|`, `at` and `chez` for explicit inline employers; dash subtitles stay inside the role. A degree's dash suffix is an institution only when it matches an institution cue; otherwise the full degree remains and a specialization can be preserved separately.
- The month table omitted common French/English abbreviations. Fév./Févr./Janv./Juil./Août/Sept./Déc. and English abbreviations now retain month precision. Unknown month expressions and conflicting automatic ranges are omitted with warnings instead of silently becoming bare years or employers.
- Global top-coordinate ordering could place a date slightly above its title. Co-baseline nonoverlapping fragments now read left-to-right within already identified regions. This does not interleave genuine columns. Wrapped bold title lines require compatible font, alignment, block and line spacing; date annotations are excluded from title evidence.
- Blank lines alone could split metadata from its record. New entry-local segmentation uses role/degree/project anchors, supported date placement and labeled fields. Responsibility bullets remain attached to their job even if they contain role words. Dates inside responsibilities/project titles stay content rather than becoming job metadata.
- Following-line companies, source-supported countries/locations and responsibilities are separated. Optional `experience[].location` is added to the backend and React contracts/editor. Arbitrary city-only strings are not inferred from capitalization. Multiple uncertain employer candidates stay missing.
- “Cycle Préparatoire Intégré” and equivalent English preparatory/foundation entries were absent from degree anchors; lycée/institute cues were incomplete. These are now recognized without organization-specific exceptions. Three consecutive fictional engineering education entries are preserved with their institutions and dates.
- Colon-based projects were explicitly rejected. Section-local `Title : description` entries, labeled records and supported bullets now split consecutive projects without blank lines and collect wrapped descriptions. Titles retain dashes, ampersands, acronyms and terms such as Node.js. Description/technology labels, URLs and ordinary prose do not become project titles. GitHub links are returned only when present.
- PDF ligatures such as “ﬁ” survived NFC normalization and broke exact field values. Compatibility normalization expands ligatures while preserving accented text.
- Source attribution searched a whole section for its first matching string, misattributing repeated years/institutions. Evidence now uses the specific entry's source lines and the shortest supported wrapped-text window. No source is invented when attribution is ambiguous.
- Vocabulary now includes Talend, Odoo, Salesforce, HTML/CSS, Matplotlib, REST APIs, Prompt Engineering, AI Agents and Machine Learning. Token boundaries, aliases, deduplication, URL exclusion and explicit aspiration/negative-clause exclusion keep matching conservative. HTML/CSS use the additive `web_technology` category; existing categories remain valid. Mentions still do not establish proficiency.

`records.py` isolates entry segmentation/association from multilingual normalization, preserving `CandidateExtractor`, Pydantic validation, PDF checks and the optional provider seam. Source quotes, IDs, coordinates and uncertainty remain available to review. A 2000-character description limit remains; truncation is now explicitly warned rather than silent.

## Profile UX

Warnings show a short summary by default. Important ambiguity, invalid data, provider failures, unsupported dates and truncation are highlighted; **Show all warnings** / **Hide warnings** is an accessible button with expansion state and a controlled region. Exact equivalents differing only in case/spacing/trailing sentence punctuation are deduplicated. Full relevant warnings remain available in groups: Needs attention, Missing information, Skill limitations and Extraction notes. Human review stays prominent, and warnings explicitly refer to the original extraction rather than manually corrected values.

Work experience/projects and education/skills/languages/certifications use independent columns with natural card heights. Mobile switches to the usual ordered single-column presentation. Full roles, responsibilities, location, project descriptions/technology tags and category-organized skills remain readable. The dashboard was not redesigned. Existing in-memory correction, removal, consent and confirmation workflows are retained.

## Measured before/after evaluation

Four new entirely fictional fixtures are authored in `backend/tests/fixtures/accuracy_regression.json`, with explicit row coordinates/styles and independently specified ground-truth JSON. They cover internships/subtitles, abbreviated/right-aligned dates, company/location arrangements, three consecutive education records, wrapped/colon/bullet projects, technical terms across columns, and conservative missing metadata. `accuracy_support.py` creates Unicode-preserving PDFs in memory through PyMuPDF HTML text boxes; rendering does not invoke parser rules. No PDF binary or real CV is saved.

Before changing parser logic, the Phase 3.5 application source was copied to an ignored local snapshot at `.artifacts/phase36-baseline/app`. The same authored fixtures, renderer and evaluator were run against that snapshot and the current implementation. [Before results](../evaluation/accuracy_before.json) include SHA-256 source fingerprints; [after results](../evaluation/accuracy_after.json) record current measurements. To rerun the before implementation, that retained snapshot or its matching source version is needed. These are development regressions, not a blind holdout or representative estimate of arbitrary CV accuracy.

Measured on 2026-10-12:

| Metric | Before | After |
| --- | --- | --- |
| Field precision | 44/64 = 68.75% | 176/176 = 100% |
| Field recall | 44/176 = 25% | 176/176 = 100% |
| Exact structured profiles | 0/4 | 4/4 |
| Correct job titles | 1/6 | 6/6 |
| Correct employers | 1/5 | 5/5 |
| Correct experience date endpoints | 4/12 | 12/12 |
| Exact education records | 1/4 | 4/4 |
| Exact project records | 0/7 | 7/7 |
| Skill precision | 10/10 = 100% | 38/38 = 100% |
| Skill recall | 10/38 = 26.32% | 38/38 = 100% |
| Incorrect/unsupported predicted fields vs gold | 20/64 = 31.25% | 0/176 = 0% |

Nonempty field path/value pairs are compared, including skill categories and new source-supported location values. Empty defaults do not inflate the score. Skill and technology list order is ignored, while entry order is retained to expose association failures. Exact record metrics compare the entire normalized record. The gold-mismatch rate includes incorrectly associated source-supported values; it is not a claim about LLM hallucination. The same 176-field denominator is used before/after; expected new fields/categories are retained when evaluating the older schema. The prior eight multilingual development fixtures still match all 202 fields and 48 skills.

Run from `backend/`:

```powershell
.\.venv\Scripts\python.exe -X utf8 evaluate.py
.\.venv\Scripts\python.exe -X utf8 evaluate.py --dataset accuracy
```

Or from the project root:

```powershell
docker compose -f docker-compose.yml -f compose.test.yaml build backend
docker compose -f docker-compose.yml -f compose.test.yaml run --rm --no-deps backend python evaluate.py --dataset accuracy
```

Full actual synthetic output for the dense French case is [fictional_accuracy_output.json](../evaluation/fictional_accuracy_output.json). It includes **three jobs, three education entries and three projects**, full role subtitles, month-precision dates, employer/location separation and entry-specific evidence.

## Validation and privacy

Final executed checks: **141 backend tests passed on Windows and in Docker**, retaining every prior test; **21 frontend tests passed**. Strict TypeScript and production builds passed. Both corpus evaluations ran, including in-container accuracy evaluation. Runtime/test/browser images built, default Compose startup passed, the development override validated, published frontend/Swagger/proxied health returned HTTP 200, and all three services reported healthy. The existing Starlette/httpx deprecation warning remains.

Existing backend/frontend tests are retained. Regression tests cover authored PDF ground truth, API shape, repeated-date evidence, months, unknown/conflicting metadata, role-like responsibility bullets, technical project titles, URL/substring/aspiration false matches, wrapped roles and warned truncation. The optional provider's schema/evidence tests cover location and the new taxonomy; no external LLM calls are made.

Real Chromium uploaded fictional PDFs through the published frontend and actual FastAPI proxy, checked counts and associations, toggled warnings, compared natural card heights, tested mobile overflow and location correction/confirmation. The previous English/two-column French browser workflow also passed. Desktop/mobile screenshots contain fictional information only and are ignored under `.artifacts/`.

Processing is local by default; explicit per-upload consent, backend-only credentials, provider abstraction, evidence rejection and deterministic fallback remain unchanged. No raw real CV, candidate data or credentials are persisted to PostgreSQL, committed, or exposed in React. No volume cleanup, commit or push was performed. API upload/page/structure/encryption limits remain intact.

Optional dense-CV browser QA, after normal Compose startup, from the project root:

```powershell
docker build -t talentflow-ai-browser-test:local frontend/e2e
$fixtureDirectory = (Resolve-Path backend/tests/fixtures).Path
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway --mount "type=bind,source=$fixtureDirectory,target=/fixtures,readonly" talentflow-ai-browser-test:local node accuracy-smoke.mjs
```

## Files and limits

Created: `backend/app/services/records.py`; `backend/tests/accuracy_support.py`, `backend/tests/test_accuracy.py`, `backend/tests/fixtures/accuracy_regression.json`; `frontend/src/components/ExtractionWarnings.tsx`, `frontend/src/test/profile.test.tsx`, `frontend/e2e/accuracy-smoke.mjs`; the before/after and fictional accuracy-output JSON artifacts; this document.

Modified: backend PDF/layout/multilingual/extraction services, candidate schema, evaluation script and LLM tests; frontend profile/review components, TypeScript contracts, synthetic fixture, styles and browser-test Dockerfile; README and both parsing architecture documents. Existing Docker Compose services and dependency versions are unchanged by Phase 3.6. Earlier uncommitted work remains preserved.

Remaining limits: heuristics may omit or misassociate unusually styled records, company-first layouts, dense tables, headerless columns, unsupported city-only locations or unlabeled prose. Similar title/employer typography can be ambiguous. Some narrative skill mentions remain semantically ambiguous; dictionary matching cannot prove proficiency. OCR and hidden annotation links are unsupported. Native PDF resource isolation and external model quality are not certified. Human review remains required. Chromium was tested; Firefox/Safari and assistive technology remain manual checks.

Recommended next phase: an independently authored extraction holdout with varied typography, tables, date placement, multilingual prose and ambiguous organizations; use its failures to improve precision before adding matching or orchestration.

Reference: [PyMuPDF Unicode text and HTML text-box rendering](https://pymupdf.readthedocs.io/en/latest/recipes-text.html).
