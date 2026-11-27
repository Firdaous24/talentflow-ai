"""Versioned local capability-scoped LangGraph workflow endpoints."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from app.agents.checkpoints import WorkflowManager, owner_hash
from app.agents.errors import WorkflowFault
from app.agents.schemas import WorkflowResponse, WorkflowResume, WorkflowStart

router = APIRouter(prefix="/agents/workflows", tags=["Local agent workflows"])


def manager(request: Request) -> WorkflowManager:
    return request.app.state.workflow_manager


def owner(x_workflow_session: Annotated[str | None, Header()] = None) -> str:
    try:
        owner_hash(x_workflow_session)
    except WorkflowFault as error:
        raise HTTPException(status_code=error.status_code, detail={"code": error.code, "message": error.message}) from error
    return x_workflow_session


Manager = Annotated[WorkflowManager, Depends(manager)]
Owner = Annotated[str, Depends(owner)]


async def execute(function, *args):
    try:
        return await run_in_threadpool(function, *args)
    except WorkflowFault as error:
        detail = {"code": error.code, "message": error.message}
        if error.workflow:
            detail["workflow"] = error.workflow.model_dump(mode="json")
        raise HTTPException(status_code=error.status_code, detail=detail) from error


@router.post("", response_model=WorkflowResponse, status_code=201, summary="Start a workflow and run it until the human review interrupt",
             description="Validates the qualification-only snapshot, runs the deterministic nodes and pauses at `human_review`. Idempotent per `client_request_id`.",
             responses={401: {"description": "Missing or malformed X-Workflow-Session capability"}, 403: {"description": "Non-local host or origin"}, 409: {"description": "client_request_id reused with different documents"}, 413: {"description": "Body exceeds 512 KiB"}, 422: {"description": "Blocked by review gates or privacy boundary (workflow in detail)"}, 429: {"description": "Local workflow capacity reached"}})
async def start_workflow(request: WorkflowStart, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.start, request, session)


@router.get("/{workflow_id}", response_model=WorkflowResponse, summary="Read the current workflow status without executing nodes",
            responses={401: {"description": "Missing or malformed X-Workflow-Session capability"}, 403: {"description": "Non-local host or origin"}, 404: {"description": "Unknown workflow or another session's workflow"}})
async def get_workflow(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.get, workflow_id, session)


@router.get("/{workflow_id}/review", response_model=WorkflowResponse, summary="Read the evidence awaiting human review",
            description="API-only helper (the web UI uses the status route). Succeeds only while the workflow is paused at the `human_review` interrupt.",
            responses={401: {"description": "Missing or malformed X-Workflow-Session capability"}, 403: {"description": "Non-local host or origin"}, 404: {"description": "Unknown workflow or another session's workflow"}, 409: {"description": "Workflow is not awaiting review"}, 410: {"description": "Workflow cancelled or expired"}})
async def get_review(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    workflow = await execute(service.get, workflow_id, session)
    if workflow.status in {"expired", "cancelled"}:
        raise HTTPException(status_code=410, detail={"code": "workflow_" + workflow.status, "message": "Start a new workflow from current reviewed documents."})
    if workflow.status != "waiting_for_review":
        raise HTTPException(status_code=409, detail={"code": "workflow_not_waiting", "message": "This workflow is not awaiting review. Inspect its current status."})
    return workflow


@router.post("/{workflow_id}/resume", response_model=WorkflowResponse, summary="Resume after an explicit local review acknowledgment",
             description="Sends `Command(resume=...)` to the paused graph; the evidence is verified again before the final report. Not an authenticated approval.",
             responses={401: {"description": "Missing or malformed X-Workflow-Session capability"}, 403: {"description": "Non-local host or origin"}, 404: {"description": "Unknown workflow or another session's workflow"}, 409: {"description": "Not awaiting review or documents changed"}, 410: {"description": "Workflow cancelled or expired"}, 422: {"description": "Invalid acknowledgment or final verification failed"}})
async def resume_workflow(workflow_id: str, request: WorkflowResume, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.resume, workflow_id, request, session)


@router.post("/{workflow_id}/cancel", response_model=WorkflowResponse, summary="Cancel a workflow and delete its checkpoint data",
             description="Idempotent. A blocked or failed workflow keeps its original errors in the response.",
             responses={401: {"description": "Missing or malformed X-Workflow-Session capability"}, 403: {"description": "Non-local host or origin"}, 404: {"description": "Unknown workflow or another session's workflow"}, 409: {"description": "Report already finalized"}})
async def cancel_workflow(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.cancel, workflow_id, session)


@router.get("/{workflow_id}/report", response_model=WorkflowResponse, summary="Read the finalized evidence report",
            description="API-only helper (the web UI uses the status route). Succeeds only once the workflow is completed; never re-runs nodes.",
            responses={401: {"description": "Missing or malformed X-Workflow-Session capability"}, 403: {"description": "Non-local host or origin"}, 404: {"description": "Unknown workflow or another session's workflow"}, 409: {"description": "Report not finalized yet"}, 410: {"description": "Workflow cancelled or expired"}})
async def get_report(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    workflow = await execute(service.get, workflow_id, session)
    if workflow.status in {"expired", "cancelled"}:
        raise HTTPException(status_code=410, detail={"code": "workflow_" + workflow.status, "message": "Start a new workflow from current reviewed documents."})
    if workflow.status != "completed":
        raise HTTPException(status_code=409, detail={"code": "workflow_report_not_ready", "message": "Inspect and acknowledge the waiting evidence before requesting the final report."})
    return workflow
