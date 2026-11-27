"""FastAPI application entry point."""

import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.agents.checkpoints import WorkflowManager
from app.agents.middleware import AgentBoundaryMiddleware
from app.api.local_boundary import LocalBoundaryMiddleware
from app.api.routes.agents import router as agents_router
from app.api.routes.candidates import router as candidates_router
from app.api.routes.health import router as health_router
from app.api.routes.jobs import router as jobs_router
from app.api.upload_limits import UploadLimitMiddleware


@asynccontextmanager
async def lifespan(application: FastAPI):
    application.state.workflow_manager = WorkflowManager()

    async def cleanup():
        while True:
            await asyncio.sleep(30)
            await asyncio.to_thread(application.state.workflow_manager.cleanup)

    task = asyncio.create_task(cleanup())
    try:
        yield
    finally:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        application.state.workflow_manager.clear()

app = FastAPI(
    title="TalentFlow AI",
    version="0.1.0",
    description="AI-powered recruitment intelligence platform API.",
    docs_url="/docs",
    lifespan=lifespan,
)

# Last added runs first: CORS -> agents boundary -> /api/v1 local boundary -> upload limit.
app.add_middleware(UploadLimitMiddleware)
app.add_middleware(LocalBoundaryMiddleware)
app.add_middleware(AgentBoundaryMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-Workflow-Session"],
)

app.include_router(health_router, prefix="/api/v1")
app.include_router(candidates_router, prefix="/api/v1")
app.include_router(jobs_router, prefix="/api/v1")
app.include_router(agents_router, prefix="/api/v1")


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, error: RequestValidationError):
    if request.url.path.startswith("/api/v1/agents/"):
        # Pydantic's default response includes submitted free-text input values.
        # Keep structured locations/types without echoing sensitive input.
        return JSONResponse(status_code=422, content={"detail": {
            "code": "workflow_validation", "message": "Check the workflow request fields and current reviewed documents.",
            "errors": [{"loc": list(item["loc"]), "type": item["type"]} for item in error.errors()],
        }}, headers={"Cache-Control": "no-store"})
    return await request_validation_exception_handler(request, error)


@app.get("/", tags=["Service"], summary="Get service information")
def get_root() -> dict[str, str]:
    """Return the service identity and API documentation location."""
    return {"name": app.title, "version": app.version, "docs": "/docs"}
