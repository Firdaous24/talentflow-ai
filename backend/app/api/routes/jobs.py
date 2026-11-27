"""Versioned session-only job analysis and document-comparison endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool

from app.models.job import JobAnalysisResponse, JobAnalyzeRequest, JobComparisonRequest, JobComparisonResponse
from app.services.jobs import LIMITATIONS, DeterministicJobAnalyzer, JobAnalyzer, JobWorkflowError, compare_job

router = APIRouter(prefix="/jobs", tags=["Jobs"])


def get_job_analyzer() -> JobAnalyzer:
    return DeterministicJobAnalyzer()


@router.get("/capabilities", summary="Supported job analysis and comparison boundaries")
def capabilities() -> dict:
    return {
        "analysis_method": "deterministic-v1", "languages": ["French", "English"],
        "min_text_length": 30, "max_text_length": 30000,
        "comparison_method": "qualification-document-checklist-v1",
        "statuses": ["documented", "not_documented", "needs_review"],
        "requirement_origins": ["qualification", "technical_environment"],
        "technical_environment_is_mandatory": False,
        "metadata_fields": ["title", "company", "location", "employment_type", "work_mode"],
        "metadata_source_evidence": True,
        "review_assertion": "unverified_client_assertion", "authenticated_approval": False,
        "persistence": "none", "external_model_calls": False,
        "limitations": LIMITATIONS + ["Only known technical aliases and explicit heading/qualification rules are supported. Complex prose, negation scope, equivalence and experience duration need human review."],
    }


@router.post("/analyze", response_model=JobAnalysisResponse, summary="Analyze explicit French/English job requirements")
async def analyze_job(request: JobAnalyzeRequest, analyzer: Annotated[JobAnalyzer, Depends(get_job_analyzer)]) -> JobAnalysisResponse:
    return await run_in_threadpool(analyzer.analyze, request.text)


@router.post("/compare", response_model=JobComparisonResponse, summary="Compare reviewed qualification documents; no selection decisions", responses={422: {"description": "Invalid, stale or unsupported review workflow"}})
async def compare_job_documents(request: JobComparisonRequest, analyzer: Annotated[JobAnalyzer, Depends(get_job_analyzer)]) -> JobComparisonResponse:
    try:
        return await run_in_threadpool(compare_job, request, analyzer)
    except JobWorkflowError as error:
        raise HTTPException(status_code=422, detail={"code": error.code, "message": error.message}) from error
