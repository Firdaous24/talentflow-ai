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


@router.post("", response_model=WorkflowResponse, status_code=201)
async def start_workflow(request: WorkflowStart, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.start, request, session)


@router.get("/{workflow_id}", response_model=WorkflowResponse)
async def get_workflow(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.get, workflow_id, session)


@router.get("/{workflow_id}/review", response_model=WorkflowResponse)
async def get_review(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    workflow = await execute(service.get, workflow_id, session)
    if workflow.status in {"expired", "cancelled"}:
        raise HTTPException(status_code=410, detail={"code": "workflow_" + workflow.status, "message": "Start a new workflow from current reviewed documents."})
    if workflow.status != "waiting_for_review":
        raise HTTPException(status_code=409, detail={"code": "workflow_not_waiting", "message": "This workflow is not awaiting review. Inspect its current status."})
    return workflow


@router.post("/{workflow_id}/resume", response_model=WorkflowResponse)
async def resume_workflow(workflow_id: str, request: WorkflowResume, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.resume, workflow_id, request, session)


@router.post("/{workflow_id}/cancel", response_model=WorkflowResponse)
async def cancel_workflow(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return await execute(service.cancel, workflow_id, session)


@router.get("/{workflow_id}/report", response_model=WorkflowResponse)
async def get_report(workflow_id: str, service: Manager, session: Owner, response: Response):
    response.headers["Cache-Control"] = "no-store"
    workflow = await execute(service.get, workflow_id, session)
    if workflow.status in {"expired", "cancelled"}:
        raise HTTPException(status_code=410, detail={"code": "workflow_" + workflow.status, "message": "Start a new workflow from current reviewed documents."})
    if workflow.status != "completed":
        raise HTTPException(status_code=409, detail={"code": "workflow_report_not_ready", "message": "Inspect and acknowledge the waiting evidence before requesting the final report."})
    return workflow
