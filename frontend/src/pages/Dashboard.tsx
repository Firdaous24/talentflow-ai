import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, Ban, ChevronRight, FileText, FlaskConical, Scale, ShieldCheck, UserCheck } from "lucide-react";
import { api, ApiError } from "../api";
import { ConnectionBadge } from "../components/ConnectionBadge";
import { useToast } from "../components/Toast";
import { useWorkflowSteps } from "../components/WorkflowStepper";
import { AnimatedNumber, EmptyState, StatusPill } from "../components/ui";
import type { EvidenceStatus } from "../components/ui";
import { buildDemoCvFile, DEMO_JOB } from "../demo";
import { emptyJobSession, useJobSession } from "../jobSession";
import { useSession } from "../session";
import "../dashboard.css";

const stepPill: Record<string, { status: EvidenceStatus; label: string }> = {
  done: { status: "documented", label: "Done" },
  current: { status: "accent", label: "Next" },
  todo: { status: "neutral", label: "Later" },
  blocked: { status: "needs_review", label: "Needs attention" },
};

/** Decorative preview of the evidence view: a job clause and a CV excerpt with exact highlighted spans. */
function EvidenceSlip() {
  return (
    <figure className="evidence-slip" aria-hidden="true">
      <div className="slip-sheet slip-job">
        <span className="slip-kind">Job post · req-001</span>
        <p>Python and <mark>SQL</mark> are required.</p>
        <span className="slip-offset">chars 11–14</span>
      </div>
      <div className="slip-link"><i /><span>exact match</span><i /></div>
      <div className="slip-sheet slip-cv">
        <span className="slip-kind">CV · experience.0.description</span>
        <p>Built <mark>SQL</mark> dashboards using Python for a fictional retail team.</p>
        <span className="slip-offset">chars 6–9</span>
      </div>
      <div className="slip-footer">
        <StatusPill status="documented">Documented in profile</StatusPill>
        <span>Unverified · reviewed by a person</span>
      </div>
    </figure>
  );
}

export function Dashboard() {
  const { candidates, connection, checkHealth, addCandidate } = useSession();
  const { state, setState } = useJobSession();
  const notify = useToast();
  const steps = useWorkflowSteps();
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState<string | null>(null);
  // Navigation is rendered, not imperatively triggered after an await, so it
  // always commits inside React's lifecycle.
  const [demoTarget, setDemoTarget] = useState<string | null>(null);
  const confirmed = candidates.filter((entry) => entry.confirmed).length;

  async function startDemo() {
    if (demoBusy) return;
    setDemoBusy(true);
    setDemoError(null);
    try {
      const file = buildDemoCvFile();
      const entry = addCandidate(await api.parse(file), file.name);
      // Prefill the sample job and select the demo profile. Selecting does not confirm it.
      setState((current) => ({ ...emptyJobSession(), selectedId: entry.id, text: DEMO_JOB, revision: current.revision + 1 }));
      notify("Fictional CV parsed. Review and confirm the profile; the sample job post is ready in Job Analysis.", "success");
      setDemoTarget(`/candidates/${entry.id}`);
    } catch (error) {
      const message = error instanceof ApiError || error instanceof Error ? error.message : "The demo could not start.";
      setDemoError(`${message} Check that the local API is running, then try again.`);
      notify("The demo could not start. Check the backend connection.", "error");
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div className="dashboard">
      {demoTarget && <Navigate to={demoTarget} />}
      <section className="dash-hero">
        <div className="dash-hero-copy">
          <span className="eyebrow">YOUR RECRUITMENT WORKSPACE</span>
          <h1>A clearer view of talent.</h1>
          <p className="dash-lead">Turn CVs and job posts into evidence you can trace to the exact characters of each document. People review every step. Nothing is scored, ranked or decided for you.</p>
          <div className="dash-actions">
            <button type="button" className={`button primary dash-demo${demoBusy ? " is-busy" : ""}`} onClick={() => void startDemo()} disabled={demoBusy}>
              {demoBusy ? <span className="busy-dot" aria-hidden="true" /> : <FlaskConical size={17} aria-hidden="true" />}
              {demoBusy ? "Preparing fictional data…" : "Try with fictional data"}
            </button>
            <Link to="/parser" className="button secondary"><FileText size={17} aria-hidden="true" />Parse a CV</Link>
          </div>
          <p className="dash-demo-note">The demo generates a fictional CV and job post in your browser. Nothing is stored, and you still review and confirm every step.</p>
          {demoError && <div className="notice error" role="alert">{demoError}</div>}
        </div>
        <EvidenceSlip />
      </section>

      <section className="dash-session" aria-labelledby="dash-session-title">
        <div className="dash-section-head"><h2 id="dash-session-title">This session</h2><p>Temporary browser memory. Refresh to clear it.</p></div>
        <div className="dash-stats">
          <div className="dash-stat"><span className="dash-stat-label">CVs parsed</span><strong><AnimatedNumber value={candidates.length} /></strong><span className="dash-stat-note">{confirmed} confirmed by a reviewer</span></div>
          <div className="dash-stat"><span className="dash-stat-label">Job criteria</span><strong><AnimatedNumber value={state.analysis ? state.requirements.length : 0} /></strong><span className="dash-stat-note">{state.analysis ? (state.requirementsConfirmed ? "Review acknowledged" : "Waiting for your review") : "No job analyzed yet"}</span></div>
          <div className="dash-stat"><span className="dash-stat-label">Evidence rows</span><strong><AnimatedNumber value={state.comparison?.comparisons.length ?? 0} /></strong><span className="dash-stat-note">{state.comparison ? "Checklist ready to read" : "Compared after both reviews"}</span></div>
          <div className="dash-stat dash-stat-api"><span className="dash-stat-label">API connection</span><ConnectionBadge /><span className="dash-stat-note">Liveness checked every minute.</span><button type="button" className="text-button" onClick={() => void checkHealth()} disabled={connection === "checking"}>Check connection</button></div>
        </div>
      </section>

      <section className="dash-path" aria-labelledby="dash-path-title">
        <div className="dash-section-head"><h2 id="dash-path-title">Your path through the evidence</h2><p>Each step opens the page where its review happens.</p></div>
        <ol className="dash-steps">
          {steps.map((step, index) => (
            <li key={step.id} className={`dash-step ${step.status}`}>
              <Link to={step.to}>
                <span className="dash-step-number">{String(index + 1).padStart(2, "0")}</span>
                <span className="dash-step-body"><strong>{step.description}</strong><span>{step.summary}</span></span>
                <span className="dash-step-foot"><StatusPill status={stepPill[step.status].status}>{stepPill[step.status].label}</StatusPill><ArrowRight size={16} aria-hidden="true" /></span>
              </Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="dash-principles" aria-labelledby="dash-principles-title">
        <h2 id="dash-principles-title" className="visually-hidden">Principles</h2>
        <div className="dash-principle"><Scale size={22} aria-hidden="true" /><h3>Evidence, not scores</h3><p>Three statuses: documented, not documented, needs review. No percentage, ranking or match score anywhere.</p></div>
        <div className="dash-principle"><UserCheck size={22} aria-hidden="true" /><h3>A person at every gate</h3><p>Profiles and job criteria are confirmed by a reviewer before any comparison. The agent workflow pauses for you.</p></div>
        <div className="dash-principle"><Ban size={22} aria-hidden="true" /><h3>Absence is not a flaw</h3><p>“Not documented” means the CV does not mention it. It never means the person lacks the skill.</p></div>
        <div className="dash-principle"><ShieldCheck size={22} aria-hidden="true" /><h3>Local and private</h3><p>Loopback only, nothing persisted. No external model is called without configuration and your consent.</p></div>
      </section>

      <section className="card dash-activity" aria-labelledby="dash-activity-title">
        <div className="section-title"><div><h2 id="dash-activity-title">Recent activity</h2><p>Your parsing activity, for this session.</p></div><span className="badge neutral">SESSION ONLY</span></div>
        {candidates.length ? (
          <ul className="dash-activity-list">
            {candidates.slice(0, 5).map((entry) => {
              const profile = entry.reviewedCandidate ?? entry.candidate;
              return (
                <li key={entry.id}>
                  <Link to={`/candidates/${entry.id}`}>
                    <span className="dash-activity-mark" aria-hidden="true">{(profile.full_name ?? "?").slice(0, 1)}</span>
                    <span className="dash-activity-text"><strong>{profile.full_name ?? "Name not extracted"}</strong><span className="mono">{entry.filename}</span></span>
                    {entry.confirmed ? <StatusPill status="documented">Confirmed review</StatusPill> : <StatusPill status="needs_review">Awaiting review</StatusPill>}
                    <ChevronRight size={16} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState title="Your workspace is ready" action={<button type="button" className="text-button" onClick={() => void startDemo()} disabled={demoBusy}>Start with the fictional demo</button>}>
            Parse a CV or try the demo. Profiles stay in this browser session only.
          </EmptyState>
        )}
      </section>
    </div>
  );
}
