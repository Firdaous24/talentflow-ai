# Job analysis final accuracy fixes — Phase 4.3.1

This phase targets three issues in the existing deterministic analyzer and evidence checklist. All reproduction data is fictional. It retains candidate selection, separate candidate/job review, qualification-only requests, original source evidence, compact results and Docker services.

## Reproduction and causes

The new French Data Business Analyst fixture uses the six requested qualification bullets, blank lines, literal trailing backslashes and a final standalone backslash. Before production edits, it produced **seven requirements**, with `req-007` containing only `\`. The five-year clause was **unspecified**; telecommunications experience was already **preferred**. SQL, GCP, Teradata and Airflow were already recognized.

The requirement pipeline considered any nonempty clause eligible inside a qualification section. Bullet stripping did not make an isolated backslash empty, and there was no semantic-content guard before constructing a requirement. This is a clause-admission defect, not source-text corruption.

The mandatory-word matcher did not include explicit minimum-experience thresholds. `PROFIL RECHERCHÉ` correctly provides neutral section context; it should not make all qualifications mandatory. The missing rule was the narrower meaning of “Minimum 5 ans d'expérience” and equivalent explicit threshold wording. The exact `Required qualifications` heading was also missing from the heading aliases.

Business Analysis evidence absence was **not reproduced for every positive profile**. Before changes, the exact observed job clause already recognized requirements gathering and functional specifications. Reviewed safe descriptions containing “Recueil de besoins”, “Analyse des besoins métier”, “Business requirements gathering” and functional specifications already returned source evidence. A generated fictional PDF retained those descriptions through PyMuPDF, structured extraction and the same qualification projection as the React review flow. No CV/review transformation defect was demonstrated for those cases.

Confirmed narrower gaps concern supported wording variants and the job's coordinated bare “modélisation” phrase. Process-only evidence could be omitted when the job named modeling within a Business Analysis clause without explicitly repeating “processus”. UML, functional specifications and requirements documents also require distinct treatment; their appearance must not be taken as universal equivalence.

A SQL-only profile correctly returns no Business Analysis evidence. Existing privacy/protected-information and negation guards can intentionally omit a whole reviewed field, including neighbouring positive statements. This phase preserves that behavior. No real candidate CV was supplied, so it cannot identify which of these conditions applied to the user's particular reviewed profile.

## Source and interpretation rules

Formatting-only clauses are filtered without rewriting the submitted job description. Meaningful technical syntax, punctuation-bearing names and paths remain eligible. Each retained evidence quote must still equal the original source substring at its Unicode character offsets. Trailing literal backslashes on meaningful clauses remain inspectable in the original quote.

Explicit minimum professional-experience wording can establish **required** in appropriate qualification context. Preferred wording, negation, quoted/conditional claims and technical-environment provenance remain separate controls. An arbitrary duration mention does not establish a mandatory qualification.

Business Analysis retrieval cites specific documented concepts and exact reviewed fields. Related statements remain unverified evidence for human inspection. A modeling or methodology mention does not establish mastery, complete coverage, seniority or role equivalence. UML alone does not prove functional-specification work; generic modeling does not automatically mean business-process modeling.

The five-year requirement can therefore be **required** while comparison remains **needs_review**. The service does not compute professional years or treat academic projects as employment. A missing excerpt describes the submitted documentation, not missing ability.

The implementation adds a source-preserving `meaningful_clause` check before line/requirement admission; exact `Required qualifications` heading support; a minimum-duration rule bound to adjacent experience wording or a standalone threshold; quotation/conditional and additional negation safeguards; and distinct UML/requirements-document aliases. Preferred section context is retained. Bare modeling is recognized only with Business Analysis context and an unqualified coordination boundary, so financial/statistical/3D/data modeling does not become process work.

## Before and after

The same fictional fixture ran against a frozen 22-file Phase 4.3 snapshot and the final code in isolated interpreters. The source snapshot and manifest are in `.artifacts/phase431-baseline`; detailed fictional output is in `.artifacts/phase431/reproduction.json`.

| Check | Before | After |
| --- | --- | --- |
| Meaningful qualification bullets | 6 | 6 |
| Extracted requirements | 7, including `req-007: \` | 6; no artifact row |
| Minimum five years | Unspecified | Required |
| Telecom-sector experience | Preferred | Preferred |
| Comparison of minimum five years | Needs review | Needs review |
| Positive Business Analysis excerpts | 3 exact excerpts | 4 exact excerpts |
| Negative Business Analysis excerpts | None; needs review | None; needs review |
| Job technologies | SQL, GCP, Teradata, Airflow | Same four canonical technologies |
| Original job text and source offsets | Exact | Exact |

The additional observed-clause excerpt is **“Modélisation des processus avec UML.”**, at field characters **145–181** in `experience.0.description` in the direct qualification fixture. PDF-derived reviewed fields can retain bullet prefixes and therefore have different exact offsets. It is retrieved because the job's coordinated Business Analysis wording establishes modeling context, not because UML alone proves process work. The complete reviewed field remains in `quote` and inspectable through the existing full-field disclosure. Existing recueil, needs-analysis and specifications excerpts remain.

Separate job/profile pairs now retrieve explicit `Analyse de besoins métier`, `UML` and `cahier des charges` statements when the job asks for their corresponding concepts. The negative tests retain distinctions between process modeling, UML, functional specifications and requirements documents. Meetings, dashboards, SQL and VoIP alone do not fabricate Business Analysis evidence.

## Regression safety and limitations

The existing Phase 4.3 evaluation corpus and SHA manifests remain unchanged. Its duration annotation deliberately retains the old `unspecified` label. A new evaluation output records any disagreement with the explicit Phase 4.3.1 policy rather than rewriting historical labels. The retained Chromium workflow asserts the new policy explicitly while still consuming the unchanged fictional source fixture.

The unchanged 16-case corpus still returns **48/48 technologies**, **36/39 expected evidence excerpts**, **41/60 segmentation assertions**, **43/46 status agreements**, **0/36 unsupported evidence**, and **6/6 privacy checks**. Job/candidate/overview citation and returned excerpt-boundary checks remain exact. Classification agreement changes **46/46 → 45/46** solely because the frozen five-year annotation remains `unspecified` while the corrected policy returns `required`. These small development fixtures do not establish representative real-world accuracy. Historical evaluation reports were preserved; the new report is `evaluation/comparison_final_accuracy_results.json`.

Rules remain deterministic and vocabulary-limited. Unsupported wording/layouts and mixed privacy/negation fields can require manual correction. Confirmations remain unverified session assertions rather than authenticated approval records. No new dependency, infrastructure service, LangGraph workflow, score, ranking or employment decision is introduced.

## Files

| Files | Purpose |
| --- | --- |
| `backend/app/services/jobs.py`, `job_formatting.py` | Clause admission, conservative classification and Business Analysis recognition where required |
| `backend/tests/test_final_job_accuracy.py`, `backend/tests/fixtures/job_final_accuracy.json` | Fictional copied-post and positive/negative evidence regressions |
| `frontend/src/test/comparisonResults.test.tsx` | Required job wording remains separate from uncertain candidate evidence |
| `frontend/e2e/final-job-accuracy-smoke.mjs`, `frontend/e2e/Dockerfile` | Real-API copied-post workflow and QA image inclusion |
| `frontend/e2e/real-world-comparison-smoke.mjs` | Intentional new duration policy checked without changing frozen annotations |
| `evaluation/comparison_final_accuracy_results.json` | Current-versus-Phase-4.3 results on unchanged annotations |
| `README.md`, this document | Findings, behavior and verification |

## Validation commands

From the project root:

```powershell
docker build --target test -t talentflow-ai-backend-test:local backend
docker run --rm talentflow-ai-backend-test:local
docker build --target test -t talentflow-ai-frontend-test:local frontend
docker run --rm talentflow-ai-frontend-test:local npm test
docker run --rm talentflow-ai-frontend-test:local npm run build
docker compose config --quiet
docker compose up -d --build
docker compose ps
docker build -t talentflow-ai-browser-test:local frontend/e2e
New-Item -ItemType Directory -Force -Path .artifacts/phase431 | Out-Null
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway -v "${PWD}\backend\tests\fixtures:/fixtures:ro" -v "${PWD}\.artifacts\phase431:/screenshots" -e SCREENSHOT_DIR=/screenshots talentflow-ai-browser-test:local node final-job-accuracy-smoke.mjs
```

The ordinary production build includes `tsc -b` with strict TypeScript enabled. The browser workflow uses real local APIs and generated fictional PDF bytes.

## Executed validation — 2026-10-15

- **580 backend tests passed** on Windows (9.81s) and in Linux Docker (8.64s), including **85 new focused regressions**. The existing Starlette/httpx deprecation warning remains; dependencies were not changed.
- **74 frontend tests passed** across seven files, including the new required-experience/uncertain-evidence display regression and all existing session, confirmation, selection, privacy, structured-422 and stale-result checks.
- **Strict TypeScript and Vite production build passed**, both directly in the frontend test image and through `docker compose up -d --build`. The final production JS/CSS assets match the existing interface; no production React component change was necessary.
- **All eight real-API Chromium scripts passed**: `smoke.mjs`, `accuracy-smoke.mjs`, `job-smoke.mjs`, `realistic-job-smoke.mjs`, `comparison-workflow-smoke.mjs`, `comparison-results-smoke.mjs`, `real-world-comparison-smoke.mjs` and the new `final-job-accuracy-smoke.mjs`.
- The new workflow passed on its first run with two generated fictional PDFs. It verified exactly six visible review rows, required minimum experience, preferred telecom experience, positive **four** exact Business Analysis excerpts, negative **zero** excerpts, four canonical technologies, source/CV Unicode offsets, full-field disclosure, qualification-only payloads, review gates, route retention, profile-edit invalidation, unique IDs, no browser storage and desktop/mobile operation. Native mouse and independent keyboard candidate selection also passed in the retained workflow, including awaiting-review profiles.
- The complete intended workflow passed: **Upload CV → Review and confirm → Select candidate → Analyze job → Review requirements → Compare evidence → Inspect results**.
- **Compose configuration validation and normal startup succeeded**. Frontend, backend and PostgreSQL are healthy. The original PostgreSQL container `35deac7994bf255ff1cd2a0181c4aaacd86cba1cc71d3af623f65df9c8f8192f` and volume `talentflow-ai_postgres_data` are preserved. No volume reset, data deletion, commit or push was performed.

Generated fictional desktop, expanded-evidence and 390px mobile screenshots were inspected with no horizontal overflow or clipping:

- [Desktop results](../.artifacts/phase431/final-job-accuracy-desktop.png)
- [Business Analysis evidence](../.artifacts/phase431/final-job-accuracy-expanded.png)
- [Mobile results](../.artifacts/phase431/final-job-accuracy-mobile.png)

The earlier limitations remain: unsupported internship role anchors/layouts, safe neighbouring statements omitted by whole-field privacy/negation guards, and the frozen telecom-status taxonomy discrepancy. Minimum-duration detection covers explicit supported numeric forms rather than every linguistic construction. Ambiguous wording still requires human review.
