"""CSRF enforcement and response headers for every /api/v2 route.

Any unsafe method (POST, PUT, PATCH, DELETE) must carry `X-CSRF-Token`, the
signed double-submit token from GET /api/v2/auth/csrf bound to the CSRF cookie
and to the current session. A missing or invalid token answers 403
`csrf_failed` before any route code runs, signed in or not.
"""

from fastapi.responses import JSONResponse
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.auth.security import csrf_valid
from app.core.config import ConfigurationError, get_settings

PREFIX = "/api/v2/"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
}


class AccountBoundaryMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or not scope.get("path", "").startswith(PREFIX):
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                for name, value in SECURITY_HEADERS.items():
                    headers[name] = value
            await send(message)

        if scope["method"] not in SAFE_METHODS:
            try:
                settings = get_settings()
            except ConfigurationError:
                settings = None  # The route answers 503 service_not_configured.
            if settings is not None:
                request = Request(scope)
                if not csrf_valid(settings.secret_key, request.cookies.get(settings.csrf_cookie), request.cookies.get(settings.session_cookie), request.headers.get("x-csrf-token")):
                    response = JSONResponse(status_code=403, content={"detail": {"code": "csrf_failed", "message": "Missing or invalid CSRF token. Reload the page and try again."}})
                    await response(scope, receive, send_with_headers)
                    return
        await self.app(scope, receive, send_with_headers)
