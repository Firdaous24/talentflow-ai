"""Per-workflow memory checkpoints with ownership, TTL, bounded capacity and locks.

No database writes. Process restart loses all workflows. Completed reports retain
only their reviewed comparison and safe trace until TTL; all checkpoints/input
snapshots are deleted on completion, failure, cancellation or expiry.
"""

import hashlib
import hmac
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from uuid import uuid4

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command
from langsmith import tracing_context

from app.agents.errors import WorkflowFault
from app.agents.graph import NODES, make_graph
from app.agents.schemas import WorkflowResponse, WorkflowResume, WorkflowStart
from app.agents.verification import snapshot_hash, validate_minimization

MAX_BODY_BYTES = 512 * 1024
TERMINAL = {"completed", "blocked", "failed", "cancelled", "expired"}
STEP_NOTES = {
    "intake_validation": "Validate bounded qualification-only input and local workflow scope.",
    "candidate_preparation": "Check the candidate's current review assertion and qualification snapshot.",
    "job_preparation": "Check reviewed requirements against a fresh analysis of the source.",
    "evidence_comparison": "Run the existing deterministic source-grounded document comparison.",
    "evidence_verification": "Verify source spans, field paths, duplicates and technical provenance.",
    "human_review": "Require explicit local evidence review; no authenticated approval is claimed.",
    "final_report": "Verify the resumed evidence and finalize the document report.",
}


def owner_hash(owner: str | None) -> str:
    if not owner or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", owner):
        raise WorkflowFault("workflow_session_required", "Open AI Agents in the current browser session before accessing a workflow.", 401)
    return hashlib.sha256(owner.encode("ascii")).hexdigest()


def iso(timestamp):
    return datetime.fromtimestamp(timestamp, UTC).isoformat()


@dataclass
class WorkflowEntry:
    workflow_id: str
    owner: str
    client_request_id: str
    fingerprint: str
    # Immutable copy: duplicate detection must not read state that a running
    # graph is replacing without holding the entry lock.
    request_revision: str
    created: float
    expires: float
    state: dict
    checkpointer: InMemorySaver = field(default_factory=InMemorySaver)
    lock: threading.RLock = field(default_factory=threading.RLock)
    graph: object = None

    @property
    def config(self):
        return {"configurable": {"thread_id": self.workflow_id}, "recursion_limit": 16}


class WorkflowManager:
    def __init__(self, ttl_seconds=1800, max_workflows=32, clock=None):
        self.ttl_seconds, self.max_workflows = ttl_seconds, max_workflows
        self.clock = clock or time.time
        self.entries: dict[str, WorkflowEntry] = {}
        self.lock = threading.RLock()

    def _purge(self, entry, *, clear_result=False):
        entry.checkpointer.delete_thread(entry.workflow_id)
        entry.state.pop("request", None)
        if clear_result:
            entry.state.pop("comparison_result", None)

    def _expire(self, entry):
        if self.clock() >= entry.expires:
            entry.state.update(status="expired", current_node=entry.state.get("current_node"))
            self._purge(entry, clear_result=True)

    def cleanup(self):
        # The registry lock only protects the dict snapshot. A workflow whose
        # lock is held is executing graph nodes; skip it instead of waiting, so
        # a slow graph never blocks other starts. It is expired on a later pass
        # or by its own get/resume/cancel, which always call _expire.
        with self.lock:
            entries = list(self.entries.values())
        for entry in entries:
            if entry.lock.acquire(blocking=False):
                try:
                    self._expire(entry)
                finally:
                    entry.lock.release()

    def clear(self):
        with self.lock:
            for entry in self.entries.values():
                with entry.lock:
                    self._purge(entry, clear_result=True)
            self.entries.clear()

    def _find(self, workflow_id, owner):
        hashed = owner_hash(owner)
        with self.lock:
            entry = self.entries.get(workflow_id)
            if entry is None or not hmac.compare_digest(entry.owner, hashed):
                raise WorkflowFault("workflow_not_found", "Workflow unavailable in this browser session. Start a new workflow from current reviewed documents.", 404)
            return entry

    def _execute(self, entry, value):
        try:
            # LangChain is a transitive dependency. Even an externally supplied
            # tracing environment must not export qualification text by default.
            with tracing_context(enabled=False):
                entry.graph.invoke(value, entry.config)
            entry.state = dict(entry.graph.get_state(entry.config).values)
        except Exception:
            checkpoint = entry.graph.get_state(entry.config)
            if checkpoint.values:
                entry.state = dict(checkpoint.values)
            failed_node = checkpoint.next[0] if checkpoint.next else entry.state.get("current_node", "intake_validation")
            entry.state.update(status="failed", current_node=failed_node, errors=[{"code": "graph_execution_failed", "message": "The bounded graph execution failed. No report was finalized. Start a new workflow.", "node": failed_node, "recoverable": False}])
        if entry.state.get("status") in TERMINAL:
            self._purge(entry, clear_result=entry.state.get("status") != "completed")

    def start(self, request: WorkflowStart, owner: str):
        hashed = owner_hash(owner)
        validate_minimization(request.comparison)  # BEFORE state/checkpoint creation.
        fingerprint = snapshot_hash(request.comparison)
        self.cleanup()
        duplicate = None
        # Critical section: registry lookup, capacity and publication only. No
        # graph execution and no waiting on another workflow happens here.
        with self.lock:
            for existing in self.entries.values():
                if hmac.compare_digest(existing.owner, hashed) and existing.client_request_id == str(request.client_request_id):
                    if existing.fingerprint != fingerprint or existing.request_revision != request.request_revision:
                        raise WorkflowFault("duplicate_request_changed", "This start request was already used with different documents. Start with a new request identifier.", 409)
                    duplicate = existing
                    break
            if duplicate is None:
                if len(self.entries) >= self.max_workflows:
                    # Executing entries hold their lock and are never terminal.
                    terminal = [item for item in self.entries.values() if item.state.get("status") in TERMINAL and item.lock.acquire(blocking=False)]
                    if not terminal:
                        raise WorkflowFault("workflow_capacity", "The local workflow limit is reached. Cancel an existing workflow or wait for expiry.", 429)
                    oldest = min(terminal, key=lambda item: item.created)
                    try:
                        self._purge(oldest, clear_result=True)
                        del self.entries[oldest.workflow_id]
                    finally:
                        for item in terminal:
                            item.lock.release()
                entry = self._create(request, hashed, fingerprint)
        if duplicate is not None:
            # Waiting for a concurrent first execution happens outside the
            # registry lock; the duplicate then observes its final state.
            with duplicate.lock:
                return self._public(duplicate)
        try:
            self._execute(entry, entry.state)
            response = self._public(entry)
            if response.status in {"blocked", "failed"}:
                error = response.errors[0]
                fault = WorkflowFault(error.code, error.message, 422 if response.status == "blocked" else 500, error.node)
                fault.workflow = response
                raise fault
            return response
        finally:
            entry.lock.release()

    def _create(self, request: WorkflowStart, hashed: str, fingerprint: str) -> WorkflowEntry:
        """Build and publish a new, locked entry; caller holds the registry lock."""
        now, workflow_id = self.clock(), str(uuid4())
        entry = WorkflowEntry(workflow_id, hashed, str(request.client_request_id), fingerprint, request.request_revision, now, now + self.ttl_seconds, {
            "workflow_id": workflow_id, "request_revision": request.request_revision, "snapshot_hash": fingerprint,
            "request": request.comparison.model_dump(mode="json"), "status": "processing", "current_node": "intake_validation",
            "completed_nodes": [], "human_review_status": "not_requested", "errors": [], "validation_notes": [], "retry_count": 0,
        })
        entry.graph = make_graph(entry.checkpointer)
        entry.graph.step_timeout = 10
        # Acquire before publishing, so a duplicate concurrent start cannot
        # observe the internal processing state before first execution.
        entry.lock.acquire()
        self.entries[workflow_id] = entry
        return entry

    def get(self, workflow_id, owner):
        entry = self._find(workflow_id, owner)
        with entry.lock:
            self._expire(entry)
            return self._public(entry)

    def resume(self, workflow_id, request: WorkflowResume, owner):
        entry = self._find(workflow_id, owner)
        with entry.lock:
            self._expire(entry)
            if entry.state["status"] in {"cancelled", "expired"}:
                raise WorkflowFault("workflow_" + entry.state["status"], "This workflow is cancelled or expired. Start a new workflow from current reviewed documents.", 410)
            if entry.state["status"] != "waiting_for_review":
                raise WorkflowFault("workflow_not_waiting", "This workflow is not awaiting review. Inspect its current status; do not repeat resume.", 409)
            if request.request_revision != entry.state["request_revision"] or request.snapshot_hash != entry.fingerprint or snapshot_hash(request.comparison) != entry.fingerprint:
                raise WorkflowFault("workflow_stale", "Candidate, job source or reviewed requirements changed. Review the current documents and start a new workflow.", 409)
            validate_minimization(request.comparison)
            self._execute(entry, Command(resume={"acknowledged": True, "request_revision": request.request_revision, "snapshot_hash": request.snapshot_hash}))
            response = self._public(entry)
            if response.status == "failed":
                error = response.errors[0]
                fault = WorkflowFault(error.code, error.message, 422, error.node)
                fault.workflow = response
                raise fault
            return response

    def cancel(self, workflow_id, owner):
        entry = self._find(workflow_id, owner)
        with entry.lock:
            self._expire(entry)
            if entry.state["status"] == "expired":
                return self._public(entry)
            if entry.state["status"] == "completed":
                raise WorkflowFault("workflow_completed", "The report is already finalized. Start a new workflow for current documents.", 409)
            if entry.state["status"] == "cancelled":
                return self._public(entry)
            previous = entry.state["status"]
            updates = {"status": "cancelled"}
            if previous in {"blocked", "failed"}:
                # Keep the original errors and failed step visible: cancelling a
                # stopped workflow must not hide why it stopped.
                updates["cancelled_from"] = previous
                updates["validation_notes"] = [*entry.state.get("validation_notes", []), f"Cancelled after the workflow was {previous}; the original error is retained."]
            entry.state.update(updates)
            self._purge(entry, clear_result=True)
            return self._public(entry)

    def _public(self, entry):
        state = entry.state
        status = state["status"]
        steps = []
        for node in NODES:
            step_status = "completed" if node in state.get("completed_nodes", []) else "pending"
            if node == state.get("current_node") and status == "waiting_for_review":
                step_status = "waiting_for_review"
            elif node == state.get("current_node") and (status in {"blocked", "failed"} or state.get("cancelled_from")):
                step_status = "failed"
            elif step_status == "pending" and status in {"cancelled", "expired"}:
                step_status = "cancelled"
            steps.append({"node": node, "status": step_status, "note": STEP_NOTES[node]})
        return WorkflowResponse(
            workflow_id=entry.workflow_id, request_revision=state["request_revision"], snapshot_hash=entry.fingerprint,
            status=status, current_node=state.get("current_node"), steps=steps,
            human_review_status=state.get("human_review_status", "not_requested"),
            comparison=state.get("comparison_result") if status in {"waiting_for_review", "completed"} else None,
            errors=state.get("errors", []), validation_notes=state.get("validation_notes", []),
            created_at=iso(entry.created), expires_at=iso(entry.expires),
        )
