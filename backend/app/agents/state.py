"""Typed graph channels; source request is removed at terminal lifecycle cleanup."""

from typing import Any, TypedDict


class WorkflowState(TypedDict, total=False):
    workflow_id: str
    request_revision: str
    snapshot_hash: str
    request: dict[str, Any]
    comparison_result: dict[str, Any]
    status: str
    current_node: str
    completed_nodes: list[str]
    human_review_status: str
    errors: list[dict[str, Any]]
    validation_notes: list[str]
    retry_count: int
