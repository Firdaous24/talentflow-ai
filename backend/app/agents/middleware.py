"""Local-only workflow boundary and byte limit, applied before JSON parsing."""

from fastapi.responses import JSONResponse

from app.agents.checkpoints import MAX_BODY_BYTES

# Runtime allow-list (shared with every /api/v1 route). Tests use a "localhost"
# base URL instead of an extra host.
from app.api.local_boundary import LOCAL_HOSTS, is_local_request


class AgentBoundaryMiddleware:
    def __init__(self, app, allowed_hosts=LOCAL_HOSTS):
        self.app = app
        self.allowed_hosts = frozenset(allowed_hosts)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not scope["path"].startswith("/api/v1/agents/"):
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))

        async def safe_send(message):
            if message["type"] == "http.response.start":
                response_headers = [(key, value) for key, value in message.get("headers", []) if key.lower() != b"cache-control"]
                message = {**message, "headers": [*response_headers, (b"cache-control", b"no-store")]}
            await send(message)

        async def reject(status, code, message):
            response = JSONResponse(status_code=status, content={"detail": {"code": code, "message": message}}, headers={"Cache-Control": "no-store"})
            await response(scope, receive, safe_send)

        if not is_local_request(headers, self.allowed_hosts):
            await reject(403, "local_workflow_only", "Agent workflows are restricted to local development hosts and origins.")
            return
        if scope["method"] != "POST":
            await self.app(scope, receive, safe_send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > MAX_BODY_BYTES:
                await reject(413, "workflow_request_too_large", "The local workflow request exceeds 512 KiB. Reduce the qualification-only input.")
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

        await self.app(scope, replay, safe_send)
