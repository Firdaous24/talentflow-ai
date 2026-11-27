# Real-world comparison accuracy — Phase 4.3

This phase improves document extraction and evidence inspection in the existing application. It does not measure candidate ability or automate employment decisions. All committed fixtures and browser profiles are fictional.

## Confirmed causes

The French Data Business Analyst reproduction exposed several independent defects:

1. The job-specific vocabulary lacked GCP/Google Cloud Platform, Teradata and Airflow/Apache Airflow. Parentheses were retained correctly, but unsupported names were absent from both the extracted skills and Technical Evidence Overview.
2. Business-analysis requirements reached the generic comparison branch without retrieving explicit requirements-gathering/process-modeling statements. The experience fallback could instead match generic French words such as `des`, `une` or `dans`, returning unrelated evidence.
3. Comparison evidence selected entire reviewed fields. Even correctly segmented, multi-bullet experience descriptions therefore appeared excessively long.
4. CV section detection did not recognize several explicit academic/university-project headings. Those sections could remain inside the preceding experience. PyMuPDF retained the headings correctly in the reproduced PDFs.
5. Entry detection lacked English Business Analyst and Business Intelligence Analyst role anchors. A later job could merge with its predecessor, mixing descriptions, technologies and date ranges.

Structured profile construction and React review/session state retained separate entries when supplied by the parser. They were not the source of the reproduced section merge. Layout extraction, section detection, entry detection, retrieval and rendering were tested separately rather than attributing every long quote to a PDF-layout failure.

## Implementation and interpretation

Job-only aliases add three canonical names: **GCP**, **Teradata** and **Airflow**. Exact matching retains distinctions from Azure, SQL and generic workflow automation. Qualification wording, source classification, technical-environment origin and original source offsets remain separate. Ambiguous clinical GCP and natural-airflow contexts need conservative handling; a tool mention alone does not establish proficiency.

Evidence selection uses source-bound sentence/bullet spans, rather than a display character limit. Business-analysis concept rules retrieve explicit French/English statements without declaring mastery or equivalence. Experience evidence stays in professional-experience fields; projects do not establish employment duration. Generic French stopwords no longer establish industry relevance. Networking/VoIP is not evidence of employment in the telecommunications sector. The qualification projection excludes dates and employers, so the comparison does not calculate tenure or infer industry from employer identity.

The CV changes add seven exact project-heading aliases to the shared section detector and two exact English role anchors. Entry-local dates, companies, technologies, original evidence and extraction warnings remain intact. Unsupported layouts/headings/roles can still need correction during human review.

The realistic example now exposes SQL, GCP, Teradata and Airflow. A reviewed fictional profile mentioning SQL and Airflow provides supporting mentions for those technologies; GCP and Teradata appear neutrally without supporting CV evidence. Advanced SQL, composite stack familiarity and five-year experience claims remain subject to interpretation. No overlap count changes the qualification statuses. When no qualifying sector statement is found, `not_documented` describes the submitted documentation, not the person's experience or ability.

## Additive evidence contract

Existing clients continue to receive the full reviewed field in `candidate_evidence[].quote`. The optional additive field is:

```json
{
  "field": "experience.0.description",
  "quote": "Prepared fictional notes.\nUsed SQL to validate data quality.\nMaintained documentation.",
  "unverified": true,
  "excerpt": {
    "quote": "Used SQL to validate data quality.",
    "start": 26,
    "end": 60
  }
}
```

Offsets count Unicode code points in the full `quote`; the invariant is `quote[start:end] == excerpt.quote`. The API validates these offsets on every constructed excerpt. `excerpt` is omitted when unnecessary, preserving legacy short-evidence JSON. The source is the reviewed qualification field, not a claim about a PDF page coordinate.

The frontend displays the backend excerpt, its field and offsets, with **View full reviewed field** for the original text. It validates the span with Unicode code points and falls back to the full quote if inconsistent. It does not select snippets by substring similarity or infer technical equivalences. Whole-field canonical matches can be highlighted; canonical technology chips make tool names visible without fabricating token matches inside prose.

The Phase 4.2 counts, filters, interpretation links and evidence cards remain. Source and interpretation are separately labelled; long classification details and warnings use disclosures. Evidence sections stack when a source column would otherwise be empty. Full original requirements remain inspectable. Candidate selection, separate candidate/job confirmations, route memory and edit invalidation are unchanged.

## Independent evaluation

`backend/tests/fixtures/comparison_accuracy.json` contains **16 independently authored French/English scenarios**, frozen before production tuning or running predictions. Its SHA-256 is `9d945092e74ee40ce4d742513e3d614cac7105629f7187fda8840a5b239154c1`, recorded in `evaluation/comparison_accuracy_manifest.json`. Expected labels were not revised after seeing output.

The corpus covers Data Business Analyst, Data/AI/ML/Cloud engineers, BI analysis, mixed business/technical requirements, mandatory/preferred/environment distinctions, ambiguous acronyms, negation/hypotheticals, overlapping canonical names, privacy canaries and four CV section/entry scenarios. It contains 46 expected clauses, 48 technology occurrences, 39 expected supporting excerpts and 60 segmentation assertions. Missing output stays in recall denominators.

Before tuning, 22 Phase 4.2 backend source files were copied into the ignored local `.artifacts/phase43-baseline/app` snapshot, with source hashes recorded in its manifest. Baseline and current engines run in separate interpreter processes. Earlier Phase 4/4.1 evaluation artifacts are historical and were not rewritten.

Run from `backend/`:

```powershell
.\.venv\Scripts\python.exe evaluate_comparison_accuracy.py --baseline-root ../.artifacts/phase43-baseline --output ../evaluation/comparison_accuracy_results.json
```

Omit `--baseline-root` for current-only evaluation when the local snapshot is unavailable. Results include separate extraction precision/recall, classification and origin, source correctness, segmentation, evidence relevance/recall/boundaries, unsupported evidence, privacy exclusions and status behavior, with per-case differences. The runner verifies all baseline file hashes before and after importing the isolated engine and records the current source fingerprint. Baseline manifest SHA-256: `e28422f021ead02d54eb5700fffdab00a7e105c50192673432a5bfb5abf22c0d`.

Final execution on 2026-10-15:

| Measure | Frozen Phase 4.2 | Phase 4.3 |
| --- | --- | --- |
| Technology mention precision | 29/29 (100%) | 48/48 (100%) |
| Technology mention recall | 29/48 (60.42%) | 48/48 (100%) |
| Qualification classification | 44/46 (95.65%) | 46/46 (100%) |
| Source origin | 44/46 (95.65%) | 46/46 (100%) |
| Job/checklist citation correctness | 44/44 | 46/46 |
| Technical-overview citation correctness | 29/29 | 48/48 |
| Candidate field/span source correctness | 30/30 | 36/36 |
| CV section/entry assertions | 11/60 (18.33%) | 41/60 (68.33%) |
| Complete CV segmentation | 0/4 | 2/4 |
| Evidence relevance precision | 29/30 (96.67%) | 36/36 (100%) |
| Evidence relevance recall | 29/39 (74.36%) | 36/39 (92.31%) |
| Concise excerpt boundaries | 18/30 (60%) | 36/36 (100%) |
| Unsupported evidence rate | 1/30 (3.33%) | 0/36 (0%) |
| Privacy exclusions | 6/6 | 6/6 |
| Comparison status agreement | 35/46 (76.09%) | 43/46 (93.48%) |

These metrics use different denominators deliberately. Grounded full-field evidence can earn relevance credit while failing concise-boundary credit. Missing expected evidence remains in recall, even when the privacy filter deliberately omits it. The full result JSON retains every difference.

Five cases still have discrepancies: `ml_engineer_en` and `entry_boundaries_en` contain unsupported Software/Data/Web Intern anchors; `negative_candidate_en` loses a safe SQL bullet alongside a negated claim; `privacy_canary_fr` loses safe SQL/Python bullets alongside contact data; `data_ba_fr` retains the sector-status policy disagreement. None of those annotations was relabelled to inflate results.

This is a small development corpus, not a population holdout or an estimate of real-world recruitment performance. Exact excerpt labels can penalize other valid wording boundaries. A frozen telecom-sector label expects `needs_review`, while the product deliberately returns `not_documented` when no qualifying statement is found; that discrepancy remains visible. Conservative privacy/negation filters can omit an entire field, including safe neighbouring bullets, and reduce evidence recall. Plain-text corpus segmentation isolates parser logic; separate generated-PDF regressions and Chromium exercise file ingestion and rendering.

## Executed validation

- **495 backend tests passed** on Windows (17.64s) and in the Linux Docker image (13.89s). This includes 22 real-world comparison tests, 17 PDF/section regressions and 27 evaluator-integrity tests. The existing Starlette/httpx deprecation warning remains.
- Before tuning, the initial 20 new comparison tests had **10 failures / 10 passes**, and the 17 boundary tests had **11 failures / 6 passes**. After fixes, both complete suites passed; two additional tests preserve English/French contrast qualifiers such as “However” and “Cependant”.
- **73 frontend tests passed** across seven files, including compact excerpts, full-field disclosure, Unicode offsets, malformed-span fallback, stack interpretation and all existing selection/review/422/session/invalidation checks.
- **Strict TypeScript (`tsc -b`, `strict: true`) and the Vite production build passed** in normal Compose startup. No application dependency was added.
- Chromium uses generated fictional PDF bytes and real same-origin local API responses. The new Data BA scenario verifies two jobs plus one academic project, confirmation and selection without refresh, five original job clauses, four canonical technologies, **SQL/Airflow supporting mentions**, **GCP/Teradata without supporting mentions**, exact job/CV spans, concise/default versus full-field evidence, local filters, route retention, profile/source invalidation, no browser storage and 390px mobile layout. Its actual counts are **0 documented / 1 not documented / 4 needs review**; the interface derives counts from the response.

**All seven Chromium workflows passed**, including the final new scenario and comparison-results rerun against the final rebuilt frontend. The complete workflow passed: **Upload CV → Review → Confirm → Select candidate → Analyze job → Review requirements → Compare evidence → Results**. Selection before confirmation also remains independently supported, while comparison stays gated.

The retained browser scripts cover CV review, dense French layout accuracy, job comparison, realistic environment-only posts, native mouse/keyboard candidate selection and Phase 4.2 results. The native check opens Chromium's actual select popup and clicks both awaiting profiles; comparison remains gated by review. Early browser checks exposed test-harness assumptions about absent pre-analysis buttons, the existing `Position` review-field label and newly nested disclosure summaries. Selectors were corrected to match the actual interface; those findings did not require weakening product gates.

### Reproduce validation

From the project root:

```powershell
docker build --target test -t talentflow-ai-backend-test:local backend
docker run --rm talentflow-ai-backend-test:local
docker build --target test -t talentflow-ai-frontend-test:local frontend
docker run --rm talentflow-ai-frontend-test:local npm test
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker build -t talentflow-ai-browser-test:local frontend/e2e
New-Item -ItemType Directory -Force -Path .artifacts/phase43 | Out-Null
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway -v "${PWD}\backend\tests\fixtures:/fixtures:ro" -v "${PWD}\.artifacts\phase43:/screenshots" -e SCREENSHOT_DIR=/screenshots talentflow-ai-browser-test:local node real-world-comparison-smoke.mjs
```

The other scripts use the same read-only fixtures mount: `smoke.mjs`, `accuracy-smoke.mjs`, `job-smoke.mjs`, `realistic-job-smoke.mjs`, `comparison-results-smoke.mjs` and `comparison-workflow-smoke.mjs`. Add `-e NATIVE_MOUSE=1` for the native dropdown check. The Docker backend test target includes the evaluator and adjacent frozen fixture manifest; a current-only run needs no local baseline snapshot.

Local ignored screenshots were visually inspected at desktop and mobile sizes, including concise SQL evidence and full-field disclosure; no horizontal overflow or clipping was found. They can be regenerated with the command above:

- [Data BA desktop](../.artifacts/phase43/real-world-comparison-desktop.png)
- [Concise SQL evidence](../.artifacts/phase43/real-world-comparison-expanded.png)
- [Data BA mobile](../.artifacts/phase43/real-world-comparison-mobile.png)

Normal `docker compose up -d --build` and configuration validation succeeded. The frontend, backend and PostgreSQL healthchecks passed. PostgreSQL retains container `35deac7994bf255ff1cd2a0181c4aaacd86cba1cc71d3af623f65df9c8f8192f` and volume `talentflow-ai_postgres_data`. No volume was removed/reset and no data deletion, commit or push was performed.

## Files for this phase

| Files | Purpose |
| --- | --- |
| `backend/app/services/job_vocabulary.py` | Conservative job-only aliases and ambiguity handling |
| `backend/app/services/jobs.py` | Source-bound evidence retrieval and composite/business/industry handling |
| `backend/app/models/job.py` | Optional validated excerpt response field |
| `backend/app/services/sections.py`, `multilingual.py` | Explicit project section and Business Analyst entry boundaries |
| `backend/tests/test_real_world_comparison.py`, `test_cv_section_boundaries.py` | Fictional API/evidence/composite/PDF regressions authored before tuning |
| `backend/tests/fixtures/comparison_accuracy.json`, `comparison_accuracy.manifest.json`, `backend/evaluate_comparison_accuracy.py`, `backend/tests/test_comparison_accuracy_evaluation.py` | Frozen annotations and isolated measurement |
| `evaluation/comparison_accuracy_manifest.json`, `comparison_accuracy_results.json` | Corpus provenance and reproducible before/after measurements |
| `frontend/src/jobTypes.ts`, `components/ComparisonResults.tsx`, `comparisonResults.css` | Compatible excerpt/full-field UI and compact responsive evidence |
| `frontend/src/test/comparisonResults.test.tsx` | Compact/full source, Unicode, malformed span and stack interpretation regressions |
| `frontend/e2e/real-world-comparison-smoke.mjs`, `comparison-results-smoke.mjs`, `Dockerfile` | New real-API scenario and retained browser checks |
| `backend/Dockerfile` | Include the current-only evaluator in the existing test target |
| `README.md`, this document | Current behavior, measurements and limits |

No application dependency, Compose service or database schema is added. No real CV or identifiable candidate data is committed. Qualification-only requests, evidence checks, privacy filters and unverified review assertions remain in force.

## Remaining work for Phase 5

Broaden independently authored holdouts before further rule tuning, particularly unsupported role/section names, unusual layouts, mixed positive/negative fields, cross-language qualifications and ambiguous acronyms. Measure evidence omissions as well as false evidence. Add authenticated, auditable review records and purpose-limited persistence before shared deployment. OCR, optional model evaluation and LangGraph remain future work; scoring, ranking and automated hiring decisions remain outside this tool.
