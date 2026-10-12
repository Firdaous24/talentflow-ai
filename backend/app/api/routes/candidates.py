"""Multipart candidate parsing endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.models.candidate import CVParsingResponse
from app.services.extraction import CandidateExtractor, DeterministicCandidateExtractor
from app.services.pdf import CVParsingError, MAX_UPLOAD_BYTES, extract_pdf
from app.services.llm import EvidenceCheckedExtractor, configured_provider, provider_configuration

router = APIRouter(prefix="/candidates", tags=["Candidates"])


def get_extractor() -> CandidateExtractor:
    """Dependency seam for a future extraction implementation."""
    return DeterministicCandidateExtractor()


@router.get('/extraction-config', summary='Public optional extraction capabilities (no credentials)')
def extraction_config() -> dict:
    return provider_configuration()


@router.post("/parse", response_model=CVParsingResponse, summary="Extract supported candidate fields from a PDF", responses={413: {"description": "Upload limit exceeded"}, 415: {"description": "Not a PDF"}, 422: {"description": "Invalid document or request"}})
async def parse_candidate(
    file: Annotated[UploadFile, File(description="PDF CV, at most 5 MiB and 10 pages. No OCR.")],
    extractor: Annotated[CandidateExtractor, Depends(get_extractor)],
    use_llm: Annotated[bool, Form()] = False,
    external_consent: Annotated[bool, Form()] = False,
) -> CVParsingResponse:
    try:
        if use_llm and not external_consent:
            raise CVParsingError('consent_required', 'Explicit consent is required before sending CV text to a configured model provider.')
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        document = await run_in_threadpool(extract_pdf, data)
        strategy = EvidenceCheckedExtractor(configured_provider(), extractor) if use_llm else extractor
        return await run_in_threadpool(strategy.extract, document)
    except CVParsingError as error:
        raise HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.message}) from error
    finally:
        await file.close()
