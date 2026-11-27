import type { JobSessionState } from "../../jobSession";

/** The page-level four-step indicator. */
export function JobWorkflowSteps({ state }: { state: JobSessionState }) {
  return (
    <ol className="job-steps" aria-label="Job analysis workflow">
      <li aria-current={!state.analysis ? "step" : undefined}>
        <span>1</span>Select a candidate
      </li>
      <li aria-current={!state.analysis ? "step" : undefined}>
        <span>2</span>Paste a job description
      </li>
      <li
        aria-current={
          state.analysis && state.view !== "results" ? "step" : undefined
        }
      >
        <span>3</span>Review requirements
      </li>
      <li aria-current={state.view === "results" ? "step" : undefined}>
        <span>4</span>Compare evidence
      </li>
    </ol>
  );
}
