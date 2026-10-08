"""Shared in-process API client and fictional, programmatically generated PDFs."""

from collections.abc import Iterator
import json
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient

from app.main import app

SYNTHETIC_CVS = json.loads((Path(__file__).parent / "fixtures" / "cvs.json").read_text(encoding="utf-8"))


def make_pdf(text: str = "", pages: int = 1, encrypted: bool = False, user_password: str = "test-only") -> bytes:
    with pymupdf.open() as document:
        for index in range(pages):
            page = document.new_page()
            if text and index == 0:
                remaining = page.insert_textbox(pymupdf.Rect(40, 40, 555, 800), text, fontsize=10)
                assert remaining >= 0, "Synthetic text must fit on its page."
        if encrypted:
            return document.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw="synthetic-owner", user_pw=user_password)
        return document.tobytes()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
