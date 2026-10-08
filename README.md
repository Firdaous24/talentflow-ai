# TalentFlow AI

TalentFlow AI is an AI-powered multi-agent recruitment intelligence platform being developed as a public GitHub portfolio project. Its planned workflow will help recruiters analyze CVs, compare candidates with job requirements, and review explainable recommendations.

## Current status

**Phases 1, 2, and 2.5 are implemented: backend foundation, deterministic PDF CV parsing, and local Docker infrastructure.** The development target is 14 days. LLM recruitment intelligence is planned and is not available yet.

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

Planned:

- Broader CV layout support, OCR, and LLM-assisted structured extraction.
- LangGraph agents for recruitment analysis and job matching.
- Explainable candidate recommendations and evaluation metrics.
- Application-level PostgreSQL persistence, ORM, and migrations (the local database service is provisioned).
- React recruiter interface and production deployment.

The health endpoint checks application liveness only. CORS is a browser access policy, not authentication. Authentication, deployment configuration, and external dependency readiness checks remain future work.

## Technology stack

| Area | Technology | Status |
| --- | --- | --- |
| Backend | Python, FastAPI, Uvicorn | Implemented |
| Tests | pytest, httpx, FastAPI TestClient | Implemented |
| CV ingestion and schemas | PyMuPDF, python-multipart, Pydantic v2 | Implemented |
| AI orchestration | LangGraph | Planned |
| Database | PostgreSQL | Local service implemented; application integration planned |
| Frontend | React, TypeScript, Tailwind CSS | Planned |
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
├── frontend/                # Reserved for future implementation
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
docker compose build backend
docker compose up -d --wait --wait-timeout 120
```

The example supplies safe, public local-development placeholders for `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. Replace the password before shared use. Keep `.env` out of Git; Compose passes these variables only to PostgreSQL, not to the backend image. Avoid sharing full `docker compose config` output because it contains resolved passwords; use `--quiet` for validation.

Open http://127.0.0.1:8000/docs. The API is published only on loopback; PostgreSQL is available to containers as `db:5432` and has no public port. The API currently works independently of PostgreSQL.

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

Troubleshooting: if Docker reports a daemon/named-pipe connection error, start Docker Desktop and verify Linux-container mode and daemon access. If port 8000 is occupied, stop the conflicting local service or change the backend's loopback host port. Use `docker compose ps` and service logs to diagnose unhealthy containers. Initial pulls/builds require internet access. CORS expects a future frontend opened at `http://localhost:5173`.

The backend runs as a non-root user; neither service is privileged, secrets are excluded from build contexts, and database ports are not published. Public deployment, secret management, TLS, authentication, and worker isolation remain future work. See [Docker architecture](docs/docker_architecture.md).

After intentionally editing `backend/requirements.txt`, refresh the lock in a container before rebuilding normally. This explicit opt-out resolves dependencies without the old lock; leave the running service alone until the reviewed lock and final builds are ready:

```powershell
docker compose build --build-arg LOCK_FILE=/dev/null backend
$resolvedDependencies = docker compose run --rm --no-deps backend python -m pip freeze
if ($LASTEXITCODE -ne 0) { throw "Dependency lock generation failed" }
$resolvedDependencies | Set-Content -Encoding ascii backend/requirements.lock
git diff -- backend/requirements.txt backend/requirements.lock
```

Review the version changes, rebuild both runtime and test images normally, run containerized tests, then recreate the runtime service. Do not replace this Linux lock with a freeze of the Windows virtual environment. Digest pins must also be updated deliberately to receive base-image security fixes; version constraints are not artifact-hash verification.

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
    "engine": "deterministic-v1",
    "warnings": ["experience could not be reliably identified."]
  }
}
```

Document failures use `{"detail":{"code":"encrypted_pdf","message":"Encrypted PDFs are not supported."}}`. Limits return HTTP 413, non-PDF content returns 415, and unreadable, encrypted, over-page-limit or textless PDFs return 422. Missing multipart fields use FastAPI's standard 422 validation response. The full multipart body is limited to 5 MiB plus 64 KiB of form overhead, independently of Content-Length.

## Extraction limitations

The engine supports English section aliases and explicit labels such as `Name:`, `Job title:`, `Company:`, `Degree:`, `Institution:`, `Start date:`, `End date:`, `Description:`, and `Technologies:`. Education, experience, and project entries may be separated by blank lines or repeated identifying labels. Dates retain their supplied precision (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`, or `Present`); natural-language dates are omitted with warnings.

Contact names and phones require explicit labels. Email and HTTP profile URLs can also be recognized in the contact area. Skills are controlled-dictionary mentions in the skills section, not proof of proficiency. Technologies attached to explicitly labeled projects or experience are extracted separately. Language names and proficiency labels use a controlled vocabulary. Certifications use `Name:` or `Certification:`, with optional `Issuer:` and `Date:`.

Unknown fields stay null or empty; unsupported prose is not promoted into inferred facts. Responses always report `partial` and include warnings. This is a deterministic parser, not a general CV understanding system. Multi-column reading order can be imperfect; scanned PDFs require future OCR. Extracted text is limited to 200,000 characters. Documents are not permanently stored and candidate content is not logged. Multipart processing may use temporary spool files, which are closed after the request. These limits are not a hard CPU or decompression-memory sandbox; public deployment will need worker isolation, timeouts, authentication, and request-rate controls.

See [CV parsing architecture](docs/cv_parsing_architecture.md) for the pipeline, contracts, supported rules, and extension points. Synthetic fixture source is in `backend/tests/fixtures/cvs.json`; PDF binaries are generated during testing and are not committed.

## Next phase

Phase 3 should define job requirement schemas and a reproducible extraction/matching evaluation baseline. Then introduce an optional LLM extractor behind the existing `CandidateExtractor` interface, with provenance checks and LangGraph orchestration. Application-level PostgreSQL persistence, React, and public deployment remain future phases.
