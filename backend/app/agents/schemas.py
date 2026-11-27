"""Agent API contracts. Qualification-only requests retain existing review gates."""

from typing import Annotated, Literal
from uuid import UUID

from pydantic import Field, field_validator

from app.models.candidate import Schema
from app.models.job import JobComparisonRequest, JobComparisonResponse

NodeName = Literal["intake_validation", "candidate_preparation", "job_preparation", "evidence_comparison", "evidence_verification", "human_review", "final_report"]
WorkflowStatus = Literal["waiting_for_review", "completed", "blocked", "failed", "cancelled", "expired"]


class WorkflowStart(Schema):
    comparison: JobComparisonRequest
    request_revision: Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")]
    client_request_id: UUID


class WorkflowResume(Schema):
    acknowledged: Literal[True]
    request_revision: Annotated[str, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._:-]+$")]
    snapshot_hash: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
    comparison: JobComparisonRequest

    @field_validator("acknowledged", mode="before")
    @classmethod
    def explicit_acknowledgment(cls, value):
        if value is not True:
            raise ValueError("Explicit acknowledgment must be the JSON boolean true.")
        return value


class WorkflowError(Schema):
    code: str
    message: str
    node: NodeName | None = None
    recoverable: bool = False


class WorkflowStep(Schema):
    node: NodeName
    status: Literal["pending", "completed", "waiting_for_review", "failed", "cancelled"]
    note: str


class WorkflowResponse(Schema):
    workflow_id: str
    request_revision: str
    snapshot_hash: str
    status: WorkflowStatus
    current_node: NodeName | None
    steps: list[WorkflowStep]
    human_review_status: Literal["not_requested", "required", "acknowledged"]
    comparison: JobComparisonResponse | None
    errors: list[WorkflowError]
    validation_notes: list[str]
    created_at: str
    expires_at: str
    review_assertion: Literal["unverified_client_assertion"] = "unverified_client_assertion"
