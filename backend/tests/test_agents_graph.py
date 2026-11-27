"""Fictional, source-grounded tests of real LangGraph execution and lifecycle."""

from copy import deepcopy
from uuid import uuid4

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from app.agents.checkpoints import WorkflowManager, snapshot_hash
from app.agents.errors import WorkflowFault
from app.agents.graph import NODES, make_graph
from app.agents.schemas import WorkflowResume, WorkflowStart
from app.agents.verification import verify_evidence
from app.models.job import CandidateEvidenceExcerpt, JobComparisonRequest
from app.services.jobs import DeterministicJobAnalyzer, compare_job

OWNER = "a" * 64


def request_body(text="Fictional Platform Engineer\nTechnical Environment\nPython / Airflow / GCP"):
    analysis = DeterministicJobAnalyzer().analyze(text)
    requirements = [{key: getattr(item, key) for key in ("id", "text", "category", "classification")} for item in analysis.requirements]
    candidate = {"technical_skills": [{"name": "Python", "category": "programming_language"}], "projects": [{"name": "Fictional pipeline", "description": "Built an Airflow pipeline. A separate SQL practice exercise."}]}
    return JobComparisonRequest.model_validate({
        "candidate": candidate, "job_analysis": analysis, "requirements": requirements,
        "review": {"candidate_confirmed": True, "candidate_snapshot": deepcopy(candidate), "requirements_reviewed": True, "requirement_snapshot": deepcopy(requirements)},
    })


def start_request(comparison=None, **updates):
    return WorkflowStart(comparison=comparison or request_body(), request_revision="revision-1", client_request_id=uuid4(), **updates)


def resume_request(start, workflow, **updates):
    values = {"acknowledged": True, "request_revision": start.request_revision, "snapshot_hash": workflow.snapshot_hash, "comparison": start.comparison}
    values.update(updates)
    return WorkflowResume.model_validate(values)


def test_real_compilation_order_checkpoint_interrupt_and_command_resume():
    saver = InMemorySaver()
    graph = make_graph(saver)
    assert isinstance(graph, CompiledStateGraph)
    assert set(graph.get_graph().nodes) == {"__start__", "__end__", *NODES}
    request = request_body()
    config = {"configurable": {"thread_id": "fictional-graph"}, "recursion_limit": 16}
    state = {"workflow_id": "fictional-graph", "request_revision": "1", "snapshot_hash": snapshot_hash(request), "request": request.model_dump(), "completed_nodes": [], "errors": [], "validation_notes": [], "status": "processing"}
    output = graph.invoke(state, config)
    assert output["__interrupt__"]
    checkpoint = graph.get_state(config)
    assert checkpoint.next == ("human_review",)
    assert checkpoint.tasks[0].interrupts
    assert checkpoint.values["completed_nodes"] == list(NODES[:5])
    assert checkpoint.values["status"] == "waiting_for_review"
    assert list(saver.list(config))
    final = graph.invoke(Command(resume={"acknowledged": True, "request_revision": "1", "snapshot_hash": snapshot_hash(request)}), config)
    assert final["status"] == "completed"
    assert final["completed_nodes"] == list(NODES)
    assert graph.get_state(config).next == ()
    assert final["comparison_result"] == compare_job(request).model_dump()


def test_manager_preserves_existing_environment_semantics_and_exact_evidence():
    manager = WorkflowManager()
    start = start_request()
    workflow = manager.start(start, OWNER)
    assert workflow.status == "waiting_for_review"
    assert workflow.human_review_status == "required"
    assert [step.status for step in workflow.steps] == ["completed"] * 5 + ["waiting_for_review", "pending"]
    assert workflow.comparison == compare_job(start.comparison)
    assert all(row.status == "needs_review" and row.origin == "technical_environment" for row in workflow.comparison.comparisons)
    assert {item.name for item in workflow.comparison.technical_evidence} == {"Python", "Airflow", "GCP"}
    assert not next(item for item in workflow.comparison.technical_evidence if item.name == "GCP").candidate_evidence
    assert "candidate" not in workflow.model_dump()


def test_resume_completes_once_reads_do_not_execute_and_checkpoint_inputs_are_purged(monkeypatch):
    from app.agents import graph as graph_module
    calls = []
    original = graph_module.compare_job

    def counted(request):
        calls.append(1)
        return original(request)

    monkeypatch.setattr(graph_module, "compare_job", counted)
    manager = WorkflowManager()
    start = start_request()
    waiting = manager.start(start, OWNER)
    assert manager.start(start, OWNER) == waiting
    for _ in range(3):
        assert manager.get(waiting.workflow_id, OWNER) == waiting
    entry = manager.entries[waiting.workflow_id]
    assert entry.graph.get_state(entry.config).tasks[0].interrupts
    done = manager.resume(waiting.workflow_id, resume_request(start, waiting), OWNER)
    assert done.status == "completed"
    assert done.human_review_status == "acknowledged"
    assert all(step.status == "completed" for step in done.steps)
    assert calls == [1]
    assert "request" not in entry.state
    assert not list(entry.checkpointer.list(entry.config))
    assert manager.get(done.workflow_id, OWNER) == done
    with pytest.raises(WorkflowFault, match="not awaiting review") as caught:
        manager.resume(done.workflow_id, resume_request(start, waiting), OWNER)
    assert caught.value.status_code == 409
    assert calls == [1]


@pytest.mark.parametrize("field,node,code", [("candidate_confirmed", "candidate_preparation", "candidate_review_required"), ("requirements_reviewed", "job_preparation", "job_review_required")])
def test_missing_confirmations_are_real_blocked_conditional_routes(field, node, code):
    manager = WorkflowManager()
    start = start_request()
    setattr(start.comparison.review, field, False)
    with pytest.raises(WorkflowFault) as caught:
        manager.start(start, OWNER)
    failure = caught.value.workflow
    assert failure.status == "blocked"
    assert failure.current_node == node
    assert failure.errors[0].code == code
    assert failure.comparison is None
    entry = manager.entries[failure.workflow_id]
    assert "request" not in entry.state
    assert not list(entry.checkpointer.list(entry.config))
    assert not any(step.node == "evidence_comparison" and step.status == "completed" for step in failure.steps)


@pytest.mark.parametrize("target", ["candidate", "requirements", "source", "origin", "offset"])
def test_invalid_original_review_source_blocks_before_comparison(target):
    manager = WorkflowManager()
    start = start_request()
    request = start.comparison
    if target == "candidate":
        request.candidate.projects[0].description = "Changed fictional exercise."
    elif target == "requirements":
        request.requirements[0].classification = "required"
    elif target == "source":
        request.job_analysis.job.text += "\nRequired SQL experience."
    elif target == "origin":
        request.job_analysis.requirements[0].origin = "qualification"
    else:
        request.job_analysis.requirements[0].evidence[0].start += 1
    with pytest.raises(WorkflowFault) as caught:
        manager.start(start, OWNER)
    assert caught.value.workflow.status == "blocked"
    assert caught.value.workflow.comparison is None
    assert caught.value.code in {"review_stale", "source_mismatch"}


@pytest.mark.parametrize("source", ["!" * 35, "Fictional invalid source with null \x00 value"])
def test_invalid_source_input_routes_to_structured_intake_block(source):
    manager = WorkflowManager()
    start = start_request()
    start.comparison.job_analysis.job.text = source
    with pytest.raises(WorkflowFault) as caught:
        manager.start(start, OWNER)
    assert caught.value.status_code == 422
    assert caught.value.workflow.status == "blocked"
    assert caught.value.workflow.current_node == "intake_validation"
    assert caught.value.code == "workflow_validation"


@pytest.mark.parametrize("target", ["candidate", "source", "requirements", "revision", "hash"])
def test_current_snapshot_required_on_resume_even_when_new_snapshot_is_consistent(target):
    manager = WorkflowManager()
    start = start_request()
    waiting = manager.start(start, OWNER)
    resume = resume_request(start, waiting).model_copy(deep=True)
    if target == "candidate":
        resume.comparison.candidate.projects[0].description = "Edited fictional exercise."
        resume.comparison.review.candidate_snapshot = resume.comparison.candidate.model_copy(deep=True)
    elif target == "source":
        resume.comparison = request_body("Fictional SQL Engineer\nRequirements\nSQL required for data processing.")
    elif target == "requirements":
        resume.comparison.requirements[0].classification = "required"
        resume.comparison.review.requirement_snapshot = deepcopy(resume.comparison.requirements)
    elif target == "revision":
        resume.request_revision = "revision-2"
    else:
        resume.snapshot_hash = "0" * 64
    with pytest.raises(WorkflowFault) as caught:
        manager.resume(waiting.workflow_id, resume, OWNER)
    assert caught.value.code == "workflow_stale"
    assert manager.get(waiting.workflow_id, OWNER).status == "waiting_for_review"
    assert manager.get(waiting.workflow_id, OWNER).human_review_status == "required"


@pytest.mark.parametrize("tamper", ["path", "full_quote", "excerpt", "duplicate", "classification", "origin", "status", "technology", "technical_reference", "technical_duplicate", "interpretation"])
def test_evidence_verifier_rejects_tampering(tamper):
    request = request_body()
    result = compare_job(request).model_copy(deep=True)
    row = result.comparisons[0]
    evidence = row.candidate_evidence[0]
    if tamper == "path":
        evidence.field = "full_name"
    elif tamper == "full_quote":
        evidence.quote = "Invented qualification"
    elif tamper == "excerpt":
        object.__setattr__(evidence, "excerpt", CandidateEvidenceExcerpt.model_construct(quote="invented", start=0, end=8))
    elif tamper == "duplicate":
        row.candidate_evidence.append(evidence.model_copy(deep=True))
    elif tamper == "classification":
        row.classification = "required"
    elif tamper == "origin":
        row.origin = "qualification"
    elif tamper == "status":
        row.status = "documented"
    elif tamper == "technology":
        result.technical_evidence[0].name = "Invented technology"
    elif tamper == "technical_reference":
        result.technical_evidence[0].job_references[0].evidence[0].start += 1
    elif tamper == "technical_duplicate":
        result.technical_evidence.append(result.technical_evidence[0].model_copy(deep=True))
    else:
        result.technical_evidence[0].requires_interpretation = False
    with pytest.raises((WorkflowFault, ValueError)):
        verify_evidence(request, result)


def test_verification_repeated_after_resume_rejects_checkpoint_tampering():
    manager = WorkflowManager()
    start = start_request()
    waiting = manager.start(start, OWNER)
    entry = manager.entries[waiting.workflow_id]
    malicious = deepcopy(entry.graph.get_state(entry.config).values["comparison_result"])
    malicious["comparisons"][0]["status"] = "documented"
    entry.graph.update_state(entry.config, {"comparison_result": malicious})
    with pytest.raises(WorkflowFault) as caught:
        manager.resume(waiting.workflow_id, resume_request(start, waiting), OWNER)
    assert caught.value.workflow.status == "failed"
    assert caught.value.workflow.current_node == "final_report"
    assert caught.value.workflow.comparison is None
    assert not list(entry.checkpointer.list(entry.config))


def test_consistent_replacement_documents_cannot_replace_original_checkpoint_snapshot():
    manager = WorkflowManager()
    start = start_request()
    waiting = manager.start(start, OWNER)
    entry = manager.entries[waiting.workflow_id]
    replacement = request_body("Fictional SQL Engineer\nRequired skills\nSQL required for data processing.")
    entry.graph.update_state(entry.config, {"request": replacement.model_dump(), "comparison_result": compare_job(replacement).model_dump()})
    with pytest.raises(WorkflowFault) as caught:
        manager.resume(waiting.workflow_id, resume_request(start, waiting), OWNER)
    assert caught.value.code == "workflow_stale"
    assert caught.value.workflow.status == "failed"
    assert caught.value.workflow.comparison is None


@pytest.mark.parametrize("failures,expected_calls,status", [(1, 2, "waiting_for_review"), (2, 2, "failed")])
def test_recoverable_comparison_failure_retries_at_most_once(monkeypatch, failures, expected_calls, status):
    from app.agents import graph as graph_module
    original = graph_module.compare_job
    calls = []

    def flaky(request):
        calls.append(1)
        if len(calls) <= failures:
            raise TimeoutError("never publish this detail")
        return original(request)

    monkeypatch.setattr(graph_module, "compare_job", flaky)
    manager = WorkflowManager()
    if status == "failed":
        with pytest.raises(WorkflowFault) as caught:
            manager.start(start_request(), OWNER)
        workflow = caught.value.workflow
    else:
        workflow = manager.start(start_request(), OWNER)
    assert workflow.status == status
    assert len(calls) == expected_calls
    assert "never publish" not in workflow.model_dump_json()
    assert [step.node for step in workflow.steps if step.status == "completed"].count("evidence_comparison") <= 1


def test_nonrecoverable_processing_failure_is_static_and_never_retried(monkeypatch):
    from app.agents import graph as graph_module
    calls = []

    def fail(request):
        calls.append(1)
        raise RuntimeError("private free-text diagnostic")

    monkeypatch.setattr(graph_module, "compare_job", fail)
    manager = WorkflowManager()
    with pytest.raises(WorkflowFault) as caught:
        manager.start(start_request(), OWNER)
    assert calls == [1]
    assert caught.value.workflow.status == "failed"
    assert "private free-text" not in caught.value.workflow.model_dump_json()


def test_capacity_and_idempotency_are_bounded():
    manager = WorkflowManager(max_workflows=1)
    start = start_request()
    waiting = manager.start(start, OWNER)
    assert manager.start(start, OWNER) == waiting
    changed = start.model_copy(deep=True)
    changed.request_revision = "changed"
    with pytest.raises(WorkflowFault) as caught:
        manager.start(changed, OWNER)
    assert caught.value.status_code == 409
    with pytest.raises(WorkflowFault) as caught:
        manager.start(start_request(), OWNER)
    assert caught.value.status_code == 429
    manager.cancel(waiting.workflow_id, OWNER)
    replacement = manager.start(start_request(), OWNER)
    assert replacement.workflow_id != waiting.workflow_id
    assert len(manager.entries) == 1


def test_graph_needs_no_network_or_model_provider(monkeypatch):
    import socket

    from langsmith.run_helpers import get_tracing_context

    from app.agents import graph as graph_module

    def forbidden(*args, **kwargs):
        raise AssertionError("Graph orchestration must not open network connections")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGCHAIN_TRACING_V2", "true")
    original = graph_module.compare_job

    def ensure_no_export(request):
        assert get_tracing_context()["enabled"] is False
        return original(request)

    monkeypatch.setattr(graph_module, "compare_job", ensure_no_export)
    manager = WorkflowManager()
    start = start_request()
    waiting = manager.start(start, OWNER)
    completed = manager.resume(waiting.workflow_id, resume_request(start, waiting), OWNER)
    assert completed.status == "completed"
    serialized = completed.model_dump()
    assert not {"ranking", "score", "recommendation", "hiring_decision"} & serialized.keys()
    assert set(serialized["comparison"]) == {"comparisons", "warnings", "technical_evidence", "review_assertion", "method"}


def test_slow_graph_execution_does_not_block_another_start(monkeypatch):
    import threading

    import app.agents.graph as graph_module

    original = graph_module.compare_job
    started, release, calls = threading.Event(), threading.Event(), []

    def slow_first_compare(request, *args):
        calls.append(1)
        if len(calls) == 1:
            started.set()
            assert release.wait(10), "test gate was never released"
        return original(request, *args)

    monkeypatch.setattr(graph_module, "compare_job", slow_first_compare)
    manager = WorkflowManager()
    results = {}
    slow = threading.Thread(target=lambda: results.__setitem__("slow", manager.start(start_request(), OWNER)))
    slow.start()
    try:
        assert started.wait(5)
        fast = threading.Thread(target=lambda: results.__setitem__("fast", manager.start(start_request(), OWNER)))
        fast.start()
        fast.join(5)
        # Before the fix, the second start waited on the slow entry lock inside cleanup().
        assert not fast.is_alive(), "a slow graph blocked another workflow start"
        assert results["fast"].status == "waiting_for_review"
        assert "slow" not in results
    finally:
        release.set()
        slow.join(10)
    assert results["slow"].status == "waiting_for_review"
    assert results["slow"].workflow_id != results["fast"].workflow_id


def test_cancelling_a_blocked_workflow_keeps_the_original_error():
    manager = WorkflowManager()
    comparison = request_body()
    comparison.review.candidate_confirmed = False
    with pytest.raises(WorkflowFault) as raised:
        manager.start(start_request(comparison), OWNER)
    blocked = raised.value.workflow
    assert blocked.status == "blocked"
    cancelled = manager.cancel(blocked.workflow_id, OWNER)
    assert cancelled.status == "cancelled"
    assert cancelled.errors == blocked.errors
    assert cancelled.errors[0].code == "candidate_review_required"
    steps = {step.node: step.status for step in cancelled.steps}
    assert steps["candidate_preparation"] == "failed"
    assert steps["intake_validation"] == "completed"
    assert all(steps[node] == "cancelled" for node in NODES[2:])
    assert any("original error is retained" in note for note in cancelled.validation_notes)
    assert manager.cancel(blocked.workflow_id, OWNER) == cancelled
