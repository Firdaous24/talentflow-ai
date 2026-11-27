"""Account platform API (/api/v2): every route requires a session except the public auth routes."""

from fastapi import APIRouter

from app.api.v2.account import router as account_router
from app.api.v2.auth import router as auth_router
from app.api.v2.spaces import router as spaces_router

router = APIRouter(prefix="/api/v2")
router.include_router(auth_router)
router.include_router(account_router)
router.include_router(spaces_router)

# Routes reachable without a session. Everything else answers 401 when signed out.
PUBLIC_ROUTES = frozenset({
    ("GET", "/api/v2/auth/csrf"),
    ("POST", "/api/v2/auth/register"),
    ("POST", "/api/v2/auth/verify-email"),
    ("POST", "/api/v2/auth/verify-email/resend"),
    ("POST", "/api/v2/auth/login"),
    ("POST", "/api/v2/auth/password/forgot"),
    ("POST", "/api/v2/auth/password/reset"),
})
