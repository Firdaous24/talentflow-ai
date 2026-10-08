"""Bounded PDF ingestion without permanent storage or candidate logging."""

from dataclasses import dataclass
import re
from threading import Lock
import unicodedata

import pymupdf

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_PAGES = 10
MAX_TEXT_CHARACTERS = 200_000
_PDF_LOCK = Lock()


class CVParsingError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


@dataclass(frozen=True)
class PDFText:
    text: str
    page_count: int
    warnings: tuple[str, ...] = ()


def normalize_text(text: str) -> str:
    """Normalize horizontal whitespace without erasing lines or page boundaries."""
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n").replace("\r", "\n")
    text = "".join(char for char in text if char in "\n\t\f" or unicodedata.category(char) != "Cc")
    return "\n".join(re.sub(r"[^\S\n\f]+", " ", line).strip() for line in text.split("\n")).strip()


def extract_pdf(data: bytes) -> PDFText:
    if len(data) > MAX_UPLOAD_BYTES:
        raise CVParsingError("file_too_large", "PDF must not exceed 5 MiB.", 413)
    if not data:
        raise CVParsingError("empty_file", "The uploaded file is empty.")
    if not data.startswith(b"%PDF-"):
        raise CVParsingError("invalid_file_type", "Upload a structurally valid PDF document.", 415)
    # MuPDF does not support concurrent threads. Serialize library access.
    with _PDF_LOCK:
        pymupdf.TOOLS.mupdf_display_errors(False)
        pymupdf.TOOLS.mupdf_display_warnings(False)
        try:
            with pymupdf.open(stream=data, filetype="pdf") as document:
                if not document.is_pdf:
                    raise CVParsingError("invalid_file_type", "The document is not a PDF.", 415)
                if document.needs_pass or document.is_encrypted or document.xref_get_key(-1, "Encrypt")[0] != "null":
                    raise CVParsingError("encrypted_pdf", "Encrypted PDFs are not supported.")
                if document.is_repaired or not data.rstrip().endswith(b"%%EOF"):
                    raise CVParsingError("corrupted_pdf", "The PDF is damaged or incomplete.")
                if document.page_count > MAX_PAGES:
                    raise CVParsingError("too_many_pages", "PDF must not exceed 10 pages.")
                if document.page_count == 0:
                    raise CVParsingError("empty_pdf", "PDF contains no pages.")
                pages: list[str] = []
                total = 0
                for page in document:
                    text = normalize_text(page.get_text("text", sort=True))
                    total += len(text)
                    if total > MAX_TEXT_CHARACTERS:
                        raise CVParsingError("text_limit_exceeded", "Extracted text exceeds the processing limit.")
                    pages.append(text)
                if not any(pages):
                    raise CVParsingError("no_extractable_text", "PDF contains no extractable text; OCR is not supported.")
                warnings = ("Some pages contain no extractable text; OCR is not supported.",) if not all(pages) else ()
                return PDFText("\n\f\n".join(pages), document.page_count, warnings)
        except CVParsingError:
            raise
        except (RuntimeError, ValueError, pymupdf.FileDataError) as error:
            raise CVParsingError("corrupted_pdf", "The PDF cannot be safely read.") from error
