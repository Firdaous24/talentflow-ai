import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { useSession } from "./session";
import { qualificationSnapshot } from "./jobTypes";
import type {
  JobAnalysisResponse,
  JobComparisonResponse,
  ReviewedRequirement,
} from "./jobTypes";

export interface JobSessionState {
  selectedId: string;
  text: string;
  analysis: JobAnalysisResponse | null;
  requirements: ReviewedRequirement[];
  requirementsConfirmed: boolean;
  comparison: JobComparisonResponse | null;
  view: "source" | "requirements" | "results";
  revision: number;
}
export const emptyJobSession = (): JobSessionState => ({
  selectedId: "",
  text: "",
  analysis: null,
  requirements: [],
  requirementsConfirmed: false,
  comparison: null,
  view: "source",
  revision: 0,
});
const JobContext = createContext<{
  state: JobSessionState;
  setState: Dispatch<SetStateAction<JobSessionState>>;
} | null>(null);

/** In-memory route state; reviewed profile changes invalidate the last comparison. */
export function JobSessionProvider({ children }: { children: ReactNode }) {
  const { candidates } = useSession();
  const [state, setState] = useState<JobSessionState>(emptyJobSession);
  const candidate = candidates.find((entry) => entry.id === state.selectedId);
  const fingerprint = JSON.stringify({
    id: state.selectedId,
    confirmed: !!candidate?.confirmed,
    profile: candidate?.reviewedCandidate
      ? qualificationSnapshot(candidate.reviewedCandidate)
      : null,
  });
  const previous = useRef(fingerprint);
  const previousCount = useRef(candidates.length);
  useEffect(() => {
    const cleared = previousCount.current > 0 && candidates.length === 0;
    previousCount.current = candidates.length;
    if (cleared) {
      previous.current = fingerprint;
      setState((current) => ({
        ...emptyJobSession(),
        revision: current.revision + 1,
      }));
      return;
    }
    if (previous.current === fingerprint) return;
    previous.current = fingerprint;
    setState((current) => ({
      ...current,
      comparison: null,
      revision: current.revision + 1,
      view: current.view === "results" ? "requirements" : current.view,
    }));
  }, [fingerprint, candidates.length]);
  return (
    <JobContext.Provider value={{ state, setState }}>
      {children}
    </JobContext.Provider>
  );
}
export function useJobSession() {
  const value = useContext(JobContext);
  if (!value) throw new Error("Missing job session provider");
  return value;
}
