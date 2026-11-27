# Changelog

Detailed delivery history and the validation recorded at each milestone. The [README](../README.md) describes the current state.
Milestone tags: `v0.5.0` (phases 1–5), `v0.6.0` (tooling, CI and hardening), `v0.7.0` (UI redesign) and `v0.8.0` (accounts and roles).

## Candidate space — v0.9.0 (phase 7, branch `feat/v1-phase7`, not merged)

Second phase of the v1 platform. Details: [candidate_space_phase7.md](candidate_space_phase7.md).

- **Encrypted CV storage:** each upload creates a new CV version and never overwrites an older one. Only ciphertext is stored (extracted text, parsing result and reviewed profile), sealed with AES-256-GCM under a per-version data key; the data key is wrapped by the master key `TALENTFLOW_DATA_KEY`, read from the environment only. Deleting the key shreds the version. The original PDF is **off by default** (`CV_ORIGINAL_STORAGE=disabled`); when an instance enables it, the candidate opts in per upload and the file is encrypted the same way.
- **Review and history:** the current version is reviewed and confirmed (any edit clears the confirmation); older versions stay readable but locked; a field-by-field diff compares two versions.
- **Job posts and coverage:** pasted job posts stay private, are analyzed by the existing deterministic analyzer and their criteria are reviewed with the demo’s correction rules. The coverage report runs `compare_job` on the qualification-only projection, only after both reviews, and shows « x/y requis · a/b souhaités · n à interpréter » with each number filtering the side-by-side evidence. Gaps are fixed sentences with a link to the matching CV section; nothing is generated in the candidate’s place.
- **Visibility, export and deletion:** recruiter visibility stays an opt-in consent withdrawn immediately; `GET /api/v2/me/export` returns every personal datum (decrypted CVs included); account deletion removes rows, data keys and files, and the worker sweeps orphan files.
- **Isolation:** another candidate’s version or job post answers 404, exactly like an unknown identifier; no recruiter route exposes a candidate profile, with or without the opt-in. Migration `0002` is reversible.

Actual validation: **849 backend tests** (769 existing + 80 for the candidate space, against PostgreSQL), **109 frontend tests**, ruff, ESLint, strict TypeScript, migrations `upgrade`/`downgrade`/`upgrade` + `alembic check`, and **twelve real-API Chromium workflows** (the eleven existing ones plus `candidate-smoke.mjs`) against the rebuilt Compose stack.

## Accounts and roles — v0.8.0 (phase 6, merged and tagged)

First phase of the v1 platform described in [V1_DESIGN.md](V1_DESIGN.md). Details: [accounts_phase6.md](accounts_phase6.md).

- **PostgreSQL is required:** SQLAlchemy 2 (sync, psycopg 3) and reversible Alembic migrations (`0001`: users, sessions, e-mail tokens, consents, organizations, memberships, append-only audit log). Compose runs `db`, a one-shot `migrate`, `backend`, a `worker` (retention housekeeping), `mailpit` (local e-mail, no external provider) and `frontend`.
- **Accounts (`/api/v2`):** sign-up with a role (candidate or recruiter), e-mail verification, sign-in, sign-out, password reset, versioned and withdrawable consents, account deletion with re-authentication. argon2id passwords, server-side sessions in an `HttpOnly`/`SameSite=Lax` cookie (`__Host-` and `Secure` by default), signed double-submit CSRF tokens bound to the session, per-account and per-client rate limits, no account enumeration, pseudonymous audit log.
- **Isolation:** role checks answer 403; another organization's resources answer 404. A generated authorization matrix covers every published `/api/v2` operation.
- **Public pages (FR default, EN):** home with the permanent demo warning (Morocco only), role choice, sign-up, verification, sign-in, password reset, terms and privacy, and the candidate and recruiter spaces. i18next; logical CSS properties for the future RTL interface.
- **Unchanged:** `/api/v1` and demo mode work without an account; the workbench never calls `/api/v2`.
- **Hardening:** strict Content-Security-Policy on the frontend (the theme initializer moved to `/theme-init.js`), `X-Frame-Options`, `Permissions-Policy`, `no-store` and `no-referrer` on `/api/v2`.

Actual validation: **769 backend tests** (681 existing + 88 for accounts, against PostgreSQL), **103 frontend tests** (in the Node 22 image), ruff, ESLint, strict TypeScript, migrations `upgrade`/`downgrade`/`upgrade` + `alembic check`, and **eleven real-API Chromium workflows** (the ten existing ones plus `auth-smoke.mjs`) against the rebuilt Compose stack.

## UI redesign — v0.7.0

- **Design system:** a single token file (colour, type scale, spacing, radii, shadows, motion), warm-paper light and deep-slate dark themes with AA contrast, self-hosted fonts, and primitives (Button, Card, Badge, StatusPill, Stepper, EmptyState, Skeleton). Legacy colour literals and pixel font sizes were mapped to tokens; the minimum text size is now 12px (mono labels), 13px for secondary text and 14–15px for body text.
- **Guided shell:** editorial sidebar, sticky header with a six-step workflow stepper derived from session state (it never bypasses a review gate), theme toggle and Settings appearance control, soft page transitions, discreet toasts and skeletons instead of spinners.
- **Dashboard and demo mode:** product home with session state, path shortcuts and principles. **Try with fictional data** builds a fictional CV PDF (invented name, `example.com`) and a sample job in the browser, parses it through the normal API and opens the profile for mandatory human review. Nothing is stored.
- **Side-by-side evidence:** the job clause and the CV excerpt are shown next to each other with exact spans highlighted from code-point offsets, a mono `chars a–b` badge and a status bridge. “Not documented” is a neutral absence. Applies to Job Analysis and to AI Agents results.
- **Living LangGraph view:** seven connected nodes driven by backend statuses; `human_review` pulses while paused and edges fill in sequence after resume. The accessible step list is kept.
- **Refactor:** `JobAnalysis.tsx` split into sub-components (JSX moved verbatim); `App.tsx` pages already split in v0.6.0.
- **CI:** now runs on every branch push as well as pull requests.

Actual validation: **681 backend tests**, **93 frontend tests** (including demo mode), ruff, ESLint, strict TypeScript, Vite build and **all ten real-API Chromium workflows** (the nine existing ones plus `demo-smoke.mjs`) passed against the rebuilt Compose stack. No accessible name, label or tested text changed.

## Tooling, CI and hardening — v0.6.0

- **Lint:** `ruff check app tests *.py` in `backend/` (rules E/F/I/B/UP, `backend/ruff.toml`; dev tools in `backend/requirements-dev.txt`) and `npm run lint` in `frontend/` (ESLint flat config with typescript-eslint and React hooks rules).
- **CI:** `.github/workflows/ci.yml` runs on pushes and pull requests to `main`: backend (lock-constrained install, ruff, pytest), frontend (Node 22: lint, tsc, vitest, build) and Compose configuration validation. It uses no secrets and deploys nothing.
- **Local API boundary:** every `/api/v1` route rejects non-local `Host` or `Origin` headers (403) and bounds JSON bodies to 1 MiB before parsing. CV uploads keep the 5 MiB / 10-page limits; agent workflows keep their 512 KiB limit.
- **Agents:** `testserver` is no longer an allowed runtime host; graph execution no longer runs under the workflow registry lock, so a slow workflow cannot block other starts; cancelling a blocked or failed workflow keeps its original error. `/review` and `/report` are documented API-only routes.
- **Compose:** PostgreSQL is an optional `db` profile; `docker compose up -d --build` starts only the frontend and API.
- **Frontend:** `App.tsx` was split into page modules without behaviour changes.

Actual validation: **681 backend tests**, **90 frontend tests**, ruff, ESLint, strict TypeScript and the Vite production build passed on Windows. `docker compose up -d --build --wait` started healthy frontend and backend services, and **all nine real-API Chromium workflows** passed.

## Local evidence orchestration — Phase 5

Open **AI Agents** at http://localhost:5173/agents after reviewing a candidate and job in Job Analysis. Start an evidence workflow to execute real LangGraph nodes: intake validation, candidate preparation, job preparation, existing deterministic comparison, evidence verification, human review and final report. Execution pauses at an actual LangGraph `interrupt`; inspect the evidence, explicitly acknowledge the local review assertion and select **Review & Resume**. Supported `Command(resume=...)` continues the checkpoint and verifies evidence again before finalization. Status/report reads do not rerun nodes.

The workspace reuses current React session reviews and qualification-only payloads. Candidate/job edits invalidate old evidence and acknowledgment. Actual backend steps, blocked/failed errors, cancellation/expiry and the existing Technical Evidence Overview remain inspectable. No model, ranking, proficiency inference or hiring recommendation is added. LangGraph does not automatically improve CV extraction accuracy.

Workflows use separate memory checkpointers, 30-minute TTL, a maximum of 32 retained workflows, bounded retries/timeouts and a random 256-bit browser capability. Input/checkpoints are deleted on terminal states; a completed evidence report can remain until TTL/capacity cleanup. Backend restart loses workflows; browser refresh loses candidate/review state and the capability. Nothing is persisted to PostgreSQL or browser storage. Keep the existing loopback-only deployment: there is no authenticated multi-user access or durable approval history.

Versioned routes are under `/api/v1/agents/workflows`: start, status, review, resume, cancel and report. All require `X-Workflow-Session`; the server verifies ownership, original snapshots, source spans, qualification fields and canonical technical references. Requests are bounded before JSON parsing; validation errors do not echo submitted text. No external provider or tracing export occurs during graph execution.

Actual validation: **649 backend tests** passed on Windows and Linux Docker, **90 frontend tests** passed, strict TypeScript and the Vite production build passed, and **all nine real-API Chromium workflows** passed. The new graph workflow passed on desktop/mobile with genuine interrupt/resume, source inspection, stale-review invalidation, cancellation and ownership checks. The exact `docker compose up -d --build` succeeded with all three services healthy and the original PostgreSQL container/volume preserved. Browser testing also fixed a UUID compatibility issue on the local Docker HTTP address.

See [agent workflow testing](agent_workflow_testing.md) for actual results, commands and screenshots, and [LangGraph architecture](langgraph_architecture.md) for actual transitions, schemas, routes, retention, setup and limitations.

## Copied-post and qualification fixes — Phase 4.3.1

Formatting-only copied text no longer becomes a requirement. The French Data Business Analyst reproduction now yields **six requirements instead of seven**, preserving original backslashes, evidence quotes and offsets on meaningful lines. Explicit minimum experience is **required**, while the candidate comparison remains **needs_review**; preferred, conditional, quoted, negated and technical-environment contexts retain separate handling.

Business Analysis retrieval adds precise wording and coordinated modeling support while keeping UML, process modeling, functional specifications and requirements documents distinct. The positive fictional profile returns **four exact excerpts instead of three**; the negative profile returns none. SQL, GCP, Teradata and Airflow remain recognized. Privacy filters, human confirmation and session behavior are preserved.

Actual validation: **580 backend tests** passed on Windows and Linux Docker; **74 frontend tests**, strict TypeScript/Vite builds and **all eight real-API Chromium workflows** passed. Compose startup and all service healthchecks passed with the existing PostgreSQL container/volume preserved. See [final job accuracy fixes](job_analysis_final_accuracy_fixes.md) for root causes, files, before/after results, immutable evaluation-label differences and remaining limitations.

## Source-grounded comparison accuracy — Phase 4.3

The French Data Business Analyst example now extracts **SQL, GCP, Teradata and Airflow**, including parenthesized/slash-separated technical stacks. Job-only aliases preserve cloud/database/tool distinctions, original classifications and environment provenance. Explicit business-analysis statements are retrieved without claiming mastery. Professional duration and telecom-sector employment are not inferred from projects, dates, networking or VoIP.

Comparison evidence now includes optional exact excerpt offsets while retaining the full reviewed field for compatibility. Results show concise supporting text with **View full reviewed field**, collapsed metadata/notes and responsive evidence layouts. Shared CV boundary detection now recognizes explicit academic/university project headings and English Business Analyst entries, keeping their descriptions, dates and technologies separate.

On **16 fictional cases annotated and SHA-frozen before tuning**, technology recall improved **29/48 → 48/48**, evidence recall **29/39 → 36/39**, concise excerpt boundaries **18/30 → 36/36**, unsupported evidence **1/30 → 0/36**, and CV segmentation assertions **11/60 → 41/60**. These are development measurements, not representative real-world accuracy. Unsupported internship titles, conservative whole-field privacy/negation filtering and a frozen sector-status taxonomy disagreement remain documented.

Actual validation: **495 backend tests** passed on Windows and Linux Docker; **73 frontend tests**, strict TypeScript/Vite build and **all seven real-API Chromium workflows** passed. Normal Compose startup remains working with the existing PostgreSQL container/volume preserved. See [real-world comparison accuracy](real_world_comparison_accuracy.md) for the complete file inventory, exact before/after metrics, source contract, browser verification and limitations.

## Compact comparison results — Phase 4.2

Comparison results now open with dynamic evidence-status counts and a **Technical Evidence Overview**. Canonical technologies appear once under **Mentioned in both documents** or **No supporting mention found in the reviewed CV**, with expandable job excerpts, immutable source offsets and unverified reviewed-CV field references. **Requires interpretation** keeps ambiguous source clauses visible without treating an environment list as a mandatory qualification.

Requirement cards start collapsed and retain the original evidence, reviewed labels, interpretation notes and warnings behind accessible controls. Status filters and expand/collapse controls operate locally, without another API request. Both candidate selection before review and the separate candidate/job confirmation gates remain intact. The backend adds a backward-compatible `technical_evidence` response field; comparison inputs and qualification-status semantics are unchanged. There are no similarity scores, rankings or employment recommendations.

Actual Phase 4.2 validation: **429 backend tests**, **69 frontend tests**, strict TypeScript/Vite build and **all six Chromium workflows** passed. Compose configuration/startup passed with all services healthy and the original PostgreSQL volume preserved. See [comparison results UX](comparison_results_ux.md) for the contract, canonical aggregation, current limitations, testing commands and desktop/mobile screenshots.

## Realistic job-post extraction — Phase 4.1

Job Analysis now recognizes Environnement technique, Technical Environment, Technology/Tech Stack, Tools and Technologies and additional French/English profile/preference headings, including copied-post emoji/punctuation. Technical environment mentions appear separately from Required/Preferred/Unspecified qualifications. They retain unspecified source status and always require human interpretation during comparison, even after a classification edit. Application contacts, hashtags, company prose and generic responsibilities do not become candidate requirements.

Inline arrows, pipes and labels extract location, contract and work mode independently, with exact source evidence and detailed schedule excerpts. For the fictional AI Architect example, **Rabat/Technopolis**, **CDI** and **Hybrid** are separate fields; six environment rows contain **18 distinct technologies**, without invented mandatory qualifications. Job-only normalization keeps Azure OpenAI, Azure AI, Azure, OpenAI, AI, Machine Learning, LLMs, RAG and API/REST APIs distinct. The existing CV vocabulary and parser behavior are preserved.

Actual validation: **377 backend tests** passed on Windows and Docker; **40 frontend tests**, strict TypeScript/Vite builds and **all four Chromium workflows** passed. Normal Compose startup and all three service healthchecks passed, preserving the existing PostgreSQL container/volume. Direct and proxied Job Analysis APIs and Swagger remain available.

On the unchanged **14 fictional realistic posts**, technology recall improved **19/87 → 87/87**, classification **12/38 → 38/38**, explicit metadata **31/43 → 43/43**, and unsupported rows **14/27 → 0/38**. A frozen baseline runs in an isolated interpreter, with source hashes recorded. These development regressions are not representative real-world accuracy. From `backend/`:

```powershell
.\.venv\Scripts\python.exe evaluate_jobs_realistic.py --baseline-root ../.artifacts/phase41-baseline --output ../evaluation/job_realistic_results.json --example-output ../evaluation/fictional_ai_architect_output.json
```

Omit `--baseline-root` when the preserved local snapshot is unavailable. The Docker test image includes the current-only evaluator. See [job accuracy](job_analysis_accuracy.md) for the complete file inventory, baseline methodology, metrics, example JSON, known limitations and browser commands; [job analysis architecture](job_analysis_architecture.md) documents the additive API fields and review boundaries.

Comparison workflow fixes retain the reviewed-profile and evidence gates while adding an exact **Comparison availability** checklist. Every session profile is selectable in the native dropdown, including Awaiting review profiles; selection does not approve comparison. Review selected candidate opens the correct profile, and confirmation preserves the same selection on return without refreshing. Comparison requires both candidate confirmation and the separate job review. Oversized qualification lists are identified before submission without truncation. Structured validation errors identify the field to correct, and outdated source analysis prompts fresh analysis/review. The false HTTP 422 caused by inconsistent acronym context is fixed. The initial comparison fix passed **400 backend tests**, **51 frontend tests**, the strict production build and **five Chromium workflows**. See [comparison workflow fix](job_comparison_workflow_fix.md) for current selection behavior, subsequent test results and verification commands.

## Job analysis and evidence comparison — Phase 4

Open **Job Analysis** at http://localhost:5173/matching. Select any uploaded candidate, including Awaiting review profiles. If needed, follow **Review selected candidate**, review and explicitly confirm the profile, then return with the same selection. Paste a French/English job description, analyze the real source, inspect required/preferred/unspecified groups, correct labels, acknowledge requirement review and select **Compare evidence**. Both reviews are required for comparison. The results show documented, not documented and needs human review sections with explanations and source excerpts. Original extraction and corrections remain separate. Changes to qualifications, confirmation, source or requirements invalidate previous results; refresh/clearing removes session data. The same reviewed documents can now be reused in the Phase 5 AI Agents workflow.

The new API endpoints are `POST /api/v1/jobs/analyze`, `POST /api/v1/jobs/compare` and `GET /api/v1/jobs/capabilities`. Comparison accepts qualification-only snapshots and validates source/evidence and current review snapshots. Names, contact fields, employers, institutions, locations, dates and links are excluded. Free-text qualification descriptions still require human privacy review. Confirmations are unverified workflow assertions, without authentication or durable approval records. No ranking, suitability scores, eligibility or employment recommendations are produced.

Actual Phase 4 validation: **225 backend tests** passed on Windows and Docker, **33 frontend tests** passed, strict TypeScript/Vite builds passed, and all three real Chromium workflows passed. The normal `docker compose up -d --build` succeeded; all three services are healthy and the existing PostgreSQL container/volume is preserved. Frontend, SPA route, Swagger, health and proxied job APIs returned HTTP 200.

Ten independently annotated fictional jobs matched **33/33 skills** for precision and recall, **37/37 explicit classifications**, **39/39 source evidence and statuses**, and **0/39 unsupported requirements**. These small development fixtures are not a real-world accuracy estimate. Existing CV evaluations still match 202/202 multilingual fields and 176/176 accuracy fields. Run from `backend/`:

```powershell
.\.venv\Scripts\python.exe evaluate_jobs.py --output ../evaluation/job_analysis_results.json
```

For Chromium after startup, run `docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway talentflow-ai-browser-test:local node job-smoke.mjs` after rebuilding `frontend/e2e`. See [job analysis architecture](job_analysis_architecture.md) for the complete file inventory, API shapes, privacy/review boundaries, evaluation methodology, initial/final artifacts, executed validation and known limitations.

## Multilingual CV parsing — Phases 3.5 and 3.6

Phase 3.6 validation: **141 backend tests** and **21 frontend tests**, strict TypeScript/production build and real Chromium upload/review checks. The normal Docker command and PostgreSQL volume were preserved. No external model was called during testing.

Phase 3.5 validation: **108 backend tests passed**, including all 60 original tests; Phase 3.5 frontend validation: **18 tests passed**, strict TypeScript and production build passed. Real Chromium tests passed English/two-column French upload, source evidence, corrections/removal/confirmation, navigation and session clearing. Provider tests use mocks; no live external model was called.

Earlier phase details (1 to 3.6) are described in [CV accuracy refinement](cv_accuracy_refinement.md), [multilingual parsing](multilingual_cv_parsing.md), [phase 3 delivery](phase3_delivery.md) and [Docker architecture](docker_architecture.md).
