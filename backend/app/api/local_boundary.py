"""Loopback-only boundary and JSON body limit for every /api/v1 route.

The API has no authentication. It must only answer requests addressed to a
local host name, and browser requests from a local origin. This blocks DNS
rebinding and cross-site use of the published loopback port. Limits are
checked on the raw byte stream before the framework parses any JSON.

Dedicated, stricter middlewares keep their own responses:
- /api/v1/candidates/parse: multipart limit in UploadLimitMiddleware (5 MiB + 64 KiB);
- /api/v1/agents/: AgentBoundaryMiddleware (local hosts, 512 KiB, no-store).
"""

from urllib.parse import urlsplit

from fastapi.responses import JSONResponse

API_PREFIX = "/api/v1/"
UPLOAD_PATH = "/api/v1/candidates/parse"
AGENTS_PREFIX = "/api/v1/agents/"
# A full comparison payload for a 30,000-character job text stays far below this.
MAX_JSON_BODY_BYTES = 1024 * 1024
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})


def is_local_request(headers: dict[bytes, bytes], allowed_hosts) -> bool:
    """True when Host, and Origin if present, name an allowed local host."""
    try:
        host = urlsplit("//" + headers.get(b"host", b"").decode("ascii")).hostname
        origin = headers.get(b"origin")
        parsed = urlsplit(origin.decode("ascii")) if origin else None
    except (UnicodeError, ValueError):
        return False
    if host not in allowed_hosts:
        return False
    if parsed and (parsed.hostname not in allowed_hosts or parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment):
        return False
    return True


class LocalBoundaryMiddleware:
    def __init__(self, app, allowed_hosts=LOCAL_HOSTS, max_body_bytes=MAX_JSON_BODY_BYTES):
        self.app = app
        self.allowed_hosts = frozenset(allowed_hosts)
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope, receive, send):
        path = scope.get("path", "")
        if scope["type"] != "http" or not path.startswith(API_PREFIX) or path.startswith(AGENTS_PREFIX):
            await self.app(scope, receive, send)
            return

        async def reject(status, code, message):
            await JSONResponse(status_code=status, content={"detail": {"code": code, "message": message}})(scope, receive, send)

        if not is_local_request(dict(scope.get("headers", [])), self.allowed_hosts):
            await reject(403, "local_requests_only", "The API only accepts requests to local hosts from local origins.")
            return
        if scope["method"] != "POST" or path.rstrip("/") == UPLOAD_PATH:
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > self.max_body_bytes:
                await reject(413, "request_too_large", "The request body exceeds the 1 MiB API limit.")
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
