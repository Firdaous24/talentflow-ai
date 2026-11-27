import { useAgentSession } from "../agentSession";
import { comparisonBlockers } from "../comparison";
import { useJobSession } from "../jobSession";
import { useSession } from "../session";
import { Stepper } from "./ui";
import type { StepItem, StepStatus } from "./ui";

/**
 * Persistent guided path derived from the real session state. It never
 * unlocks anything: each step links to the page where the existing gate lives.
 */
export function WorkflowStepper() {
  const { candidates } = useSession();
  const { state } = useJobSession();
  const { workflow } = useAgentSession();
  const selected = candidates.find((entry) => entry.id === state.selectedId) ?? (state.selectedId ? undefined : candidates[0]);
  const blockers = comparisonBlockers({ candidates, selectedId: state.selectedId, analysis: state.analysis, requirements: state.requirements, requirementsConfirmed: state.requirementsConfirmed, busy: null });

  const done = [
    candidates.length > 0,
    !!selected?.confirmed && !!selected.reviewedCandidate,
    !!state.analysis,
    !!state.analysis && state.requirementsConfirmed,
    // The agent graph runs the same deterministic comparison.
    !!state.comparison || !!workflow?.comparison,
    workflow?.status === "completed",
  ];
  const firstOpen = done.indexOf(false);
  const agentStopped = workflow && ["blocked", "failed"].includes(workflow.status);
  const blocked = [false, false, false, false, blockers.length > 0, blockers.length > 0 || !!agentStopped];

  const base: Omit<StepItem, "status">[] = [
    { id: "cv", label: "CV", description: "Upload a CV", to: "/parser" },
    { id: "profile", label: "Profile review", description: "Review and confirm the profile", to: selected ? `/candidates/${selected.id}` : "/candidates" },
    { id: "job", label: "Job post", description: "Analyze a job description", to: "/matching" },
    { id: "requirements", label: "Criteria review", description: "Review the extracted criteria", to: "/matching" },
    { id: "comparison", label: "Comparison", description: "Compare the evidence", to: "/matching" },
    { id: "agents", label: "Agent workflow", description: "Run the reviewed agent workflow", to: "/agents" },
  ];
  const steps: StepItem[] = base.map((step, index) => {
    let status: StepStatus = done[index] ? "done" : index === firstOpen ? "current" : "todo";
    if (!done[index] && blocked[index] && (index === firstOpen || (index === 5 && agentStopped))) status = "blocked";
    return { ...step, status };
  });
  return <Stepper steps={steps} label="Evidence workflow progress" />;
}
