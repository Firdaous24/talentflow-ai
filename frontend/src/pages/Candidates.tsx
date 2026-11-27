import { Link, useParams } from "react-router-dom";
import { ArrowRight, ChevronRight, FileText, ShieldCheck, UsersRound, X } from "lucide-react";
import { ReviewProfile } from "../components/ReviewProfile";
import { useSession } from "../session";

export function Candidates() {
  const { candidates, clearCandidates } = useSession();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR SESSION</span>
          <h1>Candidates</h1>
          <p>Review the profiles you’ve parsed in this workspace.</p>
        </div>
        <Link to="/parser" className="button primary">
          <FileText size={17} />
          Parse a CV
        </Link>
      </div>
      <div className="notice info">
        <ShieldCheck size={19} />
        <div>
          <strong>Temporary by design</strong>
          <p>
            These profiles exist only in browser memory. Refreshing or closing
            this page clears the list.
          </p>
        </div>
      </div>
      <section className="card candidates-card">
        <div className="section-title">
          <h2>
            Parsed candidates <span className="count">{candidates.length}</span>
          </h2>
          {candidates.length > 0 && (
            <button className="text-button" onClick={clearCandidates}>
              Clear session profiles
              <X size={15} />
            </button>
          )}
        </div>
        {candidates.length ? (
          <div className="candidate-list">
            {candidates.map((entry) => (
              <Link
                className="candidate-row"
                key={entry.id}
                to={`/candidates/${entry.id}`}
              >
                <span className="avatar">
                  {(entry.reviewedCandidate ?? entry.candidate).full_name
                    ?.slice(0, 2)
                    .toUpperCase() ?? "?"}
                </span>
                <div className="candidate-row-main">
                  <h3>
                    {(entry.reviewedCandidate ?? entry.candidate).full_name ??
                      "Name not extracted"}
                  </h3>
                  <p>
                    {(entry.reviewedCandidate ?? entry.candidate).email ??
                      "Email not extracted"}{" "}
                    · {entry.filename}
                  </p>
                </div>
                <span className="badge amber">Partial extraction</span>
                <span
                  className={`badge ${entry.confirmed ? "green" : "neutral"}`}
                >
                  {entry.confirmed ? "Confirmed" : "Review required"}
                </span>
                <time dateTime={entry.parsedAt}>
                  {new Date(entry.parsedAt).toLocaleString()}
                </time>
                <ChevronRight size={18} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <UsersRound size={28} />
            </span>
            <h3>No candidates in this session</h3>
            <p>Upload a PDF to create your first candidate profile.</p>
            <Link to="/parser" className="button secondary">
              Parse a CV
              <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </section>
    </>
  );
}
export function CandidateDetail() {
  const { id } = useParams();
  const { candidates } = useSession();
  const entry = candidates.find((candidate) => candidate.id === id);
  return entry ? (
    <>
      <Link to="/candidates" className="back-link">
        ← Back to candidates
      </Link>
      <div className="page-heading">
        <div>
          <h1>Candidate profile</h1>
          <p>
            {entry.filename} · Parsed{" "}
            {new Date(entry.parsedAt).toLocaleString()}
          </p>
        </div>
      </div>
      <ReviewProfile entry={entry} />
    </>
  ) : (
    <>
      <h1>Profile unavailable</h1>
      <p>This profile is no longer in the current session.</p>
      <Link to="/parser" className="button primary">
        Parse a CV
      </Link>
    </>
  );
}
