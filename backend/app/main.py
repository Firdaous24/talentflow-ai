"""FastAPI application entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.candidates import router as candidates_router
from app.api.upload_limits import UploadLimitMiddleware

app = FastAPI(
    title="TalentFlow AI",
    version="0.1.0",
    description="AI-powered recruitment intelligence platform API.",
    docs_url="/docs",
)

app.add_middleware(UploadLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

app.include_router(health_router, prefix="/api/v1")
app.include_router(candidates_router, prefix="/api/v1")


@app.get("/", tags=["Service"], summary="Get service information")
def get_root() -> dict[str, str]:
    """Return the service identity and API documentation location."""
    return {"name": app.title, "version": app.version, "docs": "/docs"}
