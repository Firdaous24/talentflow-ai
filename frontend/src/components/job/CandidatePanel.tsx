import { Link } from "react-router-dom";
import { ArrowRight, Users } from "lucide-react";
import type { SessionCandidate } from "../../types";

/** Candidate selection. Selecting a profile never confirms it. */
export function CandidatePanel({ candidates, selected, ready, awaitingCandidates, blocked, selectCandidate }: {
  candidates: SessionCandidate[];
  selected: SessionCandidate | undefined;
  ready: boolean;
  awaitingCandidates: SessionCandidate[];
  blocked: boolean;
  selectCandidate: (selectedId: string) => void;
}) {
  return (
    <section className="card">
      <div className="section-heading">
        <div className="icon-box">
          <Users size={19} />
        </div>
        <div>
          <h2>Select a candidate</h2>
          <p>Select any session profile. Confirm it before comparison.</p>
        </div>
      </div>
      {candidates.length === 0 ? (
        <div className="job-empty">
          <Users size={30} />
          <h3>No candidates available</h3>
          <p>
            Upload a CV to add a profile to this session, then select it
            here.
          </p>
          <Link className="button secondary" to="/parser">
            Open CV Parser
            <ArrowRight size={15} />
          </Link>
        </div>
      ) : (
        <>
          <label htmlFor="comparison-candidate">
            Candidate profile
          </label>
          <select
            id="comparison-candidate"
            value={selected?.id ?? ""}
            disabled={blocked}
            aria-describedby="candidate-selection-help"
            onChange={(event) =>
              selectCandidate(event.currentTarget.value)
            }
          >
            <option value="">Choose a candidate</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.reviewedCandidate?.full_name ??
                  candidate.candidate.full_name ??
                  candidate.filename}{" "}
                —{" "}
                {candidate.confirmed && candidate.reviewedCandidate
                  ? "Confirmed review"
                  : "Awaiting review"}
              </option>
            ))}
          </select>
          <p
            id="candidate-selection-help"
            className="job-boundary job-candidate-help"
          >
            All session profiles are selectable. Selecting a profile
            does not confirm it or approve it for comparison.
          </p>
          {selected && (
            <div className="job-select-status">
              <span className={`badge ${ready ? "violet" : "gray"}`}>
                {ready
                  ? "Confirmed review · information unverified"
                  : "Awaiting review"}
              </span>
              {!ready && (
                <p className="job-boundary job-candidate-help">
                  This candidate must be reviewed and confirmed before
                  comparison.
                </p>
              )}
              <Link
                className="job-inline-link"
                to={`/candidates/${selected.id}`}
              >
                {ready
                  ? "Revisit candidate profile"
                  : "Review selected candidate"}
                <ArrowRight size={13} />
              </Link>
            </div>
          )}
          {awaitingCandidates.length > 0 && (
            <section
              className="job-awaiting-review"
              aria-label="Awaiting review"
            >
              <h3>
                Awaiting review
                <span className="count">
                  {awaitingCandidates.length}
                </span>
              </h3>
              <p className="job-boundary">
                Review the fields, source evidence and warnings, then
                confirm the profile to use it for comparison.
              </p>
              {awaitingCandidates.map((candidate) => {
                const name =
                  candidate.reviewedCandidate?.full_name ??
                  candidate.candidate.full_name ??
                  candidate.filename;
                return (
                  <article
                    key={candidate.id}
                    className="job-awaiting-candidate"
                    aria-label={`Awaiting review ${candidate.id}`}
                  >
                    <div>
                      <h4>{name}</h4>
                      <p>{candidate.filename}</p>
                    </div>
                    <Link
                      className="button secondary"
                      to={`/candidates/${candidate.id}`}
                      aria-label={`Review profile: ${name}`}
                    >
                      Review profile
                      <ArrowRight size={14} />
                    </Link>
                  </article>
                );
              })}
            </section>
          )}
        </>
      )}
    </section>
  );
}
