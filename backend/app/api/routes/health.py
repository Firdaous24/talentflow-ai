"""Service health endpoint."""

from fastapi import APIRouter

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("", summary="Check service health")
def get_health() -> dict[str, str]:
    """Report application liveness; no external dependencies are checked."""
    return {"status": "ok"}
