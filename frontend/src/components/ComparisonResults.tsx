import { useEffect, useId, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  FileSearch,
  HelpCircle,
  ShieldCheck,
} from "lucide-react";
import type {
  CandidateRequirementEvidence,
  ComparisonStatus,
  JobAnalysisResponse,
  JobComparisonResponse,
  RequirementCategory,
  RequirementClassification,
  RequirementComparison,
  TechnicalEvidence,
} from "../jobTypes";
import "../comparisonResults.css";

const classificationLabels: Record<RequirementClassification, string> = {
  required: "Required",
  preferred: "Preferred",
  unspecified: "Unspecified",
};
const categoryLabels: Record<RequirementCategory, string> = {
  technical_skill: "Technical skill",
  experience: "Experience",
  education: "Education",
  certification: "Certification",
  language: "Language",
  other: "Other / needs review",
};
const statuses: {
  status: ComparisonStatus;
  title: string;
  filter: string;
  description: string;
  Icon: typeof BookOpen;
}[] = [
  {
    status: "documented",
    title: "Documented in profile",
    filter: "Documented",
    description: "Supporting information remains unverified.",
    Icon: BookOpen,
  },
  {
    status: "not_documented",
    title: "Not documented in profile",
    filter: "Not documented",
    description: "Absence of documentation does not establish missing ability.",
    Icon: FileSearch,
  },
  {
    status: "needs_review",
    title: "Needs human review",
    filter: "Needs review",
    description: "Source wording or evidence needs human interpretation.",
    Icon: HelpCircle,
  },
];

/** Aggregate identical canonical names only. The server owns vocabulary matching. */
function aggregateTechnologies(
  items: TechnicalEvidence[],
): TechnicalEvidence[] {
  const technologies = new Map<string, TechnicalEvidence>();
  for (const item of items) {
    const current = technologies.get(item.name);
    if (!current) {
      technologies.set(item.name, {
        ...item,
        job_references: [...item.job_references],
        candidate_evidence: [...item.candidate_evidence],
      });
      continue;
    }
    current.requires_interpretation ||= item.requires_interpretation;
    for (const reference of item.job_references) {
      const existing = current.job_references.find(
        (entry) =>
          entry.requirement_id === reference.requirement_id &&
          entry.origin === reference.origin &&
          entry.classification === reference.classification,
      );
      if (!existing) {
        current.job_references.push({
          ...reference,
          evidence: [...reference.evidence],
        });
      } else {
        // Never mutate the original response, including references copied above.
        const merged = [...existing.evidence];
        for (const evidence of reference.evidence) {
          if (
            !merged.some(
              (entry) =>
                entry.start === evidence.start &&
                entry.end === evidence.end &&
                entry.quote === evidence.quote,
            )
          ) {
            merged.push(evidence);
          }
        }
        current.job_references = current.job_references.map((entry) =>
          entry === existing ? { ...entry, evidence: merged } : entry,
        );
      }
    }
    for (const evidence of item.candidate_evidence) {
      if (
        !current.candidate_evidence.some(
          (entry) =>
            entry.field === evidence.field && entry.quote === evidence.quote &&
            entry.excerpt?.start === evidence.excerpt?.start &&
            entry.excerpt?.end === evidence.excerpt?.end,
        )
      ) {
        current.candidate_evidence.push(evidence);
      }
    }
  }
  return [...technologies.values()];
}

function EvidenceNotes({ title, notes }: { title: string; notes: string[] }) {
  if (!notes.length) return null;
  return (
    <details className="comparison-detail-section comparison-evidence-notes">
      <summary>{title} ({new Set(notes).size})</summary>
      <ul className="job-warning-list">
        {[...new Set(notes)].map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </details>
  );
}

function ProfileEvidence({ evidence, technology }: {
  evidence: CandidateRequirementEvidence;
  technology?: string;
}) {
  const span = evidence.excerpt;
  const source = Array.from(evidence.quote);
  // The API owns excerpt selection. Reject malformed spans rather than present
  // text that cannot be traced to the reviewed field. Python offsets count code
  // points, whereas JavaScript string offsets count UTF-16 code units.
  const exact = span && Number.isInteger(span.start) && Number.isInteger(span.end) &&
    span.start >= 0 && span.end > span.start && span.end <= source.length &&
    source.slice(span.start, span.end).join("") === span.quote;
  const quote = exact ? span.quote : evidence.quote;
  const shortened = exact && quote !== evidence.quote;
  return (
    <div className="comparison-profile-evidence">
      <blockquote>
        {technology && quote.trim().toLocaleLowerCase() === technology.toLocaleLowerCase()
          ? <mark>{quote}</mark>
          : quote}
        <small>Profile field: {evidence.field}</small>
        {shortened && <small>Field characters {span.start}–{span.end}</small>}
      </blockquote>
      {shortened && (
        <details className="comparison-full-field">
          <summary>View full reviewed field</summary>
          <p data-full-source>{evidence.quote}</p>
        </details>
      )}
    </div>
  );
}

function TechnologySources({ technology }: { technology: TechnicalEvidence }) {
  return (
    <details
      className="comparison-technology"
      aria-label={`Technical evidence for ${technology.name}`}
    >
      <summary aria-label={`View sources for ${technology.name}`}>
        <span className="comparison-technology-name">{technology.name}</span>
        {technology.requires_interpretation && (
          <span
            className="comparison-interpretation-flag"
            title="Associated source wording needs human interpretation"
          >
            Review
          </span>
        )}
        <span className="comparison-source-toggle" aria-hidden="true">
          <ChevronDown size={13} />
        </span>
      </summary>
      <div className={`comparison-technology-sources${technology.candidate_evidence.length ? "" : " comparison-evidence-stack"}`}>
        <div>
          <h5>Original job evidence</h5>
          {technology.job_references.map((reference, index) => (
            <div
              key={`${reference.requirement_id}-${index}`}
              className="comparison-source-reference"
            >
              <p className="comparison-source-label">
                Clause {reference.requirement_id} ·{" "}
                {reference.origin === "technical_environment"
                  ? "Technical environment"
                  : "Qualification"}{" "}
                · {classificationLabels[reference.classification]}
              </p>
              {reference.evidence.map((evidence, evidenceIndex) => (
                <blockquote key={evidenceIndex}>
                  {evidence.quote}
                  <small>
                    Source characters {evidence.start}–{evidence.end}
                  </small>
                </blockquote>
              ))}
            </div>
          ))}
        </div>
        <div>
          <h5>Reviewed CV evidence · unverified</h5>
          {technology.candidate_evidence.length > 0 && <p className="comparison-source-label">Supporting CV mention found</p>}
          {technology.candidate_evidence.length ? (
            technology.candidate_evidence.map((evidence, index) => (
              <ProfileEvidence key={index} evidence={evidence} technology={technology.name} />
            ))
          ) : (
            <p className="comparison-empty-evidence">
              No supporting mention found in the reviewed CV. This does not
              establish missing ability.
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

export function ComparisonResults({
  result,
  analysis,
}: {
  result: JobComparisonResponse;
  analysis: JobAnalysisResponse;
}) {
  const instanceId = useId();
  const [filter, setFilter] = useState<ComparisonStatus | "all">("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [inspectId, setInspectId] = useState<string | null>(null);
  const technologies = aggregateTechnologies(result.technical_evidence ?? []);
  const bothDocuments = technologies.filter(
    (item) => item.candidate_evidence.length > 0,
  );
  const withoutProfileEvidence = technologies.filter(
    (item) => item.candidate_evidence.length === 0,
  );
  const counts = Object.fromEntries(
    statuses.map(({ status }) => [
      status,
      result.comparisons.filter((item) => item.status === status).length,
    ]),
  ) as Record<ComparisonStatus, number>;
  const originalFor = (id: string) =>
    analysis.requirements.find((item) => item.id === id);
  const environmentOnly =
    result.comparisons.length > 0 &&
    result.comparisons.every(
      (item) =>
        item.origin === "technical_environment" ||
        originalFor(item.requirement_id)?.origin === "technical_environment",
    );
  const interpretationIds = new Set(
    technologies.flatMap((technology) =>
      technology.job_references
        .filter(
          (reference) =>
            reference.origin === "technical_environment" ||
            reference.classification === "unspecified",
        )
        .map((reference) => reference.requirement_id),
    ),
  );
  const interpretationClauses = result.comparisons.filter(
    (item) =>
      item.status === "needs_review" ||
      item.origin === "technical_environment" ||
      originalFor(item.requirement_id)?.origin === "technical_environment" ||
      originalFor(item.requirement_id)?.classification === "unspecified" ||
      interpretationIds.has(item.requirement_id),
  );
  const visible = result.comparisons.filter(
    (item) => filter === "all" || item.status === filter,
  );
  const evidenceId = (id: string) =>
    `${instanceId}-evidence-${result.comparisons.findIndex((item) => item.requirement_id === id)}`;
  const cardId = (id: string) =>
    `${instanceId}-clause-${result.comparisons.findIndex((item) => item.requirement_id === id)}`;

  useEffect(() => {
    if (!inspectId) return;
    const target = document.getElementById(inspectId);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    setInspectId(null);
  }, [inspectId]);

  function toggleEvidence(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function inspectClause(item: RequirementComparison) {
    setFilter("all");
    setExpanded((current) => new Set(current).add(item.requirement_id));
    setInspectId(cardId(item.requirement_id));
  }

  return (
    <div className="comparison-results">
      <section className="comparison-overview" aria-label="Comparison summary">
        <div className="comparison-section-heading">
          <div>
            <p className="comparison-eyebrow">Document comparison</p>
            <h3>Evidence at a glance</h3>
          </div>
          <span className="comparison-total">
            {result.comparisons.length}{" "}
            {result.comparisons.length === 1 ? "clause" : "clauses"}
          </span>
        </div>
        <div className="comparison-summary-grid">
          {statuses.map(({ status, title, description, Icon }) => (
            <div key={status} className={`comparison-summary-item ${status}`}>
              <Icon size={17} aria-hidden="true" />
              <strong>{counts[status]}</strong>
              <h4>{title}</h4>
              <p>{description}</p>
            </div>
          ))}
        </div>
        {environmentOnly && (
          <p className="comparison-environment-notice">
            These technologies describe the job's technical environment. Their
            presence does not establish mandatory candidate qualifications.
          </p>
        )}
        <details className="comparison-review-boundary">
          <summary>
            <ShieldCheck size={15} aria-hidden="true" /> Document evidence,
            interpreted by people
          </summary>
          <p>
            Profile information is unverified. Review confirmation is a claim
            from this browser session; it is not an authenticated approval.
            Final interpretation remains with the reviewer. A source mention
            does not verify expertise or proficiency.
          </p>
        </details>
      </section>

      <section
        className="comparison-technical-overview"
        aria-label="Technical Evidence Overview"
      >
        <div className="comparison-section-heading">
          <div>
            <h3>Technical Evidence Overview</h3>
            <p>
              Source mentions for inspection. CV information remains unverified.
              Select a technology to inspect its sources.
            </p>
          </div>
        </div>
        {technologies.length === 0 ? (
          <p className="comparison-empty-evidence">
            {result.technical_evidence === undefined
              ? "Technical overview is unavailable for this response. Inspect the requirement source evidence below; no technology overlap or absence is inferred."
              : "No supported technical mentions were returned for this comparison. Inspect qualification evidence below."}
          </p>
        ) : (
          <div className="comparison-technical-groups">
            <section
              aria-label="Mentioned in both documents"
              className="comparison-technical-group"
            >
              <h4>
                Mentioned in both documents{" "}
                <span className="count">{bothDocuments.length}</span>
              </h4>
              {bothDocuments.length ? (
                <div className="comparison-technology-list">
                  {bothDocuments.map((technology) => (
                    <TechnologySources
                      key={technology.name}
                      technology={technology}
                    />
                  ))}
                </div>
              ) : (
                <p className="comparison-empty-evidence">
                  No shared technical mentions were returned.
                </p>
              )}
            </section>
            <section
              aria-label="No supporting mention found in the reviewed CV"
              className="comparison-technical-group"
            >
              <h4>
                No supporting mention found in the reviewed CV{" "}
                <span className="count">{withoutProfileEvidence.length}</span>
              </h4>
              {withoutProfileEvidence.length ? (
                <div className="comparison-technology-list">
                  {withoutProfileEvidence.map((technology) => (
                    <TechnologySources
                      key={technology.name}
                      technology={technology}
                    />
                  ))}
                </div>
              ) : (
                <p className="comparison-empty-evidence">
                  Every returned job technology has a supporting CV mention.
                </p>
              )}
            </section>
          </div>
        )}
        <section
          aria-label="Requires interpretation"
          className="comparison-interpretation-section"
        >
          <h4>
            <HelpCircle size={15} aria-hidden="true" /> Requires interpretation{" "}
            <span className="count">{interpretationClauses.length}</span>
          </h4>
          {interpretationClauses.length ? (
            <>
              <p>
                These source clauses need interpretation. Technical mentions
                above do not establish mandatory qualifications.
              </p>
              <ul>
                {interpretationClauses.map((item) => (
                  <li key={item.requirement_id}>
                    <a
                      href={`#${cardId(item.requirement_id)}`}
                      onClick={(event) => {
                        event.preventDefault();
                        inspectClause(item);
                      }}
                    >
                      <span>{item.requirement_id}</span> {item.requirement_text}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p>No clauses were flagged for further interpretation.</p>
          )}
        </section>
      </section>

      <section
        aria-label="Requirement evidence"
        className="comparison-requirement-section"
      >
        <div className="comparison-section-heading">
          <div>
            <h3>Requirement evidence</h3>
            <p>
              Expand a clause to inspect its source, reviewed evidence and
              interpretation.
            </p>
          </div>
        </div>
        <div className="comparison-toolbar">
          <div
            className="comparison-filters"
            role="group"
            aria-label="Filter comparison results"
          >
            <button
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              All
            </button>
            {statuses.map(({ status, filter: label }) => (
              <button
                type="button"
                key={status}
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="comparison-expansion-controls">
            <button
              type="button"
              onClick={() =>
                setExpanded(
                  new Set(
                    result.comparisons.map((item) => item.requirement_id),
                  ),
                )
              }
              disabled={result.comparisons.length === 0}
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => setExpanded(new Set())}
              disabled={expanded.size === 0}
            >
              Collapse all
            </button>
          </div>
        </div>
        <p className="comparison-visible-count" role="status">
          Showing {visible.length} of {result.comparisons.length} clauses
        </p>
        {visible.length === 0 ? (
          <div className="comparison-empty-state">
            {result.comparisons.length
              ? "No clauses have this evidence status. Choose another filter to inspect the comparison."
              : "No comparison clauses were returned. Return to reviewed requirements to inspect the job analysis."}
          </div>
        ) : (
          <div className="comparison-card-list">
            {visible.map((item) => {
              const original = originalFor(item.requirement_id);
              const environment =
                item.origin === "technical_environment" ||
                original?.origin === "technical_environment";
              const isExpanded = expanded.has(item.requirement_id);
              const statusLabel =
                statuses.find((entry) => entry.status === item.status)?.title ??
                item.status;
              const corrected =
                original &&
                (original.text !== item.requirement_text ||
                  original.category !== item.category ||
                  original.classification !== item.classification);
              const skillNames = [
                ...new Set([
                  ...(original?.technical_skills.map((skill) => skill.name) ??
                    []),
                  ...technologies
                    .filter((technology) =>
                      technology.job_references.some(
                        (reference) =>
                          reference.requirement_id === item.requirement_id,
                      ),
                    )
                    .map((technology) => technology.name),
                ]),
              ];
              const conciseExplanation = environment
                ? "Technical environment mention — not an explicit candidate requirement."
                : item.status === "documented"
                  ? "Supporting evidence appears in the reviewed profile and remains unverified."
                  : item.status === "not_documented"
                    ? "No supporting information was found in the reviewed profile; this does not establish missing ability."
                    : "Source wording or available evidence needs human interpretation.";
              return (
                <article
                  className={`comparison-evidence-card ${item.status}`}
                  key={item.requirement_id}
                  id={cardId(item.requirement_id)}
                  tabIndex={-1}
                  aria-label={`Comparison ${item.requirement_id}`}
                >
                  <div className="comparison-card-header">
                    <div className="comparison-card-title">
                      <span className="comparison-clause-id">
                        {item.requirement_id}
                      </span>
                      <h4>{item.requirement_text}</h4>
                    </div>
                    <span className={`comparison-status ${item.status}`}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="comparison-card-meta">
                    <span>{classificationLabels[item.classification]}</span>
                    <span>{categoryLabels[item.category]}</span>
                    {environment && <span>Technical environment</span>}
                    {corrected && <span>Human correction</span>}
                  </div>
                  {skillNames.length > 0 && (
                    <div
                      className="comparison-tech-chips"
                      aria-label={`Job technologies for ${item.requirement_id}`}
                    >
                      {skillNames.map((name) => (
                        <span key={name}>{name}</span>
                      ))}
                    </div>
                  )}
                  <div className="comparison-card-footer">
                    <p>{conciseExplanation}</p>
                    <button
                      type="button"
                      className="comparison-expand-button"
                      aria-label={`${isExpanded ? "Collapse" : "Expand"} evidence for ${item.requirement_id}`}
                      aria-expanded={isExpanded}
                      aria-controls={
                        isExpanded ? evidenceId(item.requirement_id) : undefined
                      }
                      onClick={() => toggleEvidence(item.requirement_id)}
                    >
                      {isExpanded ? "Hide evidence" : "View evidence"}
                      <ChevronDown size={15} aria-hidden="true" />
                    </button>
                  </div>
                  {isExpanded && (
                    <section
                      className="comparison-expanded-evidence"
                      id={evidenceId(item.requirement_id)}
                      aria-label={`Evidence for ${item.requirement_id}`}
                    >
                      <div className="comparison-detail-section">
                        <h5>Interpretation</h5>
                        <p>{item.explanation}</p>
                      </div>
                      <div className={`job-evidence-grid${item.candidate_evidence.length && item.job_evidence.length ? "" : " comparison-evidence-stack"}`}>
                        <div>
                          <h5>Reviewed profile evidence · unverified</h5>
                          {item.candidate_evidence.length > 0 && <p className="comparison-source-label">Supporting CV mention found</p>}
                          {item.candidate_evidence.length ? (
                            item.candidate_evidence.map((evidence, index) => (
                              <ProfileEvidence key={index} evidence={evidence} />
                            ))
                          ) : (
                            <p className="comparison-empty-evidence">
                              No supporting profile excerpt returned. This does
                              not establish missing ability.
                            </p>
                          )}
                        </div>
                        <div>
                          <h5>Original job description evidence</h5>
                          {item.job_evidence.map((evidence, index) => (
                            <blockquote key={index}>
                              {evidence.quote}
                              <small>
                                Source characters {evidence.start}–
                                {evidence.end}
                              </small>
                            </blockquote>
                          ))}
                        </div>
                      </div>
                      <details className="comparison-detail-section comparison-evidence-notes">
                        <summary>Source and reviewed classification</summary>
                        <dl className="comparison-provenance">
                          <div>
                            <dt>Original wording</dt>
                            <dd>{item.original_requirement_text}</dd>
                          </div>
                          <div>
                            <dt>Original classification</dt>
                            <dd>
                              {original
                                ? classificationLabels[original.classification]
                                : "Not available in this analysis"}
                            </dd>
                          </div>
                          <div>
                            <dt>Reviewed classification</dt>
                            <dd>{classificationLabels[item.classification]}</dd>
                          </div>
                          <div>
                            <dt>Source origin</dt>
                            <dd>
                              {environment
                                ? "Technical environment"
                                : "Qualification"}
                            </dd>
                          </div>
                          <div>
                            <dt>Reviewed category</dt>
                            <dd>{categoryLabels[item.category]}</dd>
                          </div>
                        </dl>
                      </details>
                      <EvidenceNotes
                        title="Review notes"
                        notes={item.review_notes.filter(
                          (note) => !original?.warnings.includes(note),
                        )}
                      />
                      <EvidenceNotes
                        title="Source analysis notes"
                        notes={original?.warnings ?? []}
                      />
                    </section>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      {result.warnings.length > 0 && (
        <details className="comparison-result-notes">
          <summary>Comparison notes ({result.warnings.length})</summary>
          <ul className="job-warning-list">
            {result.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
