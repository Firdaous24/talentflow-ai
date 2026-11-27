"""Bound the full multipart body before the framework parses it."""

import re

from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.services.pdf import MAX_UPLOAD_BYTES

MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 64 * 1024
# The demo parser, the candidate space upload (phase 7) and each bulk-import file
# (phase 8, one PDF per request) share the same limit.
UPLOAD_PATHS = frozenset({"/api/v1/candidates/parse", "/api/v2/me/cv"})
IMPORT_FILE_PATH = re.compile(r"^/api/v2/orgs/[^/]+/imports/[^/]+/files$")


def is_upload_path(path: str) -> bool:
    path = path.rstrip("/")
    return path in UPLOAD_PATHS or IMPORT_FILE_PATH.fullmatch(path) is not None


class UploadLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or not is_upload_path(scope["path"]):
            await self.app(scope, receive, send)
            return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > MAX_REQUEST_BYTES:
                response = JSONResponse(status_code=413, content={"detail": {"code": "request_too_large", "message": "Multipart request exceeds the upload limit."}})
                await response(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break
        delivered = False

        async def replay() -> dict:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
