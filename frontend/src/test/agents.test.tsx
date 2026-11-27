import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { agentApi } from "../agentApi";
import { AgentSessionProvider } from "../agentSession";
import type { AgentWorkflow, AgentWorkflowStart } from "../agentTypes";
import { api, ApiError } from "../api";
import { JobSessionProvider, useJobSession } from "../jobSession";
import type { JobComparisonResponse } from "../jobTypes";
import { AIAgents } from "../pages/AIAgents";
import { SessionProvider, useSession } from "../session";
import { syntheticProfile } from "./fixtures";
import { realisticJobAnalysis } from "./jobFixtures";

const nodes: AgentWorkflow["steps"][number]["node"][] = ["intake_validation", "candidate_preparation", "job_preparation", "evidence_comparison", "evidence_verification", "human_review", "final_report"];
const comparison: JobComparisonResponse = {
  comparisons: realisticJobAnalysis.requirements.map((requirement) => ({ requirement_id: requirement.id, requirement_text: requirement.text, original_requirement_text: requirement.text, category: requirement.category, classification: requirement.classification, origin: requirement.origin, status: "needs_review", candidate_evidence: [], job_evidence: requirement.evidence, explanation: "A source mention requires human interpretation.", review_notes: [] })),
  technical_evidence: [], warnings: [], method: "qualification-document-checklist-v1", review_assertion: "unverified_client_assertion",
};
function result(revision: string, status: AgentWorkflow["status"] = "waiting_for_review"): AgentWorkflow {
  return { workflow_id: "a61c4bb1-7c00-49ed-8f69-9f52ee2159e3", request_revision: revision, snapshot_hash: "a".repeat(64), status, current_node: status === "completed" ? null : "human_review", human_review_status: status === "completed" ? "acknowledged" : "required", comparison: ["waiting_for_review", "completed"].includes(status) ? comparison : null, steps: nodes.map((node, index) => ({ node, status: status === "completed" || index < 5 ? "completed" : index === 5 && status === "waiting_for_review" ? "waiting_for_review" : "pending", note: `Backend trace: ${node}` })), errors: [], validation_notes: ["Exact source spans verified.", "Memory checkpoint only."], created_at: "2026-10-16T10:00:00Z", expires_at: "2026-10-16T10:30:00Z", review_assertion: "unverified_client_assertion" };
}
let current: AgentWorkflow;
beforeEach(() => {
  vi.spyOn(api, "health").mockResolvedValue({ status: "ok" });
  vi.spyOn(agentApi, "start").mockImplementation(async (_token, body) => (current = result(body.request_revision)));
  vi.spyOn(agentApi, "resume").mockImplementation(async (_token, _id, body) => (current = result(body.request_revision, "completed")));
  vi.spyOn(agentApi, "status").mockImplementation(async () => current);
  vi.spyOn(agentApi, "cancel").mockImplementation(async () => (current = { ...current, status: "cancelled", comparison: null }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Harness({ confirmed = true, job = true }: { confirmed?: boolean; job?: boolean }) {
  const { addCandidate, reviewCandidate, clearCandidates } = useSession();
  const { setState } = useJobSession();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    const profile = structuredClone(syntheticProfile);
    const candidate = addCandidate(profile, "fictional.pdf");
    if (confirmed) reviewCandidate(candidate.id, profile.candidate, true);
    setState((state) => ({ ...state, selectedId: candidate.id, text: job ? realisticJobAnalysis.job.text : "", analysis: job ? realisticJobAnalysis : null, requirements: job ? realisticJobAnalysis.requirements.map(({ id, text, category, classification }) => ({ id, text, category, classification })) : [], requirementsConfirmed: job }));
  }, [addCandidate, reviewCandidate, setState, confirmed, job]);
  return <><Link to="/other">Other page</Link><Link to="/agents">Agent workspace</Link><button onClick={() => reviewCandidate("profile-1", { ...syntheticProfile.candidate, experience: [] }, false)}>Edit selected profile</button><button onClick={() => setState((state) => ({ ...state, text: "Changed source", analysis: null, requirementsConfirmed: false, revision: state.revision + 1 }))}>Edit reviewed job</button><button onClick={clearCandidates}>Clear profiles</button><Routes><Route path="/agents" element={<AIAgents />} /><Route path="/other" element={<h1>Other route</h1>} /></Routes></>;
}
function open(options: { confirmed?: boolean; job?: boolean } = {}) {
  return render(<MemoryRouter initialEntries={["/agents"]}><SessionProvider><JobSessionProvider><AgentSessionProvider><Harness {...options} /></AgentSessionProvider></JobSessionProvider></SessionProvider></MemoryRouter>);
}
async function start(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByRole("button", { name: "Start evidence workflow" })).toBeEnabled());
  await user.click(screen.getByRole("button", { name: "Start evidence workflow" }));
  return screen.findByRole("heading", { name: "Evidence awaiting human review" });
}

describe("LangGraph AI Agents workspace", () => {
  it("exposes the actual route with actionable missing prerequisites and no automatic workflow", async () => {
    render(<MemoryRouter initialEntries={["/agents"]}><App /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "AI Agents" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Workflow prerequisites" })).toHaveTextContent("Upload a CV and select a candidate");
    expect(screen.getByRole("region", { name: "Workflow prerequisites" })).toHaveTextContent("Analyze the job description");
    expect(screen.getByRole("button", { name: "Start evidence workflow" })).toBeDisabled();
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
    expect(agentApi.start).not.toHaveBeenCalled();
  });

  it("keeps unconfirmed candidates selectable while blocking graph execution and linking their review", async () => {
    open({ confirmed: false });
    await screen.findByRole("option", { name: /Alex Example.*Awaiting review/ });
    expect(screen.getByLabelText("Candidate for workflow")).toHaveValue("profile-1");
    expect(screen.getByRole("option", { name: /Awaiting review/ })).toBeEnabled();
    expect(screen.getByRole("region", { name: "Workflow prerequisites" })).toHaveTextContent("This candidate must be reviewed and confirmed");
    expect(screen.getByRole("link", { name: "Review selected candidate" })).toHaveAttribute("href", "/candidates/profile-1");
    expect(screen.getByRole("button", { name: "Start evidence workflow" })).toBeDisabled();
    expect(agentApi.start).not.toHaveBeenCalled();
  });

  it("requires the existing reviewed job rather than requesting duplicate input", async () => {
    open({ job: false });
    await screen.findByRole("option", { name: /Confirmed review/ });
    expect(screen.getByRole("button", { name: "Start evidence workflow" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Open Job Analysis" })).toHaveAttribute("href", "/matching");
    expect(screen.getByRole("region", { name: "Workflow prerequisites" })).toHaveTextContent("Analyze the job description");
  });

  it("works on local HTTP hostnames where randomUUID is unavailable", async () => {
    const getRandomValues = crypto.getRandomValues.bind(crypto);
    vi.stubGlobal("crypto", { getRandomValues });
    const user = userEvent.setup();
    open();
    await start(user);
    expect(vi.mocked(agentApi.start).mock.calls[0][1].client_request_id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  });

  it("starts with a private qualification projection, renders real backend trace, acknowledges and resumes once", async () => {
    const user = userEvent.setup();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    open();
    await start(user);
    const [token, body] = vi.mocked(agentApi.start).mock.calls[0];
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(body.client_request_id).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.comparison.candidate).toEqual(body.comparison.review.candidate_snapshot);
    expect(body.comparison.candidate).not.toHaveProperty("full_name");
    expect(body.comparison.candidate).not.toHaveProperty("email");
    expect(body.comparison.candidate.experience[0]).not.toHaveProperty("company");
    expect(body.comparison.candidate.education[0]).not.toHaveProperty("institution");
    expect(body.comparison.job_analysis.requirements[3].origin).toBe("technical_environment");
    const timeline = screen.getByRole("region", { name: "Execution timeline" });
    expect(within(timeline).getAllByText("Completed")).toHaveLength(5);
    expect(within(timeline).getByText("Waiting for review")).toBeVisible();
    expect(within(timeline).getByText("Backend trace: evidence_verification")).toBeVisible();
    expect(screen.getByRole("button", { name: "Review & Resume" })).toBeDisabled();
    expect(agentApi.resume).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: /I inspected the source evidence/ }));
    await user.dblClick(screen.getByRole("button", { name: "Review & Resume" }));
    await screen.findByRole("heading", { name: "Final evidence report" });
    expect(agentApi.resume).toHaveBeenCalledTimes(1);
    expect(vi.mocked(agentApi.resume).mock.calls[0]).toEqual([token, current.workflow_id, { acknowledged: true, request_revision: body.request_revision, snapshot_hash: "a".repeat(64), comparison: body.comparison }]);
    expect(within(screen.getByRole("region", { name: "Execution timeline" })).getAllByText("Completed")).toHaveLength(7);
    expect(screen.queryByRole("checkbox", { name: /I inspected/ })).not.toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled();
    expect(JSON.stringify(body.comparison.candidate)).not.toContain("Synthetic Company");
  });

  it("retains pending review and final evidence through routes; status refresh does not execute nodes", async () => {
    const user = userEvent.setup();
    open();
    await start(user);
    await user.click(screen.getByRole("link", { name: "Other page" }));
    await screen.findByRole("heading", { name: "Other route" });
    await user.click(screen.getByRole("link", { name: "Agent workspace" }));
    await screen.findByRole("heading", { name: "Evidence awaiting human review" });
    await user.click(screen.getByRole("button", { name: "Refresh workflow status" }));
    expect(agentApi.status).toHaveBeenCalledTimes(1);
    expect(agentApi.start).toHaveBeenCalledTimes(1);
    expect(agentApi.resume).not.toHaveBeenCalled();
    await user.click(screen.getByRole("checkbox", { name: /I inspected/ }));
    await user.click(screen.getByRole("button", { name: "Review & Resume" }));
    await screen.findByRole("heading", { name: "Final evidence report" });
    await user.click(screen.getByRole("button", { name: "Refresh workflow status" }));
    expect(agentApi.status).toHaveBeenCalledTimes(2);
    expect(agentApi.resume).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Requirement evidence" })).toBeVisible();
  });

  it.each(["Edit selected profile", "Edit reviewed job", "Clear profiles"])("invalidates pending evidence and revokes acknowledgment on %s", async (label) => {
    const user = userEvent.setup();
    open();
    await start(user);
    await user.click(screen.getByRole("checkbox", { name: /I inspected/ }));
    await user.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Evidence awaiting human review" })).not.toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent("previous evidence and acknowledgment are no longer valid");
    expect(screen.queryByRole("button", { name: "Review & Resume" })).not.toBeInTheDocument();
    expect(agentApi.resume).not.toHaveBeenCalled();
    await waitFor(() => expect(agentApi.cancel).toHaveBeenCalledTimes(1));
  });

  it("discards and cancels a late start response after document edits and locks repeated clicks", async () => {
    let resolve!: (workflow: AgentWorkflow) => void;
    let pending!: AgentWorkflowStart;
    vi.mocked(agentApi.start).mockImplementation((_token, body) => { pending = body; return new Promise((done) => { resolve = done; }); });
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start evidence workflow" })).toBeEnabled());
    const startButton = screen.getByRole("button", { name: "Start evidence workflow" });
    fireEvent.click(startButton); fireEvent.click(startButton);
    expect(agentApi.start).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Edit reviewed job" }));
    current = result(pending.request_revision);
    resolve(current);
    await waitFor(() => expect(agentApi.cancel).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("heading", { name: "Evidence awaiting human review" })).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("response was discarded");
  });

  it("handles backend failure, retry with the same start idempotency key, cancellation and a new workflow", async () => {
    vi.mocked(agentApi.start).mockRejectedValueOnce(new ApiError("Backend unavailable."));
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start evidence workflow" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Start evidence workflow" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend unavailable");
    await start(user);
    expect(vi.mocked(agentApi.start).mock.calls[1][1].client_request_id).toBe(vi.mocked(agentApi.start).mock.calls[0][1].client_request_id);
    await user.click(screen.getByRole("button", { name: "Cancel workflow" }));
    expect(await screen.findByRole("status", { name: "" })).toBeDefined();
    await waitFor(() => expect(screen.getByText(/Workflow cancelled\./)).toBeVisible());
    expect(screen.queryByRole("heading", { name: "Evidence awaiting human review" })).not.toBeInTheDocument();
    await start(user);
    expect(vi.mocked(agentApi.start).mock.calls[2][1].client_request_id).not.toBe(vi.mocked(agentApi.start).mock.calls[1][1].client_request_id);
  });

  it("explains expired checkpoints and removes stale evidence instead of pretending resume succeeded", async () => {
    const user = userEvent.setup();
    open();
    await start(user);
    vi.mocked(agentApi.resume).mockRejectedValue(new ApiError("Workflow expired.", 410, "workflow_expired"));
    await user.click(screen.getByRole("checkbox", { name: /I inspected/ }));
    await user.click(screen.getByRole("button", { name: "Review & Resume" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("start a new workflow");
    expect(screen.queryByRole("heading", { name: "Evidence awaiting human review" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Final evidence report" })).not.toBeInTheDocument();
  });

  it("shows actual failed node traces returned with structured API errors", async () => {
    vi.mocked(agentApi.start).mockImplementation(async (_token, body) => {
      const failure = result(body.request_revision, "failed");
      failure.steps[4] = { node: "evidence_verification", status: "failed", note: "Backend rejected an inconsistent source span." };
      failure.errors = [{ code: "evidence_invalid", message: "The source span is inconsistent.", node: "evidence_verification", recoverable: false }];
      throw new ApiError("Evidence verification failed.", 422, "evidence_invalid", [], { workflow: failure });
    });
    const user = userEvent.setup();
    open();
    await waitFor(() => expect(screen.getByRole("button", { name: "Start evidence workflow" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Start evidence workflow" }));
    expect(await screen.findByRole("heading", { name: "Failed" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Execution timeline" })).toHaveTextContent("Backend rejected an inconsistent source span.");
    expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("source span is inconsistent"))).toBe(true);
    expect(screen.queryByRole("heading", { name: "Final evidence report" })).not.toBeInTheDocument();
  });

  it("removes a finalized report immediately after current profile edits", async () => {
    const user = userEvent.setup();
    open();
    await start(user);
    await user.click(screen.getByRole("checkbox", { name: /I inspected/ }));
    await user.click(screen.getByRole("button", { name: "Review & Resume" }));
    await screen.findByRole("heading", { name: "Final evidence report" });
    await user.click(screen.getByRole("button", { name: "Edit selected profile" }));
    expect(screen.queryByRole("heading", { name: "Final evidence report" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Requirement evidence" })).not.toBeInTheDocument();
    expect(agentApi.cancel).not.toHaveBeenCalled();
  });
});
