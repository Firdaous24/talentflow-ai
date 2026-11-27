"""One real seven-node StateGraph with bounded retry and genuine interrupt/resume."""

from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt
from pydantic import ValidationError

from app.agents.errors import WorkflowFault
from app.agents.state import WorkflowState
from app.agents.verification import snapshot_hash, validate_minimization, verify_evidence
from app.models.job import JobAnalyzeRequest, JobComparisonRequest, JobComparisonResponse
from app.services.jobs import DeterministicJobAnalyzer, JobWorkflowError, compare_job, validate_review

NODES = (
    "intake_validation", "candidate_preparation", "job_preparation",
    "evidence_comparison", "evidence_verification", "human_review", "final_report",
)


def complete(state, node, **updates):
    return {"completed_nodes": [*state.get("completed_nodes", []), node], "current_node": node, **updates}


def failure(state, node, fault, blocked=False):
    return {
        "status": "blocked" if blocked else "failed", "current_node": node,
        "errors": [{"code": fault.code, "message": fault.message, "node": node, "recoverable": False}],
    }


def intake(state):
    try:
        request = JobComparisonRequest.model_validate(state["request"])
        JobAnalyzeRequest(text=request.job_analysis.job.text)
        validate_minimization(request)
        if snapshot_hash(request) != state["snapshot_hash"]:
            raise WorkflowFault("workflow_stale", "The workflow snapshot is inconsistent. Start again from current reviewed documents.")
        return complete(state, "intake_validation", validation_notes=["Qualification-only schema and local privacy boundaries validated."])
    except WorkflowFault as error:
        return failure(state, "intake_validation", error, True)
    except ValidationError:
        return failure(state, "intake_validation", WorkflowFault("workflow_validation", "The submitted documents do not satisfy the source input constraints. Review the source and start a new workflow."), True)


def candidate(state):
    request = JobComparisonRequest.model_validate(state["request"])
    if not request.review.candidate_confirmed:
        return failure(state, "candidate_preparation", WorkflowFault("candidate_review_required", "Review and confirm the candidate profile before starting the workflow."), True)
    if request.candidate != request.review.candidate_snapshot:
        return failure(state, "candidate_preparation", WorkflowFault("review_stale", "Candidate qualifications changed after confirmation. Review and confirm the current profile."), True)
    return complete(state, "candidate_preparation")


def job(state):
    request = JobComparisonRequest.model_validate(state["request"])
    if not request.review.requirements_reviewed:
        return failure(state, "job_preparation", WorkflowFault("job_review_required", "Review the current job requirements before starting the workflow."), True)
    try:
        validate_review(request, DeterministicJobAnalyzer())
        return complete(state, "job_preparation")
    except JobWorkflowError as error:
        return failure(state, "job_preparation", error, True)


def compare(state):
    try:
        result = compare_job(JobComparisonRequest.model_validate(state["request"]))
        return complete(state, "evidence_comparison", comparison_result=result.model_dump(), status="processing")
    except (TimeoutError, ConnectionError):
        retries = state.get("retry_count", 0)
        if retries < 1:
            return {"retry_count": retries + 1, "status": "retrying", "current_node": "evidence_comparison", "validation_notes": [*state.get("validation_notes", []), "A recoverable comparison interruption was retried once."]}
        return failure(state, "evidence_comparison", WorkflowFault("processing_unavailable", "Comparison processing failed after one bounded retry. Start a new workflow when the service is available."))
    except JobWorkflowError as error:
        return failure(state, "evidence_comparison", error)
    except Exception:
        # Never expose repr(error), document text or provider details in traces.
        return failure(state, "evidence_comparison", WorkflowFault("processing_failed", "The comparison step failed. No report was finalized. Start a new workflow."))


def verify(state):
    try:
        verify_state(state)
        return complete(state, "evidence_verification", current_node="human_review", status="waiting_for_review", human_review_status="required", validation_notes=[*state.get("validation_notes", []), "Source spans, reviewed snapshots, qualification paths, row rules and technical references verified."])
    except (WorkflowFault, JobWorkflowError) as error:
        return failure(state, "evidence_verification", error)
    except Exception:
        return failure(state, "evidence_verification", WorkflowFault("evidence_inconsistent", "Comparison evidence could not be verified. No report was finalized."))


def human(state):
    assertion = interrupt({
        "workflow_id": state["workflow_id"], "snapshot_hash": state["snapshot_hash"],
        "review_required": True, "review_assertion": "unverified_client_assertion",
    })
    if not isinstance(assertion, dict) or assertion != {"acknowledged": True, "request_revision": state["request_revision"], "snapshot_hash": state["snapshot_hash"]}:
        return failure(state, "human_review", WorkflowFault("review_assertion_invalid", "A current explicit local review acknowledgment is required."))
    return complete(state, "human_review", human_review_status="acknowledged", status="processing")


def finalize(state):
    try:
        # A resumed checkpoint must satisfy the same complete source checks.
        verify_state(state)
        return complete(state, "final_report", status="completed", validation_notes=[*state.get("validation_notes", []), "Evidence verified again after explicit local review; this assertion is not authenticated approval."])
    except (WorkflowFault, JobWorkflowError) as error:
        return failure(state, "final_report", error)
    except Exception:
        return failure(state, "final_report", WorkflowFault("evidence_inconsistent", "Final evidence verification failed. Start a new workflow from current reviewed documents."))


def verify_state(state):
    request = JobComparisonRequest.model_validate(state["request"])
    if snapshot_hash(request) != state["snapshot_hash"]:
        raise WorkflowFault("workflow_stale", "The checkpoint no longer matches the reviewed document snapshot. Start a new workflow.")
    verify_evidence(request, JobComparisonResponse.model_validate(state["comparison_result"]))


def route(state):
    return "stop" if state.get("status") in {"blocked", "failed"} else "continue"


def comparison_route(state):
    if state.get("status") == "retrying":
        return "retry"
    return route(state)


def make_graph(checkpointer):
    builder = StateGraph(WorkflowState)
    for name, function in zip(NODES, (intake, candidate, job, compare, verify, human, finalize)):
        builder.add_node(name, function)
    builder.add_edge(START, NODES[0])
    for current, following in zip(NODES, NODES[1:]):
        if current == "evidence_comparison":
            builder.add_conditional_edges(current, comparison_route, {"stop": END, "continue": following, "retry": current})
        else:
            builder.add_conditional_edges(current, route, {"stop": END, "continue": following})
    builder.add_edge(NODES[-1], END)
    return builder.compile(checkpointer=checkpointer)
