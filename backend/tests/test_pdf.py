"""PDF service tests independent of HTTP."""

import pytest

from app.services.pdf import CVParsingError, extract_pdf, normalize_text
from conftest import make_pdf


def test_pdf_text_and_page_boundaries() -> None:
    result = extract_pdf(make_pdf("Education\nDegree: BSc\n\nSkills\nPython", pages=2))
    assert result.page_count == 2
    assert "Education\nDegree: BSc" in result.text
    assert "\f" in result.text
    assert result.warnings


def test_normalization_preserves_sections() -> None:
    assert normalize_text(" Education\r\n Degree:\t BSc\r\n\r\nSkills\nPython\x00 ") == "Education\nDegree: BSc\n\nSkills\nPython"


def test_page_limit_boundary() -> None:
    assert extract_pdf(make_pdf("Skills\nPython", pages=10)).page_count == 10


def test_pdf_zero_pages() -> None:
    data = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n"
    offset = len(data)
    data += b"xref\n0 3\n0000000000 65535 f \n0000000009 00000 n \n0000000062 00000 n \ntrailer\n<< /Size 3 /Root 1 0 R >>\nstartxref\n" + str(offset).encode() + b"\n%%EOF\n"
    with pytest.raises(CVParsingError) as caught:
        extract_pdf(data)
    assert caught.value.code == "empty_pdf"


def test_extracted_text_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.services.pdf.MAX_TEXT_CHARACTERS", 10)
    with pytest.raises(CVParsingError) as caught:
        extract_pdf(make_pdf("Skills\nPython FastAPI"))
    assert caught.value.code == "text_limit_exceeded"
