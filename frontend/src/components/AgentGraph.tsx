import { Check, Hand, X } from "lucide-react";
import type { AgentNode, AgentWorkflow } from "../agentTypes";

const nodes: { id: AgentNode; short: string }[] = [
  { id: "intake_validation", short: "Intake" },
  { id: "candidate_preparation", short: "Candidate" },
  { id: "job_preparation", short: "Job" },
  { id: "evidence_comparison", short: "Compare" },
  { id: "evidence_verification", short: "Verify" },
  { id: "human_review", short: "Human review" },
  { id: "final_report", short: "Report" },
];
type NodeState = "pending" | "completed" | "waiting_for_review" | "failed" | "cancelled";

/**
 * Visual twin of the accessible execution timeline. It is presentational
 * (aria-hidden): states come from the backend graph, nothing is simulated.
 * Edges fill in sequence, so resuming visibly flows into the final report.
 */
export function AgentGraph({ workflow, busy }: { workflow: AgentWorkflow | null; busy: boolean }) {
  const states = new Map<AgentNode, NodeState>(workflow?.steps.map((step) => [step.node, step.status]) ?? []);
  const stateOf = (node: AgentNode): NodeState => states.get(node) ?? "pending";
  const idle = !workflow;
  return (
    <div className={`agent-graph${idle ? " idle" : ""}${busy ? " running" : ""}`} aria-hidden="true">
      <ol>
        {nodes.map((node, index) => {
          const state = stateOf(node.id);
          const reached = state === "completed" || state === "waiting_for_review";
          return (
            <li key={node.id} className={`graph-node ${state}${node.id === "human_review" ? " human" : ""}`} style={{ ["--order" as string]: index }}>
              {index > 0 && <span className={`graph-edge${reached ? " filled" : ""}`}><i /></span>}
              <span className="graph-dot">
                {state === "completed" ? <Check size={15} strokeWidth={2.75} /> : state === "waiting_for_review" ? <Hand size={14} strokeWidth={2.25} /> : state === "failed" || state === "cancelled" ? <X size={14} strokeWidth={2.5} /> : <span className="graph-index">{String(index + 1).padStart(2, "0")}</span>}
              </span>
              <span className="graph-label">{node.short}</span>
              <span className="graph-state">{state === "completed" ? "Done" : state === "waiting_for_review" ? "Paused" : state === "failed" ? "Stopped" : state === "cancelled" ? "Cancelled" : idle ? "Ready" : "Queued"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
