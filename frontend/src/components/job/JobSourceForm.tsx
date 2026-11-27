import type { FormEvent } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { JobSessionState } from "../../jobSession";
import { MAX_TEXT_LENGTH } from "./shared";

/** Source description form. Editing the source invalidates analysis and review in the parent. */
export function JobSourceForm({ state, blocked, busy, validText, analyze, changeSource, reset }: {
  state: JobSessionState;
  blocked: boolean;
  busy: "analyze" | "compare" | null;
  validText: boolean;
  analyze: (event: FormEvent) => void;
  changeSource: (text: string) => void;
  reset: () => void;
}) {
  return (
  <form onSubmit={analyze} aria-label="Analyze job description">
    <label
      htmlFor="job-description"
      style={state.analysis ? { marginTop: 20 } : undefined}
    >
      Job description
    </label>
    <textarea
      id="job-description"
      value={state.text}
      rows={13}
      disabled={blocked}
      aria-describedby="job-description-help job-character-count"
      placeholder="Paste a French or English job description, including qualifications and any technical environment."
      onChange={(event) => changeSource(event.target.value)}
    />
    <div className="job-form-help">
      <span id="job-description-help">
        30–30,000 characters. Include qualifications and technical
        lists.
      </span>
      <span id="job-character-count" aria-live="polite">
        {state.text.length.toLocaleString()} / 30,000 characters
      </span>
    </div>
    {state.text.length > MAX_TEXT_LENGTH && (
      <p className="job-warning-list" role="alert">
        The description exceeds 30,000 characters. Shorten it before
        analysis.
      </p>
    )}
    <div className="job-form-actions">
      <button
        className="button primary"
        type="submit"
        disabled={blocked || !validText}
      >
        {busy === "analyze" ? (
          <>
            <span className="busy-dot" aria-hidden="true" />
            Analyzing requirements…
          </>
        ) : (
          <>
            Analyze requirements
            <ArrowRight size={16} />
          </>
        )}
      </button>
      {state.text && (
        <button
          className="button secondary"
          type="button"
          disabled={blocked}
          onClick={reset}
        >
          <RotateCcw size={15} />
          Start new analysis
        </button>
      )}
    </div>
    <p className="job-boundary" style={{ marginTop: 15 }}>
      The analyzer reads explicit qualifications and technical
      environment mentions. Check the source and labels before
      comparison.
    </p>
    {state.analysis &&
      state.analysis.job.responsibilities.length > 0 && (
        <details className="job-source">
          <summary>
            Responsibilities, separate from qualifications (
            {state.analysis.job.responsibilities.length})
          </summary>
          <ul className="job-warning-list">
            {state.analysis.job.responsibilities.map(
              (responsibility, index) => (
                <li key={index}>{responsibility}</li>
              ),
            )}
          </ul>
        </details>
      )}
  </form>
  );
}
