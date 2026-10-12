# TalentFlow AI

TalentFlow AI is a recruitment intelligence portfolio project with local French/English CV extraction, source evidence and human review. Optional model assistance requires consent; multi-agent analysis and explainable job matching are planned.

## Current status

**Phases 1, 2, 2.5, 3, 3.5, and 3.6 are implemented: backend foundation, Docker infrastructure, React workspace, layout-aware French/English parsing, source evidence and human review.** Optional model extraction requires backend configuration and per-upload consent; matching and LangGraph agents remain planned.

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
- Docker Compose workflow with a non-root backend, dedicated test image, and internal PostgreSQL service.
- Responsive React interface with Dashboard, CV Parser, Candidates, and application information pages.
- Layout-aware French/English section and entry extraction, expanded skill vocabulary and source evidence.
- In-memory corrections/removal and explicit reviewed-profile confirmation.
- Optional provider abstraction with structured outputs, evidence rejection and local fallback; no external calls without per-upload consent.
- Typed API client, local PDF validation, structured backend errors, extraction warnings, and temporary candidate profiles.
- Frontend production image with a same-origin Nginx API proxy and React Router fallback.

Planned:

- Broader/complex CV layout support and OCR.
- LangGraph agents for recruitment analysis and job matching.
- Explainable candidate recommendations and evaluation metrics.
- Application-level PostgreSQL persistence, ORM, and migrations (the local database service is provisioned).
- Public production deployment, authentication, and durable candidate storage.

The health endpoint checks application liveness only. CORS is a browser access policy, not authentication. Authentication, deployment configuration, and external dependency readiness checks remain future work.

## Technology stack

| Area | Technology | Status |
| --- | --- | --- |
| Backend | Python, FastAPI, Uvicorn | Implemented |
| Tests | pytest, httpx, FastAPI TestClient | Implemented |
| CV ingestion and schemas | PyMuPDF, python-multipart, Pydantic v2 | Implemented |
| AI orchestration | LangGraph | Planned |
| Database | PostgreSQL | Local service implemented; application integration planned |
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
│   │   │       └── health.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   └── candidate.py
│   │   └── services/
│   │       ├── __init__.py
│   │       ├── extraction.py
│   │       └── pdf.py
│   ├── tests/
│   │   ├── fixtures/cvs.json
│   │   ├── conftest.py
│   │   ├── test_main.py
│   │   ├── test_candidates.py
│   │   ├── test_extraction.py
│   │   ├── test_pdf.py
│   │   └── test_upload_limits.py
│   ├── requirements.txt
│   ├── requirements.lock
│   ├── Dockerfile
│   ├── .dockerignore
│   └── .venv/                 # Existing local environment; excluded from Git and Docker
├── frontend/                # React workspace, tests, Dockerfile, Nginx proxy
├── docs/                    # cv_parsing_architecture.md and docker_architecture.md
├── evaluation/              # Reserved for evaluation assets
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

Open **http://localhost:5173** for the application and **http://127.0.0.1:8000/docs** for Swagger. The one Compose command builds and starts the frontend, API, and PostgreSQL. Initial image downloads/builds may take several minutes. Both HTTP services are published only on loopback; PostgreSQL is available to containers as `db:5432` and has no public port. The API currently works independently of PostgreSQL. Existing database volumes are preserved.

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

Database persistence and reset: PostgreSQL data is held in the project-scoped `postgres_data` volume, normally named `talentflow-ai_postgres_data`. Initialization variables apply only to an empty volume; changing `.env` does not alter existing database credentials. Inspect project volumes with `docker volume ls --filter label=com.docker.compose.project=talentflow-ai`. After an explicit decision to discard all local database data and any necessary backup, the destructive reset command is `docker compose down --volumes`, followed by `docker compose up -d --wait`. This command is documented only; automated work must obtain explicit approval before running it. Never use a global prune to reset this project.

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
| Job Matching | Clearly labeled Coming Soon; no matching or scores |
| AI Agents | Clearly labeled Coming Soon; no running or simulated agents |
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

Manual browser checks: open Dashboard at desktop and mobile widths; check sidebar keyboard focus and mobile menu; upload a fictional text-based PDF; inspect all result sections and warnings; open Candidates; retry a failed upload; refresh to verify profiles disappear. The parser has no OCR, durable persistence, authentication, job matching or active agents. Default extraction is deterministic and partial; optional model extraction requires backend configuration and explicit consent. Backend health indicates liveness only.

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

Current validation: **141 backend tests** and **21 frontend tests**, strict TypeScript/production build and real Chromium upload/review checks. The normal Docker command and PostgreSQL volume are preserved. No external model was called during testing.

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

## Next phase

Next, build an independently authored extraction holdout and target remaining layout/association failures; validate an explicitly configured model using fictional data if desired. Job requirement schemas can follow once extraction/review behavior is stable. Matching, LangGraph orchestration, authenticated database persistence and public deployment remain later phases.
