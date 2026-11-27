import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { agentApi } from "./agentApi";
import { ApiError } from "./api";
import type { AgentWorkflow } from "./agentTypes";
import { comparisonBlockers } from "./comparison";
import { useJobSession } from "./jobSession";
import { qualificationSnapshot } from "./jobTypes";
import type { JobComparisonRequest } from "./jobTypes";
import { useSession } from "./session";

type Action = "start" | "resume" | "refresh" | "cancel";
interface AgentSession {
  workflow: AgentWorkflow | null;
  busy: Action | null;
  error: string | null;
  acknowledged: boolean;
  setAcknowledged: (value: boolean) => void;
  start: () => Promise<void>;
  resume: () => Promise<void>;
  refresh: () => Promise<void>;
  cancel: () => Promise<void>;
}
const Context = createContext<AgentSession | null>(null);
function sessionKey() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "The workflow request failed.";
  if (error instanceof ApiError) {
    if (error.status === 404 || error.status === 401 || error.status === 410)
      return `${message} This temporary workflow is unavailable. Review the current documents and start a new workflow.`;
    if (error.status === 409)
      return `${message} Refresh the workflow status. If a document changed, review it and start a new workflow.`;
    if (error.status === 422)
      return `${message} Review the candidate and job requirements before retrying.`;
  }
  return `${message} Check the backend connection and retry, or refresh the workflow status.`;
}
function identifier() {
  // getRandomValues also works on the existing local Docker development hostname;
  // randomUUID is unavailable there when the browser does not consider HTTP secure.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function failedWorkflow(error: unknown): AgentWorkflow | null {
  if (!(error instanceof ApiError) || !error.detail || typeof error.detail !== "object" || !("workflow" in error.detail)) return null;
  const value = error.detail.workflow;
  if (!value || typeof value !== "object" || !("status" in value) || !["blocked", "failed"].includes(String(value.status))) return null;
  if (!("workflow_id" in value) || typeof value.workflow_id !== "string" || !("request_revision" in value) || typeof value.request_revision !== "string" || !("steps" in value) || !Array.isArray(value.steps) || !("errors" in value) || !Array.isArray(value.errors) || !("validation_notes" in value) || !Array.isArray(value.validation_notes)) return null;
  return value as AgentWorkflow;
}

/** Route-stable browser memory only. No workflow keys, documents or acknowledgments enter browser storage. */
export function AgentSessionProvider({ children }: { children: ReactNode }) {
  const { candidates } = useSession();
  const { state } = useJobSession();
  const selected = candidates.find((entry) => entry.id === state.selectedId);
  const fingerprint = JSON.stringify({
    id: selected?.id,
    confirmed: selected?.confirmed,
    candidate: selected?.reviewedCandidate ? qualificationSnapshot(selected.reviewedCandidate) : null,
    text: state.text,
    analysis: state.analysis,
    requirements: state.requirements,
    requirementsConfirmed: state.requirementsConfirmed,
    revision: state.revision,
  });
  const latest = useRef(fingerprint);
  latest.current = fingerprint;
  const revision = useRef({ fingerprint, value: identifier() });
  if (revision.current.fingerprint !== fingerprint)
    revision.current = { fingerprint, value: identifier() };
  const token = useRef<string | null>(null);
  const session = () => (token.current ??= sessionKey());
  const [record, setRecord] = useState<{ workflow: AgentWorkflow; fingerprint: string } | null>(null);
  const recordRef = useRef(record);
  recordRef.current = record;
  const workflow = record?.fingerprint === fingerprint ? record.workflow : null;
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const startAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    const stale = recordRef.current;
    if (!stale || stale.fingerprint === fingerprint) return;
    setRecord(null);
    setAcknowledged(false);
    setError("The candidate or reviewed job changed. The previous evidence and acknowledgment are no longer valid. Confirm the current documents and start a new workflow.");
    if (stale.workflow.status === "waiting_for_review")
      void agentApi.cancel(session(), stale.workflow.workflow_id).catch(() => undefined);
  }, [fingerprint]);

  function payload(): JobComparisonRequest | null {
    if (comparisonBlockers({ candidates, selectedId: state.selectedId, analysis: state.analysis, requirements: state.requirements, requirementsConfirmed: state.requirementsConfirmed, busy: null }).length || !selected?.reviewedCandidate || !state.analysis)
      return null;
    const candidate = qualificationSnapshot(selected.reviewedCandidate);
    const requirements = state.requirements.map((requirement) => ({ ...requirement, text: requirement.text.trim() }));
    return { candidate, job_analysis: state.analysis, requirements, review: { candidate_confirmed: true, candidate_snapshot: qualificationSnapshot(selected.reviewedCandidate), requirements_reviewed: true, requirement_snapshot: requirements.map((requirement) => ({ ...requirement })) } };
  }
  async function execute(action: Action) {
    if (lock.current) return;
    const comparison = payload();
    if (action === "start" && (!comparison || workflow?.status === "waiting_for_review")) return;
    if (action !== "start" && !workflow) return;
    if (action === "resume" && (!comparison || !acknowledged || workflow?.status !== "waiting_for_review")) return;
    const requestFingerprint = fingerprint;
    const requestRevision = revision.current.value;
    lock.current = true;
    setBusy(action);
    setError(null);
    try {
      let response: AgentWorkflow;
      if (action === "start") {
        if (startAttempt.current?.fingerprint !== requestFingerprint)
          startAttempt.current = { fingerprint: requestFingerprint, id: identifier() };
        response = await agentApi.start(session(), { comparison: comparison!, request_revision: requestRevision, client_request_id: startAttempt.current.id });
      } else if (action === "resume") {
        response = await agentApi.resume(session(), workflow!.workflow_id, { acknowledged: true, request_revision: requestRevision, snapshot_hash: workflow!.snapshot_hash, comparison: comparison! });
      } else if (action === "cancel") {
        response = await agentApi.cancel(session(), workflow!.workflow_id);
      } else {
        response = await agentApi.status(session(), workflow!.workflow_id);
      }
      if (!mounted.current || latest.current !== requestFingerprint) {
        if (response.status === "waiting_for_review")
          void agentApi.cancel(session(), response.workflow_id).catch(() => undefined);
        if (mounted.current)
          setError("The candidate or reviewed job changed while the request was running. Its response was discarded. Review the current documents and start a new workflow.");
        return;
      }
      if (response.request_revision !== requestRevision)
        throw new Error("The server returned a different document revision. Review the current documents and start a new workflow.");
      setRecord({ workflow: response, fingerprint: requestFingerprint });
      startAttempt.current = null;
      if (action !== "refresh" || response.status !== "waiting_for_review") setAcknowledged(false);
      if (["cancelled", "expired", "blocked", "failed"].includes(response.status)) startAttempt.current = null;
    } catch (caught) {
      if (!mounted.current || latest.current !== requestFingerprint) return;
      setError(errorMessage(caught));
      setAcknowledged(false);
      const failure = failedWorkflow(caught);
      if (failure?.request_revision === requestRevision) {
        setRecord({ workflow: failure, fingerprint: requestFingerprint });
        startAttempt.current = null;
      }
      if (caught instanceof ApiError && [401, 404, 410].includes(caught.status ?? 0)) {
        setRecord(null);
        startAttempt.current = null;
      }
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(null);
    }
  }
  return <Context.Provider value={{ workflow, busy, error, acknowledged: !!workflow && acknowledged, setAcknowledged, start: () => execute("start"), resume: () => execute("resume"), refresh: () => execute("refresh"), cancel: () => execute("cancel") }}>{children}</Context.Provider>;
}
export function useAgentSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing agent session provider");
  return value;
}
