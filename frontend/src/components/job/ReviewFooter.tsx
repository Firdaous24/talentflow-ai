import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { ComparisonBlocker } from "../../comparison";
import type { JobSessionState } from "../../jobSession";
import type { SessionCandidate } from "../../types";

/** Job review acknowledgment, comparison availability and the compare action. */
export function ReviewFooter({ state, setState, hasReviewFooter, blocked, busy, validRequirements, canCompare, comparisonProblems, selected, ready, compare, reset }: {
  state: JobSessionState;
  setState: Dispatch<SetStateAction<JobSessionState>>;
  hasReviewFooter: boolean;
  blocked: boolean;
  busy: "analyze" | "compare" | null;
  validRequirements: boolean;
  canCompare: boolean;
  comparisonProblems: ComparisonBlocker[];
  selected: SessionCandidate | undefined;
  ready: boolean;
  compare: () => Promise<void>;
  reset: () => void;
}) {
  return (
  <div
    className={hasReviewFooter ? "job-review-footer" : undefined}
    role={hasReviewFooter ? "group" : undefined}
    aria-label={
      hasReviewFooter ? "Job review and comparison" : undefined
    }
  >
    {hasReviewFooter && (
      <>
        <label className="job-confirm-label">
          <input
            id="job-requirements-confirmation"
            type="checkbox"
            checked={state.requirementsConfirmed}
            disabled={blocked || !validRequirements}
            aria-describedby="job-requirements-confirmation-help"
            onChange={(event) => {
              const checked = event.currentTarget.checked;
              setState((current) => ({
                ...current,
                requirementsConfirmed: checked,
                comparison: null,
                revision: current.revision + 1,
              }));
            }}
          />
          I reviewed the requirement wording and classifications
          against the job description.
        </label>
        <p
          id="job-requirements-confirmation-help"
          className="job-boundary"
        >
          Confirming a candidate profile does not complete this job
          requirement review. Check this box after reviewing the job
          requirements.
        </p>
        <p className="job-boundary">
          This records a review claim in the current session. It
          does not verify credentials or authenticate an approval.
        </p>
      </>
    )}
    <section
      id="comparison-availability"
      className="job-comparison-availability"
      aria-label="Comparison availability"
      aria-live="polite"
    >
      <h3>
        {canCompare
          ? "Ready to compare evidence"
          : "Complete these steps to compare evidence"}
      </h3>
      {comparisonProblems.length ? (
        <ul>
          {comparisonProblems.map((problem) => (
            <li key={problem.code}>{problem.message}</li>
          ))}
        </ul>
      ) : (
        <p>
          The selected profile and job review are confirmed for this
          session. Unspecified environment mentions can be compared
          as needs review.
        </p>
      )}
      {selected &&
        ready &&
        comparisonProblems.some(
          (problem) => problem.reviewProfile,
        ) && (
          <Link
            className="job-inline-link"
            to={`/candidates/${selected.id}`}
          >
            Review selected profile
            <ArrowRight size={13} />
          </Link>
        )}
    </section>
    {hasReviewFooter && (
      <div className="job-form-actions">
        <button
          className="button primary"
          type="button"
          disabled={!canCompare}
          aria-describedby="comparison-availability"
          onClick={() => void compare()}
        >
          {busy === "compare" ? (
            <>
              <span className="busy-dot" aria-hidden="true" />
              Comparing source evidence…
            </>
          ) : (
            <>
              Compare evidence
              <ArrowRight size={16} />
            </>
          )}
        </button>
        <button
          className="button secondary"
          type="button"
          disabled={blocked}
          onClick={reset}
        >
          <RotateCcw size={15} />
          Start new analysis
        </button>
      </div>
    )}
  </div>
  );
}
