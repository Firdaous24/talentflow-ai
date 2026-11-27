# TalentFlow AI

TalentFlow AI is a recruitment intelligence portfolio project with local French/English CV extraction, reviewed job requirements and a transparent qualification-evidence checklist. A local LangGraph workflow orchestrates the existing evidence services with an explicit human review checkpoint. Optional CV model assistance requires consent.

## Current status

**Phases 1 through 5 are implemented:** backend foundation, Docker infrastructure, React workspace, layout-aware French/English CV parsing, source evidence, human review, deterministic job analysis and document comparison, technical-environment provenance, compact evidence results, source-bound excerpts and bounded LangGraph orchestration. Optional CV model extraction requires backend configuration and per-upload consent; job analysis and the graph require no AI credentials. Phase 5 validation is recorded below.

Implemented:

- Modular, typed FastAPI backend, version `0.1.0`.
- Service information at `GET /` and liveness at `GET /api/v1/health`.
- Swagger documentation at `/docs` and OpenAPI schema at `/openapi.json`.
- Browser CORS access restricted to `http://localhost:5173` for GET and POST requests.
- PDF ingestion at `POST /api/v1/candidates/parse` (multipart field `file`).
- PyMuPDF structure checks, 5 MiB file limit, 10-page limit, and rejection of damaged, encrypted, and textless PDFs.
- Pydantic v2 candidate schemas and deterministic extraction with explicit warnings.
- Six fictional CV scenarios with PDFs generated in memory during tests.
- Automated endpoint, PDF service, extraction, schema, upload-limit, and CORS tests.
- Docker Compose workflow with a non-root backend, dedicated test image, and an optional internal PostgreSQL service (`db` profile).
- Responsive React interface with Dashboard, CV Parser, Candidates, and application information pages.
- Layout-aware French/English section and entry extraction, expanded skill vocabulary and source evidence.
- In-memory corrections/removal and explicit reviewed-profile confirmation.
- Optional provider abstraction with structured outputs, evidence rejection and local fallback; no external calls without per-upload consent.
- Typed API client, local PDF validation, structured backend errors, extraction warnings, and temporary candidate profiles.
- Frontend production image with a same-origin Nginx API proxy and React Router fallback.
- French/English job analysis at `POST /api/v1/jobs/analyze`, qualification comparison at `POST /api/v1/jobs/compare`, and public limitations at `GET /api/v1/jobs/capabilities`.
- Reviewed original/corrected requirements, exact job excerpts, qualification-only candidate snapshots and in-memory evidence results at **Job Analysis** (`/matching`).
- Documented, not documented and needs review statuses with explanations; no candidate scores, rankings, eligibility decisions or hiring recommendations.
- Decorated multilingual job headings and slash/comma/pipe lists, distinct job-only technology aliases, source-bound location/contract/work-mode metadata and separate environment-only review states.
- Real seven-node LangGraph workflow, memory checkpoints, human interrupt/resume, source verification, session-scoped workflow access and an AI Agents workspace at `/agents`.

Planned:

- Broader/complex CV layout support and OCR.
- Broader graph workflows only where they add measurable value; the current graph is deterministic evidence orchestration.
- Broader independent extraction/comparison holdouts and authenticated review records.
- Application-level PostgreSQL persistence, ORM, and migrations (the local database service is provisioned).
- Public production deployment, authentication, and durable candidate storage.

The health endpoint checks application liveness only. CORS is a browser access policy, not authentication. Authentication, deployment configuration, and external dependency readiness checks remain future work.

Candidate and requirement confirmations are **unverified client workflow assertions**, not authenticated approvals. The API checks current snapshots and original source evidence, but has no authenticated identity or durable review history. Agent workflows additionally require a random browser-session capability for every action; this is local scoping, not multi-user authentication. “Documented” means an unverified profile statement is present; “not documented” does not establish lack of ability. Final interpretation remains with a human.

## Technology stack

| Area | Technology | Status |
| --- | --- | --- |
| Backend | Python, FastAPI, Uvicorn | Implemented |
| Tests | pytest, httpx, FastAPI TestClient | Implemented |
| CV ingestion and schemas | PyMuPDF, python-multipart, Pydantic v2 | Implemented |
| AI orchestration | LangGraph 1.2.15 | Deterministic local evidence workflow with human interrupt/resume |
| Database | PostgreSQL | Optional Compose profile `db`; application integration planned |
| Frontend | React, TypeScript, Vite, Tailwind CSS, Lucide, React Router | Implemented |
| Packaging | Docker, Docker Compose | Implemented |

## Project structure

```text
talentflow-ai/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── upload_limits.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       ├── candidates.py
│   │   │       ├── health.py
│   │   │       └── jobs.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── candidate.py
│   │   │   └── job.py
│   │   └── services/
│   │       ├── __init__.py
│   │       ├── extraction.py
│   │       ├── pdf.py
│   │       └── jobs.py
│   ├── tests/
│   │   ├── fixtures/cvs.json
│   │   ├── conftest.py
│   │   ├── test_main.py
│   │   ├── test_candidates.py
│   │   ├── test_extraction.py
│   │   ├── test_pdf.py
│   │   └── test_upload_limits.py
│   ├── requirements.txt
│   ├── evaluate.py           # Multilingual and accuracy CV datasets
│   ├── evaluate_jobs.py      # Independent fictional job annotations
│   ├── requirements.lock
│   ├── Dockerfile
│   ├── .dockerignore
│   └── .venv/                 # Existing local environment; excluded from Git and Docker
├── frontend/                # React workspace, tests, Dockerfile, Nginx proxy
├── docs/                    # CV, job analysis and Docker architecture
├── evaluation/              # Recorded fictional evaluation results
├── .gitignore
├── .dockerignore
├── .env.example
├── docker-compose.yml
├── compose.dev.yaml
├── compose.test.yaml
└── README.md
```

## Docker workflow (primary)

Install Docker Desktop for Windows with the WSL 2 backend, enable Linux containers, and start Docker Desktop. The workflow requires the Docker Compose plugin; host Python is unnecessary for container execution and testing. Run commands from `C:\Users\MSI\Desktop\talentflow-ai`.

Initial setup (copy the example only if `.env` does not already exist):

```powershell
Set-Location C:\Users\MSI\Desktop\talentflow-ai
docker --version
docker compose version
docker info
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
docker compose config --quiet
docker compose up -d --build
```

The example supplies safe, public local-development placeholders for `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. Replace the password before shared use. Keep `.env` out of Git; Compose passes database variables only to PostgreSQL; optional LLM variables go to the backend at runtime, never into image contents. Avoid sharing full `docker compose config` output because it contains resolved passwords; use `--quiet` for validation.

Open **http://localhost:5173** for the application and **http://127.0.0.1:8000/docs** for Swagger. The Compose command builds and starts the frontend and API only; `.env` is not required for them. Initial image downloads/builds may take several minutes. Both HTTP services are published only on loopback, and every `/api/v1` route rejects non-local `Host`/`Origin` headers.

PostgreSQL is optional because the application does not use it yet. Start it explicitly with `docker compose --profile db up -d --wait` (it needs the `POSTGRES_*` values from `.env`; without a password the official image refuses to initialize). It is reachable from containers as `db:5432` and has no public port. The `postgres_data` volume is never removed by these commands. A database container started before the profile existed keeps running until you stop it with `docker compose --profile db stop db`.

Daily operations:

```powershell
docker compose ps
docker compose logs --tail 100 -f backend
docker compose logs --tail 100 db
docker compose stop
docker compose start
docker compose down
```

`stop` keeps containers and data; `down` removes project containers/network and preserves the database volume. Do not add `-v` for ordinary shutdown.

For source editing with reload, explicitly use the development override:

```powershell
docker compose -f docker-compose.yml -f compose.dev.yaml config --quiet
docker compose -f docker-compose.yml -f compose.dev.yaml up -d --build --wait
docker compose -f docker-compose.yml -f compose.dev.yaml logs -f backend
```

Only `backend/app` is mounted, read-only; edits made on the host are visible to Uvicorn. Dependencies remain inside the container. To switch back to the image's normal command, run `docker compose up -d --build --wait`. No automatic development override enables reload in the base configuration.

Build and run the full test suite inside the dedicated test image:

```powershell
docker compose -f docker-compose.yml -f compose.test.yaml build backend
docker compose -f docker-compose.yml -f compose.test.yaml run --rm --no-deps backend
```

Tests run without host Python, a running API, PostgreSQL, or external services. Rebuild the test image after source/test changes. Docker installs `requirements.txt` constrained by the Linux-resolved `requirements.lock`; the Python and PostgreSQL images are pinned by digest. For ordinary rebuilds:

```powershell
docker compose build backend
docker compose -f docker-compose.yml -f compose.test.yaml build backend
docker compose up -d --wait
```

Database persistence and reset: PostgreSQL data is held in the project-scoped `postgres_data` volume, normally named `talentflow-ai_postgres_data`. Initialization variables apply only to an empty volume; changing `.env` does not alter existing database credentials. Inspect project volumes with `docker volume ls --filter label=com.docker.compose.project=talentflow-ai`. After an explicit decision to discard all local database data and any necessary backup, the destructive reset command is `docker compose down --volumes`, followed by `docker compose --profile db up -d --wait`. This command is documented only; automated work must obtain explicit approval before running it. Never use a global prune to reset this project.

Troubleshooting: if Docker reports a daemon/named-pipe connection error, start Docker Desktop and verify Linux-container mode and daemon access. If ports 8000 or 5173 are occupied, stop the conflicting service or change its loopback host port. Use `docker compose ps` and service logs to diagnose unhealthy containers. Initial pulls/builds require internet access. Direct browser requests to the backend support CORS from `http://localhost:5173`; the default frontend uses its same-origin proxy.

The backend and frontend run as non-root users; no service is privileged, secrets are excluded from build contexts, and database ports are not published. Public deployment, secret management, TLS, authentication, and worker isolation remain future work. See [Docker architecture](docs/docker_architecture.md).

After intentionally editing `backend/requirements.txt`, refresh the lock in a container before rebuilding normally. This explicit opt-out resolves dependencies without the old lock; leave the running service alone until the reviewed lock and final builds are ready:

```powershell
docker compose build --build-arg LOCK_FILE=/dev/null backend
$resolvedDependencies = docker compose run --rm --no-deps backend python -m pip freeze
if ($LASTEXITCODE -ne 0) { throw "Dependency lock generation failed" }
$resolvedDependencies | Set-Content -Encoding ascii backend/requirements.lock
git diff -- backend/requirements.txt backend/requirements.lock
```

Review the version changes, rebuild both runtime and test images normally, run containerized tests, then recreate the runtime service. Do not replace this Linux lock with a freeze of the Windows virtual environment. Digest pins must also be updated deliberately to receive base-image security fixes; version constraints are not artifact-hash verification.

## Frontend architecture and pages

The existing `frontend/` directory contains a React + TypeScript SPA built by Vite with Tailwind CSS and Lucide icons. `src/App.tsx` owns the shared sidebar/topbar and React Router routes; `pages/Parser.tsx` handles document selection and parsing; `components/Profile.tsx` renders the real candidate contract; `components/ErrorBoundary.tsx` provides recovery from rendering failures. `session.tsx` owns temporary profiles and periodic backend health checks. `types.ts` mirrors the Pydantic candidate and metadata models; `api.ts` handles requests, timeouts, PDF validation, and both structured document errors and FastAPI validation arrays.

| Page | Current behavior |
| --- | --- |
| Dashboard | Quick actions, backend liveness, available modules, actual session count and recent parsing activity |
| CV Parser | Select/drop one PDF, validate extension/MIME/header and 5 MiB size, submit, show fields and warnings, retry or upload another |
| Candidates | Successfully parsed profiles in memory, profile detail route, clear session profiles |
| Job Analysis | Select any session profile, confirm its review, analyze FR/EN text, review source-bound requirements and compare qualification evidence |
| AI Agents | Real deterministic LangGraph execution, actual checkpoint/review/resume, source-grounded report; no autonomous model agents |
| Settings | Actual application information, backend status and working health recheck |

The frontend calls `GET /api/v1/health`, `POST /api/v1/candidates/parse`, and `GET /api/v1/candidates/extraction-config` for public optional provider availability. The parse route remains compatible; optional form flags require explicit consent. Multipart requests use the field `file`, letting the browser set the boundary. `VITE_API_BASE_URL` is a build-time Vite variable; an empty value uses relative `/api/v1/...` paths. Vite proxies `/api` to `127.0.0.1:8000` during host development. The Docker frontend uses Nginx on port 8080 to proxy `/api/` to `backend:8000` and serve SPA routes; the browser sees only `localhost:5173`. Frontend startup waits for API health. The Node build stage is excluded from the lightweight non-root Nginx runtime image.

Default processing stays local: no CV file or profile is written to browser storage or a database. Optional model assistance transmits extracted text only after explicit per-upload consent to the displayed provider, whose retention policy applies. Successful candidate data is held in React memory until refresh/close or clearing the session. Raw uploaded file references are released after successful parsing. Do not put secrets in `VITE_*` variables: these values are public build output. The default Compose build explicitly uses the same-origin proxy; to change its base URL, change the frontend build argument and rebuild.

For optional host development, install Node 22.12+ (Node 22 LTS is used in Docker), start the backend, then:

```powershell
Set-Location frontend
npm ci
# Optional: copy .env.example to .env and set a public API base URL.
npm run dev
```

Open http://localhost:5173. The dev override `compose.dev.yaml` enables backend reload only; frontend changes require an image rebuild or the optional Vite development server.

## Frontend testing

With Node installed, run from `frontend/`:

```powershell
npm ci
npm test
npm run build
```

Without host Node, test the same source in Docker from the project root:

```powershell
docker build --target test -t talentflow-ai-frontend-test:local frontend
docker run --rm talentflow-ai-frontend-test:local
docker compose build frontend
```

Vitest + Testing Library cover PDF size/type/header validation, multipart API contracts, health, backend document/validation/network errors, timeout handling, upload/drop/loading/retry, profile sections and warnings, candidate session navigation/clearing, no persistent storage, and planned module labels. The production build compiles TypeScript with strict mode before bundling. Existing backend tests remain unchanged and are run separately using the commands below.

Manual browser checks: open Dashboard at desktop and mobile widths; check sidebar keyboard focus and mobile menu; upload a fictional text-based PDF; inspect all result sections and warnings; confirm reviewed corrections; open Job Analysis; paste a fictional job description, review requirements and compare evidence; refresh to verify profiles and results disappear. The application has no OCR, durable persistence, authentication or active agents. Default extraction is deterministic and partial; optional CV model extraction requires backend configuration and explicit consent. Backend health indicates liveness only.

Optional real Chromium smoke test (Docker Desktop, after Compose startup):

```powershell
docker build -t talentflow-ai-browser-test:local frontend/e2e
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway talentflow-ai-browser-test:local
```

This generates a fictional PDF in browser memory, uploads it to the real API through the frontend, checks profile sections/warnings and candidate navigation, then verifies route reload/session clearing, mobile navigation and invalid PDF handling. It defaults to `http://host.docker.internal:5173`, reaching the Docker Desktop host's published frontend. If host access is unavailable, use `--network talentflow-ai_default -e APP_URL=http://frontend:8080` to test the Compose service directly.

## Windows setup (optional host workflow)

Use PowerShell and the existing Python environment; do not recreate it. From the project root:

```powershell
Set-Location C:\Users\MSI\Desktop\talentflow-ai
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

For a fresh clone only, install Python 3.10 or later and create the environment with `py -m venv backend/.venv` before installing dependencies. This implementation was tested on Python 3.11. The API itself requires no API keys, database connection, or environment variables; `.env.example` now documents Docker Compose's local database configuration. Never commit credentials or real candidate CVs.

## Run the backend on the host (optional)

From the project root:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open:

- Service: http://127.0.0.1:8000/
- Health: http://127.0.0.1:8000/api/v1/health
- Swagger UI: http://127.0.0.1:8000/docs

`--reload` is for local development. Stop the server with Ctrl+C.

## Run tests on the host (optional)

From the project root:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest
```

Tests use FastAPI TestClient and do not require a running server or external services.

## Parse a CV

In the web interface at http://localhost:5173, open **CV Parser**, choose or drop a fictional PDF, and select **Parse CV**. Review the extracted profile and warnings, then open **Candidates** to revisit it during this session. Select **Upload another CV** to repeat. Textless/scanned, damaged, encrypted, and over-page-limit PDFs are rejected by the backend with actionable errors.

In Swagger at http://127.0.0.1:8000/docs, expand **POST /api/v1/candidates/parse**, select **Try it out**, choose a fictional PDF in the `file` field, and select **Execute**. The file is validated by its actual content; extension and declared MIME type are not trusted. No authentication or external service is required for local development.

PowerShell request example:

```powershell
curl.exe -X POST "http://127.0.0.1:8000/api/v1/candidates/parse" -F "file=@C:\path\to\synthetic.pdf;type=application/pdf"
```

The following is an abbreviated response example using fictional information; additional candidate fields and warnings are returned by the actual schema:

```json
{
  "candidate": {
    "full_name": "Avery Example",
    "email": "avery@example.com",
    "phone": null,
    "linkedin_url": null,
    "github_url": null,
    "education": [],
    "experience": [],
    "technical_skills": [{"name": "Python", "category": "programming_language"}],
    "projects": [],
    "languages": [],
    "certifications": []
  },
  "parsing_metadata": {
    "status": "partial",
    "page_count": 1,
    "engine": "deterministic-v2",
    "warnings": ["experience could not be reliably identified."]
  }
}
```

Document failures use `{"detail":{"code":"encrypted_pdf","message":"Encrypted PDFs are not supported."}}`. Limits return HTTP 413, non-PDF content returns 415, and unreadable, encrypted, over-page-limit or textless PDFs return 422. Missing multipart fields use FastAPI's standard 422 validation response. The full multipart body is limited to 5 MiB plus 64 KiB of form overhead, independently of Content-Length.

## Multilingual parsing, review and evaluation

Phase 3.6 adds complete role/degree subtitles, next-line employers and source-supported locations, abbreviated French/English months, preparatory-cycle education and consecutive/wrapped colon projects. Entry-bound evidence prevents repeated dates/institutions from citing another record. Vocabulary expands CRM/data/web/AI terms with token/URL/negative-context guards; HTML/CSS use `web_technology`. Warnings show a short summary with accessible grouped expansion, and profile sections keep natural heights without redesigning the dashboard.

On four new fictional regression PDFs, field precision improved **68.75% to 100%**, recall **25% to 100%**, exact projects **0/7 to 7/7**, and incorrect/unsupported predicted fields **20/64 to 0/176**. These are development fixtures, not general real-world accuracy. The original eight multilingual fixtures still match all 202 expected fields. Full before/after counts, methodology, snapshot fingerprints and file inventory are in [CV accuracy refinement](docs/cv_accuracy_refinement.md).

Phase 3.6 validation: **141 backend tests** and **21 frontend tests**, strict TypeScript/production build and real Chromium upload/review checks. The normal Docker command and PostgreSQL volume were preserved. No external model was called during testing.

```powershell
docker compose -f docker-compose.yml -f compose.test.yaml run --rm --no-deps backend python evaluate.py --dataset accuracy
```


Phase 3.5 retains PDF blocks/lines/spans, fonts and geometry before reading column regions. French and English heading aliases, unlabeled header/entry rules, French month dates, broader skill dictionaries and source evidence supplement existing labeled rules. Missing or ambiguous values remain null/empty with warnings. Profiles still report partial extraction.

After parsing, select **Review & correct profile** to edit identity, education, experience, skills, projects, languages and certifications; remove incorrect entries or add missing values. Review the source evidence and acknowledge the warning review before selecting **Confirm reviewed profile**. Saving new edits clears previous confirmation. Both the original extraction and the reviewed profile stay in browser memory only.

Optional model configuration uses backend `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`, and `LLM_API_KEY` runtime variables; all are empty in `.env.example`. Set `LLM_PROVIDER=openai-compatible`, supply the actual server/model/key, and recreate the backend with the normal Compose command. Local extraction needs none of these values. The frontend displays the destination/model and requires per-upload opt-in before any CV text is sent. Provider failures or unsupported output produce explicit warnings and retain the local result. No model name or provider destination is supplied by the application.

The eight fictional French/English evaluation PDFs are generated in memory from independently authored ground truth. Run from `backend/`:

```powershell
.\.venv\Scripts\python.exe evaluate.py
```

Or run the test image without host Python:

```powershell
docker compose -f docker-compose.yml -f compose.test.yaml build backend
docker compose -f docker-compose.yml -f compose.test.yaml run --rm --no-deps backend python evaluate.py
```

Measured development-fixture results: **202/202 correct predicted fields, 202/202 recalled fields, 8/8 exact profiles, 48/48 skill precision/recall, 0/202 unsupported fields against ground truth**. These are small regression fixtures developed alongside the parser, not an independent holdout or real-world accuracy estimate. Phase 3.5 validation: **108 backend tests passed**, including all 60 original tests; Phase 3.5 frontend validation: **18 tests passed**, strict TypeScript and production build passed. Real Chromium tests passed English/two-column French upload, source evidence, corrections/removal/confirmation, navigation and session clearing. Provider tests use mocks; no live external model was called.

Scanned PDFs still require future OCR. Dense/overlapping/multi-band layouts, hidden annotation URLs, company-first records and ambiguous short dates may remain incomplete. Dictionary matches do not establish proficiency. Quotes/evidence do not verify qualification truth. File/page/text limits do not provide hard native CPU/memory isolation. No real CV is committed, persisted to PostgreSQL or logged by the parser.

See [multilingual parsing and evaluation](docs/multilingual_cv_parsing.md), [recorded evaluation](evaluation/multilingual_results.json), [fictional French output](evaluation/fictional_french_output.json), and [CV parsing architecture](docs/cv_parsing_architecture.md).

## Job analysis and evidence comparison — Phase 4

Open **Job Analysis** at http://localhost:5173/matching. Select any uploaded candidate, including Awaiting review profiles. If needed, follow **Review selected candidate**, review and explicitly confirm the profile, then return with the same selection. Paste a French/English job description, analyze the real source, inspect required/preferred/unspecified groups, correct labels, acknowledge requirement review and select **Compare evidence**. Both reviews are required for comparison. The results show documented, not documented and needs human review sections with explanations and source excerpts. Original extraction and corrections remain separate. Changes to qualifications, confirmation, source or requirements invalidate previous results; refresh/clearing removes session data. The same reviewed documents can now be reused in the Phase 5 AI Agents workflow.

The new API endpoints are `POST /api/v1/jobs/analyze`, `POST /api/v1/jobs/compare` and `GET /api/v1/jobs/capabilities`. Comparison accepts qualification-only snapshots and validates source/evidence and current review snapshots. Names, contact fields, employers, institutions, locations, dates and links are excluded. Free-text qualification descriptions still require human privacy review. Confirmations are unverified workflow assertions, without authentication or durable approval records. No ranking, suitability scores, eligibility or employment recommendations are produced.

Actual Phase 4 validation: **225 backend tests** passed on Windows and Docker, **33 frontend tests** passed, strict TypeScript/Vite builds passed, and all three real Chromium workflows passed. The normal `docker compose up -d --build` succeeded; all three services are healthy and the existing PostgreSQL container/volume is preserved. Frontend, SPA route, Swagger, health and proxied job APIs returned HTTP 200.

Ten independently annotated fictional jobs matched **33/33 skills** for precision and recall, **37/37 explicit classifications**, **39/39 source evidence and statuses**, and **0/39 unsupported requirements**. These small development fixtures are not a real-world accuracy estimate. Existing CV evaluations still match 202/202 multilingual fields and 176/176 accuracy fields. Run from `backend/`:

```powershell
.\.venv\Scripts\python.exe evaluate_jobs.py --output ../evaluation/job_analysis_results.json
```

For Chromium after startup, run `docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway talentflow-ai-browser-test:local node job-smoke.mjs` after rebuilding `frontend/e2e`. See [job analysis architecture](docs/job_analysis_architecture.md) for the complete file inventory, API shapes, privacy/review boundaries, evaluation methodology, initial/final artifacts, executed validation and known limitations.

## Realistic job-post extraction — Phase 4.1

Job Analysis now recognizes Environnement technique, Technical Environment, Technology/Tech Stack, Tools and Technologies and additional French/English profile/preference headings, including copied-post emoji/punctuation. Technical environment mentions appear separately from Required/Preferred/Unspecified qualifications. They retain unspecified source status and always require human interpretation during comparison, even after a classification edit. Application contacts, hashtags, company prose and generic responsibilities do not become candidate requirements.

Inline arrows, pipes and labels extract location, contract and work mode independently, with exact source evidence and detailed schedule excerpts. For the fictional AI Architect example, **Rabat/Technopolis**, **CDI** and **Hybrid** are separate fields; six environment rows contain **18 distinct technologies**, without invented mandatory qualifications. Job-only normalization keeps Azure OpenAI, Azure AI, Azure, OpenAI, AI, Machine Learning, LLMs, RAG and API/REST APIs distinct. The existing CV vocabulary and parser behavior are preserved.

Actual validation: **377 backend tests** passed on Windows and Docker; **40 frontend tests**, strict TypeScript/Vite builds and **all four Chromium workflows** passed. Normal Compose startup and all three service healthchecks passed, preserving the existing PostgreSQL container/volume. Direct and proxied Job Analysis APIs and Swagger remain available.

On the unchanged **14 fictional realistic posts**, technology recall improved **19/87 → 87/87**, classification **12/38 → 38/38**, explicit metadata **31/43 → 43/43**, and unsupported rows **14/27 → 0/38**. A frozen baseline runs in an isolated interpreter, with source hashes recorded. These development regressions are not representative real-world accuracy. From `backend/`:

```powershell
.\.venv\Scripts\python.exe evaluate_jobs_realistic.py --baseline-root ../.artifacts/phase41-baseline --output ../evaluation/job_realistic_results.json --example-output ../evaluation/fictional_ai_architect_output.json
```

Omit `--baseline-root` when the preserved local snapshot is unavailable. The Docker test image includes the current-only evaluator. See [job accuracy](docs/job_analysis_accuracy.md) for the complete file inventory, baseline methodology, metrics, example JSON, known limitations and browser commands; [job analysis architecture](docs/job_analysis_architecture.md) documents the additive API fields and review boundaries.

Comparison workflow fixes retain the reviewed-profile and evidence gates while adding an exact **Comparison availability** checklist. Every session profile is selectable in the native dropdown, including Awaiting review profiles; selection does not approve comparison. Review selected candidate opens the correct profile, and confirmation preserves the same selection on return without refreshing. Comparison requires both candidate confirmation and the separate job review. Oversized qualification lists are identified before submission without truncation. Structured validation errors identify the field to correct, and outdated source analysis prompts fresh analysis/review. The false HTTP 422 caused by inconsistent acronym context is fixed. The initial comparison fix passed **400 backend tests**, **51 frontend tests**, the strict production build and **five Chromium workflows**. See [comparison workflow fix](docs/job_comparison_workflow_fix.md) for current selection behavior, subsequent test results and verification commands.

## Compact comparison results — Phase 4.2

Comparison results now open with dynamic evidence-status counts and a **Technical Evidence Overview**. Canonical technologies appear once under **Mentioned in both documents** or **No supporting mention found in the reviewed CV**, with expandable job excerpts, immutable source offsets and unverified reviewed-CV field references. **Requires interpretation** keeps ambiguous source clauses visible without treating an environment list as a mandatory qualification.

Requirement cards start collapsed and retain the original evidence, reviewed labels, interpretation notes and warnings behind accessible controls. Status filters and expand/collapse controls operate locally, without another API request. Both candidate selection before review and the separate candidate/job confirmation gates remain intact. The backend adds a backward-compatible `technical_evidence` response field; comparison inputs and qualification-status semantics are unchanged. There are no similarity scores, rankings or employment recommendations.

Actual Phase 4.2 validation: **429 backend tests**, **69 frontend tests**, strict TypeScript/Vite build and **all six Chromium workflows** passed. Compose configuration/startup passed with all services healthy and the original PostgreSQL volume preserved. See [comparison results UX](docs/comparison_results_ux.md) for the contract, canonical aggregation, current limitations, testing commands and desktop/mobile screenshots.

## Source-grounded comparison accuracy — Phase 4.3

The French Data Business Analyst example now extracts **SQL, GCP, Teradata and Airflow**, including parenthesized/slash-separated technical stacks. Job-only aliases preserve cloud/database/tool distinctions, original classifications and environment provenance. Explicit business-analysis statements are retrieved without claiming mastery. Professional duration and telecom-sector employment are not inferred from projects, dates, networking or VoIP.

Comparison evidence now includes optional exact excerpt offsets while retaining the full reviewed field for compatibility. Results show concise supporting text with **View full reviewed field**, collapsed metadata/notes and responsive evidence layouts. Shared CV boundary detection now recognizes explicit academic/university project headings and English Business Analyst entries, keeping their descriptions, dates and technologies separate.

On **16 fictional cases annotated and SHA-frozen before tuning**, technology recall improved **29/48 → 48/48**, evidence recall **29/39 → 36/39**, concise excerpt boundaries **18/30 → 36/36**, unsupported evidence **1/30 → 0/36**, and CV segmentation assertions **11/60 → 41/60**. These are development measurements, not representative real-world accuracy. Unsupported internship titles, conservative whole-field privacy/negation filtering and a frozen sector-status taxonomy disagreement remain documented.

Actual validation: **495 backend tests** passed on Windows and Linux Docker; **73 frontend tests**, strict TypeScript/Vite build and **all seven real-API Chromium workflows** passed. Normal Compose startup remains working with the existing PostgreSQL container/volume preserved. See [real-world comparison accuracy](docs/real_world_comparison_accuracy.md) for the complete file inventory, exact before/after metrics, source contract, browser verification and limitations.

## Copied-post and qualification fixes — Phase 4.3.1

Formatting-only copied text no longer becomes a requirement. The French Data Business Analyst reproduction now yields **six requirements instead of seven**, preserving original backslashes, evidence quotes and offsets on meaningful lines. Explicit minimum experience is **required**, while the candidate comparison remains **needs_review**; preferred, conditional, quoted, negated and technical-environment contexts retain separate handling.

Business Analysis retrieval adds precise wording and coordinated modeling support while keeping UML, process modeling, functional specifications and requirements documents distinct. The positive fictional profile returns **four exact excerpts instead of three**; the negative profile returns none. SQL, GCP, Teradata and Airflow remain recognized. Privacy filters, human confirmation and session behavior are preserved.

Actual validation: **580 backend tests** passed on Windows and Linux Docker; **74 frontend tests**, strict TypeScript/Vite builds and **all eight real-API Chromium workflows** passed. Compose startup and all service healthchecks passed with the existing PostgreSQL container/volume preserved. See [final job accuracy fixes](docs/job_analysis_final_accuracy_fixes.md) for root causes, files, before/after results, immutable evaluation-label differences and remaining limitations.

## Local evidence orchestration — Phase 5

Open **AI Agents** at http://localhost:5173/agents after reviewing a candidate and job in Job Analysis. Start an evidence workflow to execute real LangGraph nodes: intake validation, candidate preparation, job preparation, existing deterministic comparison, evidence verification, human review and final report. Execution pauses at an actual LangGraph `interrupt`; inspect the evidence, explicitly acknowledge the local review assertion and select **Review & Resume**. Supported `Command(resume=...)` continues the checkpoint and verifies evidence again before finalization. Status/report reads do not rerun nodes.

The workspace reuses current React session reviews and qualification-only payloads. Candidate/job edits invalidate old evidence and acknowledgment. Actual backend steps, blocked/failed errors, cancellation/expiry and the existing Technical Evidence Overview remain inspectable. No model, ranking, proficiency inference or hiring recommendation is added. LangGraph does not automatically improve CV extraction accuracy.

Workflows use separate memory checkpointers, 30-minute TTL, a maximum of 32 retained workflows, bounded retries/timeouts and a random 256-bit browser capability. Input/checkpoints are deleted on terminal states; a completed evidence report can remain until TTL/capacity cleanup. Backend restart loses workflows; browser refresh loses candidate/review state and the capability. Nothing is persisted to PostgreSQL or browser storage. Keep the existing loopback-only deployment: there is no authenticated multi-user access or durable approval history.

Versioned routes are under `/api/v1/agents/workflows`: start, status, review, resume, cancel and report. All require `X-Workflow-Session`; the server verifies ownership, original snapshots, source spans, qualification fields and canonical technical references. Requests are bounded before JSON parsing; validation errors do not echo submitted text. No external provider or tracing export occurs during graph execution.

Actual validation: **649 backend tests** passed on Windows and Linux Docker, **90 frontend tests** passed, strict TypeScript and the Vite production build passed, and **all nine real-API Chromium workflows** passed. The new graph workflow passed on desktop/mobile with genuine interrupt/resume, source inspection, stale-review invalidation, cancellation and ownership checks. The exact `docker compose up -d --build` succeeded with all three services healthy and the original PostgreSQL container/volume preserved. Browser testing also fixed a UUID compatibility issue on the local Docker HTTP address.

See [agent workflow testing](docs/agent_workflow_testing.md) for actual results, commands and screenshots, and [LangGraph architecture](docs/langgraph_architecture.md) for actual transitions, schemas, routes, retention, setup and limitations.

## Next phase

Next, broaden independently authored CV/job holdouts and target prose, negation, cross-language qualification and layout failures. Add authenticated, auditable review records with purpose-limited persistence before shared deployment, then evaluate any optional job model against the same evidence boundaries using fictional data. Public deployment remains future work; candidate ranking and employment decisions remain outside this tool's purpose.
