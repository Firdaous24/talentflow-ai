import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { api } from "./api";
import type {
  CVParsingResponse,
  SessionCandidate,
  CandidateProfile,
} from "./types";
import { changedFields } from "./review";

type Connection = "checking" | "online" | "offline";
interface Workspace {
  candidates: SessionCandidate[];
  addCandidate: (
    result: CVParsingResponse,
    filename: string,
  ) => SessionCandidate;
  clearCandidates: () => void;
  reviewCandidate: (
    id: string,
    profile: CandidateProfile,
    confirmed: boolean,
  ) => void;
  connection: Connection;
  healthError: string | null;
  checkHealth: () => Promise<void>;
}
const Context = createContext<Workspace | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [candidates, setCandidates] = useState<SessionCandidate[]>([]);
  const [connection, setConnection] = useState<Connection>("checking");
  const [healthError, setHealthError] = useState<string | null>(null);
  const checking = useRef(false);
  const nextId = useRef(0);
  const checkHealth = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    setConnection("checking");
    setHealthError(null);
    try {
      const result = await api.health();
      if (result.status !== "ok")
        throw new Error("Unexpected health response.");
      setConnection("online");
    } catch (error) {
      setConnection("offline");
      setHealthError(
        error instanceof Error ? error.message : "Health check failed.",
      );
    } finally {
      checking.current = false;
    }
  }, []);
  useEffect(() => {
    void checkHealth();
    const timer = setInterval(() => void checkHealth(), 60_000);
    return () => clearInterval(timer);
  }, [checkHealth]);
  const addCandidate = (result: CVParsingResponse, filename: string) => {
    const entry = {
      ...result,
      filename,
      id: `profile-${++nextId.current}`,
      parsedAt: new Date().toISOString(),
    };
    setCandidates((previous) => [entry, ...previous]);
    return entry;
  };
  return (
    <Context.Provider
      value={{
        candidates,
        addCandidate,
        clearCandidates: () => setCandidates([]),
        reviewCandidate: (id, profile, confirmed) =>
          setCandidates((previous) =>
            previous.map((entry) =>
              entry.id === id
                ? {
                    ...entry,
                    reviewedCandidate: profile,
                    confirmed,
                    correctedFields: changedFields(entry.candidate, profile),
                  }
                : entry,
            ),
          ),
        connection,
        healthError,
        checkHealth,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Missing session provider");
  return value;
}
