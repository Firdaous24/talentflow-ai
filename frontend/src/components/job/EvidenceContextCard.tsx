import { ShieldCheck } from "lucide-react";

/** Static reminder of the comparison privacy and interpretation boundaries. */
export function EvidenceContextCard() {
  return (
    <section className="card">
      <div className="section-heading">
        <div className="icon-box">
          <ShieldCheck size={19} />
        </div>
        <div>
          <h2>Keep evidence in context</h2>
          <p>A checklist for human review.</p>
        </div>
      </div>
      <p>
        Only qualification fields are submitted for comparison. Names,
        contacts, employers, locations and profile URLs are excluded
        from the comparison payload.
      </p>
      <p style={{ marginTop: 12 }}>
        Free-text qualification descriptions can contain personal
        details; review and remove irrelevant information before
        confirmation.
      </p>
      <p style={{ marginTop: 12 }}>
        Profile mentions do not verify proficiency. Missing
        documentation does not establish missing ability.
      </p>
      <p className="job-boundary" style={{ marginTop: 12 }}>
        Job analysis and results stay in browser memory. Refreshing or
        clearing the session removes them.
      </p>
    </section>
  );
}
