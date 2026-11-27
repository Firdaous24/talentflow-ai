# Agent workflow validation — Phase 5

All graph fixtures are fictional. These tests evaluate orchestration, source consistency and lifecycle behavior, not real-world hiring accuracy.

## Backend scenarios

`test_agents_graph.py` and `test_agents_api.py` add **69 tests** covering:

| Evaluation dimension | Assertions |
| --- | --- |
| Completion correctness | Existing deterministic output is preserved; final report exists only after acknowledgment; environment-only rows remain `needs_review`. |
| Node execution | Real `CompiledStateGraph`, exact seven-node order, conditional blocked/failed routes, one recoverable retry, no retry of other errors. |
| Interrupt/resume | Actual checkpoint `next == ("human_review",)`, interrupt task present, supported `Command(resume=...)`, exactly one completion under concurrent resume. |
| Snapshot consistency | Candidate, job source, reviewed labels, browser revision/hash and restored checkpoint substitutions cannot finalize stale evidence. |
| Evidence integrity | Original source IDs/spans/origin/classification, row rule/status, valid candidate paths/full quotes/excerpts, duplicate prevention and canonical overview references. |
| Error/cancellation | Structured/redacted schema errors, wrong owner/unknown IDs, explicit boolean acknowledgment, cancellation, TTL cleanup, 32-workflow capacity and idempotent starts. |
| Privacy exclusions | Identity extra keys rejected, obvious contact/personal free text blocked before checkpointing, no network/provider calls; ambient tracing explicitly disabled. |
| Trace truthfulness | Only executed nodes are completed; failed/waiting nodes identified; safe static notes; reads and repeated resume do not rerun comparison. |

69/69 targeted graph/API tests passed. The complete backend suite passed on Windows and Linux Docker.

## Commands

From `backend/`, using the existing virtual environment:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt -c requirements.lock
.\.venv\Scripts\python.exe -m pytest -p no:cacheprovider
```

From the project root:

```powershell
docker build --target test -t talentflow-ai-backend-test:phase5 backend
docker run --rm talentflow-ai-backend-test:phase5
docker build --target test -t talentflow-ai-frontend-test:local frontend
docker run --rm talentflow-ai-frontend-test:local npm test
docker compose config --quiet
docker compose up -d --build
```

The Compose frontend build runs strict TypeScript and the Vite production build. No host Node install is required for the Docker commands. Dependency changes were resolved against the official Linux Python 3.11 image while preserving all old locked versions; `pip check` passed in the backend image.

## Real local API demonstration

After the normal Docker rebuild, a fictional qualification-only request was sent through the actual Nginx proxy at `localhost:5173`:

1. Analyze an environment-only Python/Airflow/GCP job and submit matching review snapshots.
2. Start the graph: five executed steps completed, human review waiting, final report pending.
3. Inspect `/review`: same pending evidence.
4. Resume with explicit boolean acknowledgment, unchanged current payload/revision and server hash.
5. Retrieve `/report`: completed seven-step trace, unchanged comparison, environment result still `needs_review`.
6. Read the report again without rerunning graph nodes.

The local artifact `.artifacts/phase5/live_api_workflow.json` stores only safe status/node names, no candidate text or capability token. Core tests additionally inspect the real checkpointer and interrupt objects, so the demonstration cannot pass using a simulated dialog alone.

## Chromium

`frontend/e2e/agents-smoke.mjs` uses a real local API and a generated fictional PDF. It covers upload → candidate review/confirm → job analysis/review → actual graph start/interrupt → evidence inspection → explicit acknowledgment/resume → final report. It also checks desktop/mobile accessibility, ownership, stale-session invalidation, cancellation, unchanged environment semantics and absence of browser persistence/provider requests.

Build the existing browser image and run against the started stack:

```powershell
docker build -t talentflow-ai-browser-test:local frontend/e2e
docker run --rm --ipc=host --add-host=host.docker.internal:host-gateway talentflow-ai-browser-test:local node agents-smoke.mjs
```

All nine real-API Chromium scripts passed after the final normal Compose rebuild: `smoke.mjs`, `accuracy-smoke.mjs`, `job-smoke.mjs`, `realistic-job-smoke.mjs`, `comparison-workflow-smoke.mjs`, `comparison-results-smoke.mjs`, `real-world-comparison-smoke.mjs`, `final-job-accuracy-smoke.mjs` and `agents-smoke.mjs`. The native candidate-selection test used actual mouse input. Some earlier scripts require a read-only `/fixtures` mount; see the Phase 4 reports for their commands.

## Current executed results

- **649 backend tests passed** on Windows (12.52 s) and Linux Docker (9.71 s), including all 580 earlier tests and 69 new graph/API regressions.
- **90 frontend tests passed** (12.17 s), including all 74 earlier tests and 16 new workspace/API regressions. Strict TypeScript and Vite production build passed (1,701 modules; 2.95 s).
- Backend image import and `pip check` passed; exact normal Compose startup succeeded, all three services were healthy and PostgreSQL retained container `35deac7994bf255ff1cd2a0181c4aaacd86cba1cc71d3af623f65df9c8f8192f` and the existing volume.
- **All nine real-API Chromium workflows passed** after the final rebuild. The new graph workflow passed at desktop 1440 px and mobile 390 px, including actual SQL/source-field and requirement-card inspection before acknowledgment. A fictional job-title emoji checks Unicode code-point source offsets. Browser testing caught an actual HTTP Docker-host compatibility issue: `crypto.randomUUID` is unavailable outside secure contexts. The browser revision/request-ID helper now uses `crypto.getRandomValues` with RFC 4122 UUID bits, and a frontend regression covers that fallback. Source/qualification privacy, current snapshots, real interrupt/resume and exact seven-step output passed.
- The final exact `docker compose up -d --build` succeeded, `docker compose config --quiet` passed and **all three services were healthy**. PostgreSQL retained the same container and `talentflow-ai_postgres_data` volume. Final frontend assets were `index-QI_497RO.js` and `index-C-9JU2cx.css`.

Local screenshots `.artifacts/phase5/agents-review-desktop.png`, `agents-review-mobile.png` and `agents-final-mobile.png` contain fictional evidence only; they show readable source disclosures, actual step states and the explicit review control. No real candidate data or capability is committed.

## Limits

The corpus is development regression data, not a representative holdout. Memory checkpoints and React session state do not survive restart/refresh, and stale browser capabilities cannot recover orphaned workflows; TTL/capacity cleanup removes their payloads. There is no authenticated approval, durable audit trail, multi-user deployment, raw-PDF isolation or proof that arbitrary free text is anonymous. Existing extraction/filtering/segmentation limitations remain unchanged. No scoring, ranking, automated recommendation or external model integration is introduced.
