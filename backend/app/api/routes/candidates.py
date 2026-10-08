"""Multipart candidate parsing endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.models.candidate import CVParsingResponse
from app.services.extraction import CandidateExtractor, DeterministicCandidateExtractor
from app.services.pdf import CVParsingError, MAX_UPLOAD_BYTES, extract_pdf

router = APIRouter(prefix="/candidates", tags=["Candidates"])


def get_extractor() -> CandidateExtractor:
    """Dependency seam for a future extraction implementation."""
    return DeterministicCandidateExtractor()


@router.post("/parse", response_model=CVParsingResponse, summary="Extract supported candidate fields from a PDF", responses={413: {"description": "Upload limit exceeded"}, 415: {"description": "Not a PDF"}, 422: {"description": "Invalid document or request"}})
async def parse_candidate(
    file: Annotated[UploadFile, File(description="PDF CV, at most 5 MiB and 10 pages. No OCR.")],
    extractor: Annotated[CandidateExtractor, Depends(get_extractor)],
) -> CVParsingResponse:
    try:
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        document = await run_in_threadpool(extract_pdf, data)
        return await run_in_threadpool(extractor.extract, document)
    except CVParsingError as error:
        raise HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.message}) from error
    finally:
        await file.close()
