import { request } from "./api";
import type { AgentWorkflow, AgentWorkflowResume, AgentWorkflowStart } from "./agentTypes";

const base = "/api/v1/agents/workflows";
function options(session: string, body?: unknown): RequestInit {
  return {
    headers: { "X-Workflow-Session": session, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  };
}
export const agentApi = {
  start: (session: string, body: AgentWorkflowStart) => request<AgentWorkflow>(base, options(session, body)),
  status: (session: string, id: string) => request<AgentWorkflow>(`${base}/${encodeURIComponent(id)}`, options(session)),
  review: (session: string, id: string) => request<AgentWorkflow>(`${base}/${encodeURIComponent(id)}/review`, options(session)),
  report: (session: string, id: string) => request<AgentWorkflow>(`${base}/${encodeURIComponent(id)}/report`, options(session)),
  resume: (session: string, id: string, body: AgentWorkflowResume) => request<AgentWorkflow>(`${base}/${encodeURIComponent(id)}/resume`, options(session, body)),
  cancel: (session: string, id: string) => request<AgentWorkflow>(`${base}/${encodeURIComponent(id)}/cancel`, { ...options(session), method: "POST" }),
};
