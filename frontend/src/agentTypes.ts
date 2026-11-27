import type { JobComparisonRequest, JobComparisonResponse } from "./jobTypes";

export type AgentNode = "intake_validation" | "candidate_preparation" | "job_preparation" | "evidence_comparison" | "evidence_verification" | "human_review" | "final_report";
export interface AgentWorkflow {
  workflow_id: string;
  request_revision: string;
  snapshot_hash: string;
  status: "waiting_for_review" | "completed" | "blocked" | "failed" | "cancelled" | "expired";
  current_node: AgentNode | null;
  steps: { node: AgentNode; status: "pending" | "completed" | "waiting_for_review" | "failed" | "cancelled"; note: string }[];
  human_review_status: "not_requested" | "required" | "acknowledged";
  comparison: JobComparisonResponse | null;
  errors: { code: string; message: string; node?: AgentNode | null; recoverable: boolean }[];
  validation_notes: string[];
  created_at: string;
  expires_at: string;
  review_assertion: "unverified_client_assertion";
}
export interface AgentWorkflowStart {
  comparison: JobComparisonRequest;
  request_revision: string;
  client_request_id: string;
}
export interface AgentWorkflowResume {
  acknowledged: true;
  request_revision: string;
  snapshot_hash: string;
  comparison: JobComparisonRequest;
}
