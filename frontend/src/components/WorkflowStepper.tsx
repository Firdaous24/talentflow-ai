import { useAgentSession } from "../agentSession";
import { comparisonBlockers } from "../comparison";
import { useJobSession } from "../jobSession";
import { useSession } from "../session";
import { Stepper } from "./ui";
import type { StepItem, StepStatus } from "./ui";

export interface WorkflowStep extends StepItem {
  summary: string;
}

/**
 * The guided path derived from the real session state. It never unlocks
 * anything: each step links to the page where the existing gate lives.
 */
export function useWorkflowSteps(): WorkflowStep[] {
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

  const base: Omit<WorkflowStep, "status">[] = [
    { id: "cv", label: "CV", description: "Upload a CV", to: "/parser", summary: "Text-based PDF, parsed locally with source evidence for every field." },
    { id: "profile", label: "Profile review", description: "Review and confirm the profile", to: selected ? `/candidates/${selected.id}` : "/candidates", summary: "Correct the extraction and confirm it. Nothing is compared before this." },
    { id: "job", label: "Job post", description: "Analyze a job description", to: "/matching", summary: "French or English. Requirements keep their exact source offsets." },
    { id: "requirements", label: "Criteria review", description: "Review the extracted criteria", to: "/matching", summary: "Adjust labels and classifications, then acknowledge the review." },
    { id: "comparison", label: "Comparison", description: "Compare the evidence", to: "/matching", summary: "Documented, not documented or needs review. Never a score." },
    { id: "agents", label: "Agent workflow", description: "Run the reviewed agent workflow", to: "/agents", summary: "LangGraph pauses for your explicit review before its final report." },
  ];
  return base.map((step, index) => {
    let status: StepStatus = done[index] ? "done" : index === firstOpen ? "current" : "todo";
    if (!done[index] && blocked[index] && (index === firstOpen || (index === 5 && agentStopped))) status = "blocked";
    return { ...step, status };
  });
}

export function WorkflowStepper() {
  return <Stepper steps={useWorkflowSteps()} label="Evidence workflow progress" />;
}
