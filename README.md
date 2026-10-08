# TalentFlow AI

TalentFlow AI is an AI-powered multi-agent recruitment intelligence platform being developed as a public GitHub portfolio project. Its planned workflow will help recruiters analyze CVs, compare candidates with job requirements, and review explainable recommendations.

## Current status

**Phase 1: Backend Foundation is implemented.** The development target is 14 days. Recruitment intelligence features are planned and are not available yet.

Implemented:

- Modular, typed FastAPI backend, version `0.1.0`.
- Service information at `GET /` and liveness at `GET /api/v1/health`.
- Swagger documentation at `/docs` and OpenAPI schema at `/openapi.json`.
- Browser CORS access restricted to `http://localhost:5173` for GET requests.
- Automated endpoint, documentation, and CORS tests.

Planned:

- CV ingestion and structured candidate profiles.
- LangGraph agents for recruitment analysis and job matching.
- Explainable candidate recommendations and evaluation metrics.
- PostgreSQL persistence.
- React recruiter interface and Docker packaging.

The health endpoint checks application liveness only. CORS is a browser access policy, not authentication. Authentication, deployment configuration, and external dependency readiness checks remain future work.

## Technology stack

| Area | Technology | Status |
| --- | --- | --- |
| Backend | Python, FastAPI, Uvicorn | Implemented |
| Tests | pytest, httpx, FastAPI TestClient | Implemented |
| AI orchestration | LangGraph | Planned |
| Database | PostgreSQL | Planned |
| Frontend | React, TypeScript, Tailwind CSS | Planned |
| Packaging | Docker | Planned |

## Project structure

```text
talentflow-ai/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py
│   │   └── api/
│   │       ├── __init__.py
│   │       └── routes/
│   │           ├── __init__.py
│   │           └── health.py
│   ├── tests/
│   │   └── test_main.py
│   ├── requirements.txt
│   └── .venv/                 # Existing local environment; ignored by Git
├── frontend/                # Reserved for future implementation
├── docs/                    # Reserved for architecture documentation
├── evaluation/              # Reserved for evaluation assets
├── .gitignore
└── README.md
```

## Windows setup

Use PowerShell and the existing Python environment; do not recreate it. From the project root:

```powershell
Set-Location C:\Users\MSI\Desktop\talentflow-ai
.\backend\.venv\Scripts\python.exe -m pip install -r .\backend\requirements.txt
```

For a fresh clone only, install Python 3.10 or later and create the environment with `py -m venv backend/.venv` before installing dependencies. No API keys, database, or environment variables are required for Phase 1, so an `.env.example` is unnecessary at this stage. Never commit credentials or real candidate CVs.

## Run the backend

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

## Run tests

From the project root:

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -m pytest
```

Tests use FastAPI TestClient and do not require a running server or external services.

## Next phase

Phase 2 should define candidate and job schemas, the API contracts, and synthetic evaluation fixtures before implementing CV ingestion. Use synthetic or explicitly authorized data throughout portfolio development.
