import { Link } from "react-router-dom";
import { ArrowUpRight, Bot, CheckCircle2, Circle, CircleAlert, Clock3, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { ComparisonResults } from "../components/ComparisonResults";
import { AgentGraph } from "../components/AgentGraph";
import { Skeleton } from "../components/ui";
import { useAgentSession } from "../agentSession";
import type { AgentNode, AgentWorkflow } from "../agentTypes";
import { comparisonBlockers } from "../comparison";
import { useJobSession } from "../jobSession";
import { useSession } from "../session";
import "../jobAnalysis.css";
import "../agents.css";

const nodeLabels: Record<AgentNode, string> = {
  intake_validation: "Intake validation",
  candidate_preparation: "Candidate evidence preparation",
  job_preparation: "Job evidence preparation",
  evidence_comparison: "Evidence comparison",
  evidence_verification: "Evidence verification",
  human_review: "Human review",
  final_report: "Final report",
};
const stepLabels = { pending: "Pending", completed: "Completed", waiting_for_review: "Waiting for review", failed: "Failed", cancelled: "Cancelled" };
const workflowLabels: Record<AgentWorkflow["status"], string> = { waiting_for_review: "Paused for human review", completed: "Completed", blocked: "Blocked", failed: "Failed", cancelled: "Cancelled", expired: "Expired" };
const statusTone: Record<AgentWorkflow["status"], string> = { waiting_for_review: "review", completed: "documented", blocked: "stopped", failed: "stopped", cancelled: "neutral", expired: "neutral" };

function Timeline({ workflow, busy }: { workflow: AgentWorkflow; busy: boolean }) {
  return <section className="card agent-timeline" aria-label="Execution timeline">
    <div className="section-title"><div><h2>Execution timeline</h2><p>Statuses reported by the backend graph. No simulated progress.</p></div><span className="badge violet">LangGraph</span></div>
    <AgentGraph workflow={workflow} busy={busy} />
    <ol className="agent-steps">{workflow.steps.map((step, index) => {
      const Icon = step.status === "completed" ? CheckCircle2 : step.status === "waiting_for_review" ? Clock3 : ["failed", "cancelled"].includes(step.status) ? XCircle : Circle;
      return <li key={step.node} className={`agent-step ${step.status}`}><span className="agent-step-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span><Icon size={18} aria-hidden="true" /><div><strong>{nodeLabels[step.node]}</strong><p>{step.note}</p></div><span className="agent-step-status">{stepLabels[step.status]}</span></li>;
    })}</ol>
  </section>;
}

/** Shown before any workflow exists: the same graph at rest, or a skeleton while the first run executes. */
function GraphPreview({ starting }: { starting: boolean }) {
  return <div className="card agent-preview">
    <div className="agent-preview-head">
      <span className="eyebrow">THE GRAPH</span>
      <p>Seven deterministic nodes. Execution pauses at <span className="mono">human_review</span> until a person inspects the evidence.</p>
    </div>
    <AgentGraph workflow={null} busy={starting} />
    {starting && <div className="skeleton-stack agent-preview-skeleton" aria-hidden="true"><Skeleton width="42%" height={16} /><Skeleton width="88%" /><Skeleton width="64%" /></div>}
  </div>;
}

export function AIAgents() {
  const { candidates } = useSession();
  const { state, setState } = useJobSession();
  const { workflow, busy, error, acknowledged, setAcknowledged, start, resume, refresh, cancel } = useAgentSession();
  const selected = candidates.find((entry) => entry.id === state.selectedId);
  const problems = comparisonBlockers({ candidates, selectedId: state.selectedId, analysis: state.analysis, requirements: state.requirements, requirementsConfirmed: state.requirementsConfirmed, busy: null });
  const waiting = workflow?.status === "waiting_for_review";
  const completed = workflow?.status === "completed";
  const showEvidence = (waiting || completed) && workflow?.comparison && state.analysis;
  return <div className="agents-page">
    <div className="page-heading"><div><span className="eyebrow">SOURCE-GROUNDED ORCHESTRATION</span><h1>AI Agents</h1><p>A bounded LangGraph workflow with an explicit human review checkpoint.</p></div><span className="badge violet"><Bot size={14} aria-hidden="true" /> Local workflow</span></div>
    <div className="notice info agent-boundary"><ShieldCheck size={20} aria-hidden="true" /><div><strong>Deterministic orchestration, reviewed by people</strong><p>The graph reuses the current document evidence services. It does not improve extraction automatically or verify expertise. No external model is called. Reviews are local, unauthenticated assertions.</p></div></div>

    <div className="agent-layout">
      <section className="card agent-setup" aria-label="Workflow creation">
        <div className="section-title"><div><h2>Prepare an evidence workflow</h2><p>Reuse the candidate and reviewed job from Job Analysis.</p></div><Link to="/matching" className="text-button">Open Job Analysis<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        <div className="agent-setup-body">
          <div className="agent-input-grid">
            <div className="agent-field"><label htmlFor="agent-candidate">Candidate for workflow</label><select id="agent-candidate" value={selected?.id ?? ""} disabled={!!busy} onChange={(event) => { const selectedId = event.target.value; setState((current) => ({ ...current, selectedId, comparison: null, revision: current.revision + 1, view: current.view === "results" ? "requirements" : current.view })); }}><option value="">Select a session candidate</option>{candidates.map((entry) => <option key={entry.id} value={entry.id}>{(entry.reviewedCandidate ?? entry.candidate).full_name ?? "Name not extracted"} — {entry.confirmed && entry.reviewedCandidate ? "Confirmed review" : "Awaiting review"}</option>)}</select>{selected && <Link className="text-button agent-review-link" to={`/candidates/${selected.id}`}>{selected.confirmed ? "Revisit candidate profile" : "Review selected candidate"}</Link>}{!candidates.length && <Link className="text-button agent-review-link" to="/parser">Upload a CV</Link>}</div>
            <div className="agent-job-context"><span className="agent-field-label">Current job analysis</span><strong>{state.analysis?.job.title ?? (state.analysis ? "Reviewed job description" : "No job analyzed")}</strong><p>{state.analysis ? `${state.requirements.length} source clauses · ${state.requirementsConfirmed ? "Job review acknowledged" : "Requirements review needed"}` : "Analyze a job description, inspect its requirements and acknowledge the review in Job Analysis."}</p></div>
          </div>
          <section className={`agent-prerequisites${problems.length ? "" : " ready"}`} aria-label="Workflow prerequisites" aria-live="polite">{problems.length ? <><strong><CircleAlert size={16} aria-hidden="true" />Complete these steps before starting:</strong><ul>{problems.map((problem) => <li key={problem.code}>{problem.message}</li>)}</ul></> : <p><CheckCircle2 size={17} aria-hidden="true" /> The candidate and job review assertions are ready. Evidence will pause for another inspection before the final report.</p>}</section>
          <div className="agent-actions"><button className={`button primary${busy === "start" ? " is-busy" : ""}`} type="button" onClick={() => void start()} disabled={!!busy || problems.length > 0 || waiting}>{busy === "start" ? <span className="busy-dot" aria-hidden="true" /> : <Bot size={17} aria-hidden="true" />}{busy === "start" ? "Executing graph…" : "Start evidence workflow"}</button>{waiting && <span className="agent-action-hint">Inspect the pending evidence below, then resume or cancel this workflow.</span>}</div>
          <p className="agent-retention">Temporary browser and backend memory only. Refresh clears this browser session; backend checkpoints expire and do not survive a backend restart.</p>
        </div>
      </section>
      {!workflow && <GraphPreview starting={busy === "start"} />}
    </div>

    {error && <div className="notice error" role="alert">{error}</div>}
    {workflow && <>
      <section className={`card agent-status tone-${statusTone[workflow.status]}`} aria-label="Workflow status"><div><span className="eyebrow">CURRENT WORKFLOW</span><h2>{workflowLabels[workflow.status]}</h2><p className="agent-workflow-id"><span>Workflow</span> <span className="mono">{workflow.workflow_id}</span></p></div><div className="agent-actions"><button type="button" className="button secondary" disabled={!!busy} onClick={() => void refresh()}><RefreshCw size={16} aria-hidden="true" />Refresh workflow status</button>{waiting && <button type="button" className="button ghost" disabled={!!busy} onClick={() => void cancel()}>Cancel workflow</button>}</div><p className="agent-expiry">Expires {new Date(workflow.expires_at).toLocaleString()}. Status refresh reads the checkpoint without executing nodes.</p></section>
      <Timeline workflow={workflow} busy={busy === "resume"} />
      {workflow.errors.length > 0 && <section className="notice error" role="alert"><div><strong>The graph could not finalize this evidence</strong><ul>{workflow.errors.map((issue, index) => <li key={index}>{issue.message}{issue.node ? ` (${nodeLabels[issue.node]})` : ""}</li>)}</ul><p>Review the source documents and confirmations, then start a new workflow. A processing error does not establish a missing qualification.</p></div></section>}
      {workflow.status === "cancelled" && <div className="notice info" role="status">Workflow cancelled. Its checkpoint evidence is no longer available. You can start a new workflow with the current reviewed documents.</div>}
      {workflow.status === "expired" && <div className="notice info" role="status">Workflow expired. Review the current documents and start a new workflow.</div>}
      {showEvidence && <section className="agent-report" aria-label={completed ? "Final evidence report" : "Pending evidence review"}>
        <div className="agent-report-head"><span className="eyebrow">{completed ? "GRAPH FINALIZED" : "LANGGRAPH INTERRUPT"}</span><h2>{completed ? "Final evidence report" : "Evidence awaiting human review"}</h2><p>{completed ? "The graph finalized the inspected evidence after a local review assertion. Document statuses describe submitted evidence, not ability or eligibility." : "Execution is paused at the human review checkpoint. Inspect requirement evidence, source spans and interpretation notes before continuing."}</p></div>
        <ComparisonResults result={workflow.comparison!} analysis={state.analysis!} />
        {waiting && <section className="card agent-human-review" aria-label="Human review acknowledgment"><div className="agent-human-review-mark" aria-hidden="true"><ShieldCheck size={22} /></div><div className="agent-human-review-body"><h3>Inspect, acknowledge and resume</h3><p>This is a local, unverified review assertion. It is not an authenticated approval, credential check or hiring recommendation. Resuming does not change the source evidence.</p><label className="agent-acknowledgment"><input type="checkbox" checked={acknowledged} disabled={!!busy} onChange={(event) => setAcknowledged(event.target.checked)} /><span>I inspected the source evidence and acknowledge this local review assertion.</span></label><button type="button" className={`button primary${busy === "resume" ? " is-busy" : ""}`} onClick={() => void resume()} disabled={!acknowledged || !!busy || problems.length > 0}>{busy === "resume" ? <span className="busy-dot" aria-hidden="true" /> : <ShieldCheck size={17} aria-hidden="true" />}Review &amp; Resume</button></div></section>}
      </section>}
      {workflow.validation_notes.length > 0 && <details className="card agent-validation"><summary>Verification and lifecycle notes ({workflow.validation_notes.length})</summary><ul>{workflow.validation_notes.map((note, index) => <li key={index}>{note}</li>)}</ul></details>}
    </>}
  </div>;
}
