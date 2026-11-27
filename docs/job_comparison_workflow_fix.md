# Job comparison workflow fix

The complete workflow now provides specific comparison blockers and handles the reproduced HTTP 422 failures without relaxing evidence, privacy or human review. Normal candidate confirmation/selection already updated immediately in React memory; neither a refresh nor changing environment classifications to Required is necessary.

## Reproduced root causes

1. **Inconsistent technology context during backend validation.** `Technical environment\napi / Python knowledge required` is analyzed with technical-section context. Explicit qualification wording makes its origin `qualification`, but comparison previously selected recognition context from that origin. Lowercase `api` then disappeared from the validated skill set, producing `422 unsupported_correction` despite no human edit. Unchanged text now uses the original skill proof after complete fresh source reanalysis/equality validation. Edited wording still must preserve the exact canonical source skill set, allowed words, category, privacy rules and review snapshots. The same untouched input now returns HTTP 200.
2. **Different CV-review and qualification-payload bounds.** A user can enter 101 comma-separated experience technologies within the existing 2,000-character review field limit and confirm the profile. CV review allows that list, while the purpose-limited comparison schema permits at most 100 items. Chromium reproduced an enabled button followed by HTTP 422 at both `candidate.experience.0.technologies` and `review.candidate_snapshot.experience.0.technologies`. Comparison now checks the actual projected lists first and names the record, count, limit and corrective action. Data is retained without truncation; general CV review remains unchanged. Correcting to 100 entries and reconfirming resumes comparison.
3. **Incomplete availability and error explanations.** The button used separate Boolean conditions and only explained missing candidate selection. Unchecked job review, blank wording, invalidated profile confirmation and payload bounds did not all have precise instructions. FastAPI validation arrays dropped field locations, producing duplicate generic messages. A single preflight function now controls both button availability and submission, and structured errors retain their paths without retaining rejected input values.

## Resulting workflow

- Upload one or more fictional CVs and open Job Analysis. Selection is available before profile review; no confirmation is added automatically.
- Choose any session profile from Candidate profile. Every uploaded profile is selectable, including Awaiting review profiles. Selecting an unconfirmed profile shows the exact review-required explanation and Review selected candidate action. Explicit confirmation updates the shared session, and returning preserves the same selection without refreshing. Comparison still requires a confirmed reviewed snapshot and the separate job requirement acknowledgment.
- Analyze the job, inspect its source and check the separate job requirement review acknowledgment.
- Compare evidence. Technical-environment rows can remain `unspecified`; their result is `needs_review`, with the original environment origin preserved.
- If comparison is unavailable, the Comparison availability panel names every missing step or incompatible field. Review selected profile links to the exact profile requiring correction.
- Saved profile changes invalidate confirmation/results; requirement changes clear job acknowledgment/results. Correct and reconfirm before retrying.
- A structured `source_mismatch` clears the invalid analysis/results and job review while retaining the pasted source and candidate selection. Analyze fresh source evidence and acknowledge the new job review before retrying. Stale/review-required assertions similarly require renewed review.

All comparison requests still contain only the qualification projection and matching review snapshots. Names, contact fields, employers, institutions, locations, dates and links remain excluded. Client confirmation is an unverified workflow assertion, not authenticated approval. Original-source equality, canonical technology/category support, protected/negated wording and snapshot checks remain active. No ranking, score, eligibility decision or employment recommendation is added.

## Files changed for this fix

| File | Change |
| --- | --- |
| `backend/app/services/jobs.py` | Correct source-context validation for unchanged and edited requirement labels |
| `backend/tests/test_comparison_workflow.py` | 23 source/context/review/privacy/payload-bound regressions |
| `frontend/src/comparison.ts` | Central comparison gates and qualification-only list preflight |
| `frontend/src/pages/JobAnalysis.tsx` | Actionable availability, consistent submit gate and structured source/review recovery |
| `frontend/src/api.ts` | Preserve safe validation paths/messages in `ApiError.validationIssues` |
| `frontend/src/components/ReviewProfile.tsx` | Confirmed-profile continuation link and accurate workflow message |
| `frontend/src/jobAnalysis.css` | Readable, responsive availability panel |
| `frontend/src/test/api.test.ts` | Validation paths, safe malformed errors and omission of rejected input values |
| `frontend/src/test/comparisonWorkflow.test.tsx` | Nine real-provider/router integration regressions |
| `frontend/e2e/comparison-workflow-smoke.mjs` | Live Chromium workflow and both reproduced failures |
| `frontend/e2e/Dockerfile` | Include the new browser script |
| `README.md`, `docs/job_analysis_architecture.md`, this document | Workflow diagnosis and actual verification |

Candidate/session providers, extraction services, dictionaries, schemas, dependency manifests and Compose configurations are unchanged by this fix. Earlier evaluation artifacts remain historical Phase 4/4.1 measurements and fingerprints, rather than being rewritten for this later comparison validation change.

## Executed verification

- **400 backend tests passed** on Windows and in the Linux Docker test image, retaining all previous 377 tests and adding 23 regressions. One existing Starlette TestClient/httpx deprecation warning remains.
- **51 frontend tests passed**, retaining all previous 40 plus nine routed workflow regressions and two API-error cases. Strict TypeScript and the Vite production build passed. Two unsupported Testing Library query options in the new tests were caught by compilation and corrected before the successful build.
- **All five Chromium scripts passed:** original CV review, dense CV accuracy/mobile, original job comparison, realistic job posts and the new comparison workflow. The new check uses real uploads/API responses and verifies immediate confirmation/selection, missing-step messages, environment-only unspecified → needs_review, profile-edit invalidation, oversized-list blocking without an API call, correction/reconfirmation without truncation, qualification-only snapshots, the former context-related 422 now 200, mobile wrapping and no browser storage.
- The exact startup command **`docker compose up -d --build` succeeded**. Frontend, backend and PostgreSQL report healthy. The original PostgreSQL container and `talentflow-ai_postgres_data` volume are preserved.
- No data deletion, new service/dependency, authentication/database integration, commit or push was performed.

After normal startup, reproduce browser verification from the project root:

```powershell
docker build -t talentflow-ai-browser-test:local frontend/e2e
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway talentflow-ai-browser-test:local node comparison-workflow-smoke.mjs
```

The comparison API still rejects direct oversized/unreviewed/stale/tampered payloads. The frontend preflight is a user-facing consistency check and does not replace server validation. Profiles and outputs remain memory-only and disappear on refresh/clear; reviews still need human interpretation and do not verify qualification truth.

## Disabled-button investigation — 2026-10-14

The current application does not reproduce a stuck button when the complete workflow is followed. A live Chromium check completed real fictional uploads, profile confirmation, route navigation, candidate selection, environment-only analysis, job review and comparison before further changes. Confirmation and selection remain in the providers above the routed pages; they are not lost on ordinary React navigation. A refresh intentionally clears this memory-only session.

Candidate confirmation and job requirement review are separate acknowledgments. A confirmed profile still needs explicit selection in Job Analysis. Saving profile corrections revokes its confirmation; editing requirements revokes the job acknowledgment. These are required review gates, not backend failures. The user's particular remaining blocker cannot be identified without the displayed availability message; no new state-management or server-validation failure was reproduced in this investigation.

`comparisonBlockers` is the shared source for the button's disabled state and its submit guard. Every disabling condition is:

| Condition | Required action |
| --- | --- |
| Analysis or comparison request pending | Wait for completion |
| No session profiles | Upload, review and confirm a CV |
| No candidate selected | Select a confirmed profile in Candidate profile |
| No confirmed profile available | Use its Awaiting review action, review and confirm |
| Selected ID no longer exists | Select another session profile |
| Selected profile unconfirmed or lacks a reviewed snapshot | Review and confirm its current fields |
| Any qualification collection exceeds 100 items | Correct the named collection and reconfirm |
| Any experience/project technology list exceeds 100 items | Correct the named record and reconfirm |
| No current job analysis | Analyze the job description |
| No supported requirements or environment mentions | Review the source and analyze again |
| Any requirement wording is blank | Restore the named requirement's supported wording |
| Job review acknowledgment unchecked | Review the job wording, classifications and evidence, then check the acknowledgment |

Unspecified classifications, technical-environment origin, extraction notes and absence of explicit mandatory qualifications do not themselves disable comparison. Environment-only results remain `needs_review`; the interface does not promote them to mandatory qualifications. Source edits clear analysis and job review, so comparison requires fresh analysis/review. API source or review rejection similarly invalidates the affected state before retrying.

This investigation moves the existing exact missing-step panel into the same accessible group as the job checkbox and Compare evidence button. The checkbox now explains that candidate confirmation does not complete job review, and its handler captures the checked value before queuing the state update. All existing review, evidence, privacy and payload checks remain unchanged.

Files changed in this investigation: `frontend/src/pages/JobAnalysis.tsx`, `frontend/src/test/jobAnalysis.test.tsx`, `frontend/e2e/comparison-workflow-smoke.mjs`, and this document. Session providers, backend code, schemas and Compose configuration are unchanged.

Actual verification on 2026-10-14:

- All **400 backend tests passed**, with the existing Starlette/httpx deprecation warning. Additional full FastAPI analyze/review/compare probes passed for **24/24 fictional job fixtures**.
- All **58 frontend tests passed**. Four added regressions cover StrictMode acknowledgment toggling, reviewing a job before selecting a candidate, switching confirmed profiles with fresh evidence snapshots, and pending comparison completion. The adjacent availability panel and accessible checkbox explanation are also asserted. Strict TypeScript and the production build passed.
- **All five Chromium scripts passed** against the rebuilt Compose app: CV review, dense CV accuracy, job comparison, realistic job descriptions and comparison workflow. The expanded comparison check verifies two awaiting profiles, a mixed awaiting/confirmed list, checkbox check/uncheck/recheck, confirmation/selection/job-review retention across routes, environment-only HTTP 200 with `needs_review`, edit invalidation and privacy checks. The two fixture-based scripts initially failed to start because `/fixtures` was not mounted; both passed after mounting `backend/tests/fixtures` read-only, without application changes.
- **`docker compose up -d --build` succeeded**, configuration validation passed, and all three services are healthy. The original PostgreSQL container and `talentflow-ai_postgres_data` volume are preserved. No commit or push was made.

## Earlier confirmed-only selection verification — 2026-10-15

This section records the earlier confirmed-only requirement. The subsequent all-profile selection fix below supersedes that picker behavior; its original validation results remain historical.

Inspected the complete final `JobAnalysis.tsx`, session providers, confirmation editor and the JavaScript actually served at `http://127.0.0.1:5173`. The current source and a fresh Chromium session already exclude awaiting profiles from the native dropdown. No duplicate TalentFlow instance, cached response or service worker was found; an older already-open tab was not available to inspect, so its behavior is not attributed to a proven cause.

The final picker contains a placeholder plus confirmed profiles with reviewed snapshots. Awaiting profiles are separate cards, each linking to its own profile review. Selection now also rejects unavailable/unconfirmed IDs and changes during pending requests. The confirmed status markup no longer contains an unreachable review-required branch. Explicit confirmation updates the shared provider immediately; returning through Continue to Job Analysis needs no refresh and does not automatically confirm or select any other profile.

Comparison availability now has one JSX definition and one render location. The review acknowledgment and comparison actions surround that section when requirements are displayed. The section renders once in source/requirements views and is absent in results. DOM checks cover all control IDs and accessibility references through source, requirements, results, route return, reset and empty extraction.

Changes in this pass: `frontend/src/pages/JobAnalysis.tsx`, `frontend/src/test/jobAnalysis.test.tsx`, `frontend/src/test/comparisonWorkflow.test.tsx`, `frontend/e2e/job-smoke.mjs`, and this document. Backend code, session providers, privacy projection, human-review checks, dependency manifests and Docker configuration remain unchanged.

Executed verification:

- **60/60 frontend tests passed**, including three fictional awaiting profiles, each profile's correct review link and confirmation, immediate confirmed-only selection, and the complete workflow under React StrictMode.
- **Strict TypeScript checks and production build passed**. The rebuilt Compose app serves `index-B5jP3B_B.js`.
- **All five Chromium workflows passed** using fictional data. The job workflow uses native keyboard selection and explicitly passes **Upload CV → Review → Confirm → Select candidate → Analyze job → Review requirements → Compare evidence → Results**. It verifies single availability rendering, unique IDs, edit invalidation and privacy snapshots. Environment-only comparison also passed separately with `needs_review` results. One new browser assertion initially ran before React navigation completed; waiting for the destination controls resolved the test timing failure, with no application change.
- **`docker compose up -d --build` succeeded**. Frontend, backend and PostgreSQL are healthy, and the original PostgreSQL container/volume remain intact. No commit or push was made.

## All-profile native dropdown — final requirement, 2026-10-15

The clarified requirement allows selecting any uploaded session profile before its review. The preceding confirmed-only implementation tied selection to comparison eligibility in four places: it filtered option data to confirmed snapshots, disabled the whole select when none were confirmed, rejected unconfirmed IDs in the change handler, and forced the controlled value to blank when the selected profile was not ready for comparison. Together these prevented a normal selection even though selecting a profile should not approve it.

The native select now maps every session profile, leaves each candidate option enabled and labels it Awaiting review or Confirmed review. The controlled value follows the selected session ID independently of confirmation. The selection handler accepts any existing session ID while retaining request-pending and unavailable-ID safeguards. No uploaded profiles means No candidates available with a link to the CV upload page. The browser's native arrow, popup, mouse and keyboard behavior are retained.

Selecting an unconfirmed candidate shows **This candidate must be reviewed and confirmed before comparison.** and **Review selected candidate**, which opens the exact selected profile. Confirmation updates the existing shared provider; returning retains the same selection, job source, analysis and job review. Saving profile edits retains the selection but revokes profile confirmation and previous results. Switching candidates also invalidates old results. The supplementary Awaiting review cards remain available without restricting dropdown selection.

Comparison still requires the selected confirmed snapshot and a separate job requirement acknowledgment. Its qualification-only projection, privacy limits, source evidence, server validation and environment-only `needs_review` semantics remain unchanged. No backend, session-provider, schema, dependency-manifest or Compose changes are required.

Files modified in this pass:

| Files | Purpose |
| --- | --- |
| `frontend/src/pages/JobAnalysis.tsx`, `frontend/src/comparison.ts` | All-profile native selection, persistent controlled value, selected review action and unchanged comparison gates |
| `frontend/src/test/jobAnalysis.test.tsx`, `frontend/src/test/comparisonWorkflow.test.tsx`, `frontend/src/test/workflow.test.tsx` | Updated all-profile/awaiting selection, three fictional reviewed snapshots, separate confirmations, route retention, invalidation and empty-state regressions |
| `frontend/e2e/job-smoke.mjs`, `frontend/e2e/realistic-job-smoke.mjs`, `frontend/e2e/comparison-workflow-smoke.mjs` | Updated real browser workflow assertions for selection before review |
| `frontend/e2e/native-select.mjs`, `frontend/e2e/Dockerfile` | Native popup mouse interaction using existing Xvfb/XTest libraries in the optional browser QA image |
| `README.md`, `docs/job_analysis_architecture.md`, this document | Correct current selection workflow and actual verification |

Executed verification for the all-profile fix:

- **60/60 frontend tests passed** across six files. Existing tests were updated to the clarified behavior, including three awaiting profiles each selected before review, correct profile navigation, explicit confirmation, preserved selection/source/job review, real-provider snapshot construction, unconfirmed comparison blocking and stale-result invalidation. Strict TypeScript (`strict: true`, `tsc -b`) and the Vite production build passed.
- **400/400 backend tests passed** in 26.76 seconds. The one existing Starlette/httpx deprecation warning remains. No backend code was changed.
- **All five Chromium workflows passed** against the rebuilt application: CV review, dense CV accuracy, job comparison, realistic job descriptions and the full comparison workflow. The realistic script's first run read the option count before React navigation completed; waiting for the destination heading fixed the browser-test timing issue. No application change was needed for that failure.
- **Native mouse interaction passed in headed Chromium**: a real arrow click opened an OS-native option popup, hovering/clicking selected Casey Fictional (`profile-2`), and a second mouse interaction selected Jordan Fictional (`profile-1`). Each generated a trusted native change event and updated React selection. Independent keyboard changes also passed. These checks use XTest input in a container's virtual display, rather than setting DOM values or relying on `selectOption()`.
- The same headed workflow checked the job acknowledgment while the profile remained unconfirmed: Compare evidence stayed disabled and sent zero comparison requests. After profile confirmation and job review, the real API returned HTTP 200 with `needs_review` environment results and matching qualification-only snapshots. Profile-edit invalidation, oversized-list correction, source-context validation, mobile wrapping and absence of browser storage also passed.
- **`docker compose up -d --build` succeeded**. The final all-profile app serves `index-CVQHZd24.js`. Frontend, backend and PostgreSQL are healthy; the original PostgreSQL container and `talentflow-ai_postgres_data` volume remain intact. There are no added application dependencies, data deletions, commits or pushes.

The complete validated workflow is **Upload CV → Select any candidate → Review → Confirm → Return with the same selection → Analyze/retain job → Review requirements → Compare evidence → Results**.

Reproduce the native mouse workflow after normal Compose startup:

```powershell
docker build -t talentflow-ai-browser-test:local frontend/e2e
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway -e NATIVE_MOUSE=1 talentflow-ai-browser-test:local node comparison-workflow-smoke.mjs
```

The optional QA script starts its own Xvfb display and closes it after the browser check; it does not open a window on the user's desktop or alter application startup. Fixture-based accuracy/realistic checks additionally require a read-only mount of `backend/tests/fixtures` at `/fixtures`.
