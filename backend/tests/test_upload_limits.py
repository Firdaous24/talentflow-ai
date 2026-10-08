"""Verify body limits with no Content-Length header and streamed chunks."""

import pytest

from app.api.upload_limits import MAX_REQUEST_BYTES, UploadLimitMiddleware


@pytest.mark.anyio
async def test_streamed_oversized_body_is_rejected_before_parser() -> None:
    called = False
    messages = iter([
        {"type": "http.request", "body": b"x" * MAX_REQUEST_BYTES, "more_body": True},
        {"type": "http.request", "body": b"x", "more_body": False},
    ])
    sent = []

    async def inner(scope, receive, send):
        nonlocal called
        called = True

    async def receive():
        return next(messages)

    async def send(message):
        sent.append(message)

    middleware = UploadLimitMiddleware(inner)
    await middleware({"type": "http", "method": "POST", "path": "/api/v1/candidates/parse", "headers": []}, receive, send)
    assert not called
    assert sent[0]["status"] == 413


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
