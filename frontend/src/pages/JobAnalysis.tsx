import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ClipboardList,
  FileText,
  HelpCircle,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { ComparisonResults } from "../components/ComparisonResults";
import { jobApi } from "../jobApi";
import { ApiError } from "../api";
import { comparisonBlockers } from "../comparison";
import { emptyJobSession, useJobSession } from "../jobSession";
import { qualificationSnapshot } from "../jobTypes";
import type {
  JobAnalysisResponse,
  JobMetadataField,
  JobRequirement,
  RequirementCategory,
  RequirementClassification,
  ReviewedRequirement,
} from "../jobTypes";
import { useSession } from "../session";
import "../jobAnalysis.css";

const MIN_TEXT_LENGTH = 30;
const MAX_TEXT_LENGTH = 30000;
const classifications: RequirementClassification[] = [
  "required",
  "preferred",
  "unspecified",
];
const classificationLabels: Record<RequirementClassification, string> = {
  required: "Required",
  preferred: "Preferred",
  unspecified: "Unspecified",
};
const categories: Record<RequirementCategory, string> = {
  technical_skill: "Technical skill",
  experience: "Experience",
  education: "Education",
  certification: "Certification",
  language: "Language",
  other: "Other / needs review",
};
const metadataFields: { field: JobMetadataField; label: string }[] = [
  { field: "title", label: "Job title" },
  { field: "company", label: "Company" },
  { field: "location", label: "Location" },
  { field: "employment_type", label: "Employment type" },
  { field: "work_mode", label: "Work mode" },
];

function JobMetadata({ analysis }: { analysis: JobAnalysisResponse }) {
  return (
    <dl className="job-summary">
      {metadataFields.map(({ field, label }) => {
        const evidence = analysis.job.metadata_evidence?.[field] ?? [];
        return (
          <div key={field}>
            <dt>{label}</dt>
            <dd>
              {analysis.job[field] ?? "Not provided explicitly"}
              {evidence.length > 0 && (
                <details className="job-source job-metadata-source">
                  <summary>
                    {field === "work_mode"
                      ? "Work mode source and schedule"
                      : `${label} source evidence`}
                  </summary>
                  {evidence.map((excerpt, index) => (
                    <blockquote key={index}>
                      {excerpt.quote}
                      <small>
                        Source characters {excerpt.start}–{excerpt.end}
                      </small>
                    </blockquote>
                  ))}
                </details>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <details className="job-source">
      <summary>Analysis notes ({warnings.length})</summary>
      <ul className="job-warning-list">
        {warnings.map((warning, index) => (
          <li key={index}>{warning}</li>
        ))}
      </ul>
    </details>
  );
}

function RequirementEditor({
  original,
  reviewed,
  disabled,
  onChange,
}: {
  original: JobRequirement;
  reviewed: ReviewedRequirement;
  disabled: boolean;
  onChange: (changes: Partial<ReviewedRequirement>) => void;
}) {
  const environment = original.origin === "technical_environment";
  const changed =
    original.text !== reviewed.text ||
    original.category !== reviewed.category ||
    original.classification !== reviewed.classification;
  return (
    <article
      className="job-requirement"
      aria-label={`Requirement ${original.id}`}
    >
      <div className="job-requirement-header">
        <h4>{original.text}</h4>
        <span className={`badge ${changed ? "violet" : "gray"}`}>
          {changed ? "Human correction" : "Original extraction"}
        </span>
      </div>
      <label htmlFor={`text-${original.id}`}>
        Requirement text {original.id}
      </label>
      <textarea
        id={`text-${original.id}`}
        value={reviewed.text}
        disabled={disabled}
        maxLength={2000}
        rows={2}
        onChange={(event) => onChange({ text: event.target.value })}
      />
      <div className="job-requirement-fields">
        <div>
          <label htmlFor={`classification-${original.id}`}>
            Classification {original.id}
          </label>
          <select
            id={`classification-${original.id}`}
            value={reviewed.classification}
            disabled={disabled}
            onChange={(event) =>
              onChange({
                classification: event.target.value as RequirementClassification,
              })
            }
          >
            {classifications.map((classification) => (
              <option key={classification} value={classification}>
                {classificationLabels[classification]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`category-${original.id}`}>
            Category {original.id}
          </label>
          <select
            id={`category-${original.id}`}
            value={reviewed.category}
            disabled={disabled}
            onChange={(event) =>
              onChange({ category: event.target.value as RequirementCategory })
            }
          >
            {Object.entries(categories).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="job-review-changes">
        Original: {classificationLabels[original.classification]} ·{" "}
        {categories[original.category]}
      </p>
      {environment && (
        <p className="job-environment-explanation">
          Listed in the technical environment. This mention alone does not
          establish a mandatory candidate qualification.
          {original.classification !== reviewed.classification && (
            <span>
              {" "}
              The edited classification is your reviewed interpretation; the
              original environment mention remains subject to human review
              during comparison.
            </span>
          )}
        </p>
      )}
      {original.technical_skills.length > 0 && (
        <div className="tags" aria-label="Source technical skills">
          {original.technical_skills.map((skill) => (
            <span className="tag" key={skill.name}>
              {skill.name}
            </span>
          ))}
        </div>
      )}
      <details className="job-source">
        <summary>Job source evidence</summary>
        {original.evidence.map((evidence, index) => (
          <blockquote key={index}>
            {evidence.quote}
            <small>
              Source characters {evidence.start}–{evidence.end}
            </small>
          </blockquote>
        ))}
      </details>
      <WarningList warnings={original.warnings} />
    </article>
  );
}

export function JobAnalysis() {
  const { candidates } = useSession();
  const awaitingCandidates = candidates.filter(
    (candidate) => !candidate.confirmed || !candidate.reviewedCandidate,
  );
  const { state, setState } = useJobSession();
  const [busy, setBusy] = useState<"analyze" | "compare" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selected = candidates.find(
    (candidate) => candidate.id === state.selectedId,
  );
  const reviewedProfile = selected?.confirmed
    ? selected.reviewedCandidate
    : undefined;
  const ready = !!reviewedProfile;
  const validText =
    state.text.length <= MAX_TEXT_LENGTH &&
    state.text.trim().length >= MIN_TEXT_LENGTH &&
    (state.text.match(/\p{L}/gu)?.length ?? 0) >= 15 &&
    !state.text.includes("\0");
  const validRequirements =
    state.requirements.length > 0 &&
    state.requirements.every((requirement) => !!requirement.text.trim());
  const blocked = !!busy;
  const comparisonProblems = comparisonBlockers({
    candidates,
    selectedId: state.selectedId,
    analysis: state.analysis,
    requirements: state.requirements,
    requirementsConfirmed: state.requirementsConfirmed,
    busy,
  });
  const canCompare = comparisonProblems.length === 0;
  const environmentRequirements = state.requirements.filter(
    (requirement) =>
      state.analysis?.requirements.find((entry) => entry.id === requirement.id)
        ?.origin === "technical_environment",
  );
  const qualificationRequirements = state.requirements.filter(
    (requirement) =>
      !environmentRequirements.some((entry) => entry.id === requirement.id),
  );
  const ambiguousQualifications = state.analysis?.requirements.some(
    (requirement) =>
      requirement.origin !== "technical_environment" &&
      requirement.classification === "unspecified",
  );

  function changeSource(text: string) {
    setError(null);
    setState((current) => ({
      ...current,
      text,
      analysis: null,
      requirements: [],
      requirementsConfirmed: false,
      comparison: null,
      view: "source",
      revision: current.revision + 1,
    }));
  }
  function selectCandidate(selectedId: string) {
    if (
      blocked ||
      (selectedId &&
        !candidates.some((candidate) => candidate.id === selectedId))
    )
      return;
    setError(null);
    setState((current) => ({
      ...current,
      selectedId,
      comparison: null,
      view: current.view === "results" ? "requirements" : current.view,
      revision: current.revision + 1,
    }));
  }
  function editRequirement(id: string, changes: Partial<ReviewedRequirement>) {
    setError(null);
    setState((current) => ({
      ...current,
      requirements: current.requirements.map((requirement) =>
        requirement.id === id ? { ...requirement, ...changes } : requirement,
      ),
      requirementsConfirmed: false,
      comparison: null,
      revision: current.revision + 1,
    }));
  }
  async function analyze(event: FormEvent) {
    event.preventDefault();
    if (!validText || blocked) return;
    const revision = state.revision;
    setBusy("analyze");
    setError(null);
    try {
      const analysis = await jobApi.analyze(state.text);
      if (!mounted.current) return;
      setState((current) =>
        current.revision !== revision
          ? current
          : {
              ...current,
              analysis,
              requirements: analysis.requirements.map(
                ({ id, text, category, classification }) => ({
                  id,
                  text,
                  category,
                  classification,
                }),
              ),
              requirementsConfirmed: false,
              comparison: null,
              view: "requirements",
              revision: current.revision + 1,
            },
      );
    } catch (caught) {
      if (mounted.current)
        setError(
          caught instanceof Error
            ? caught.message
            : "Job analysis failed. Please try again.",
        );
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  async function compare() {
    if (!canCompare || !reviewedProfile || !state.analysis) return;
    const revision = state.revision;
    const candidate = qualificationSnapshot(reviewedProfile);
    const requirements = state.requirements.map((requirement) => ({
      ...requirement,
      text: requirement.text.trim(),
    }));
    setBusy("compare");
    setError(null);
    try {
      const comparison = await jobApi.compare({
        candidate,
        job_analysis: state.analysis,
        requirements,
        review: {
          candidate_confirmed: true,
          candidate_snapshot: qualificationSnapshot(reviewedProfile),
          requirements_reviewed: true,
          requirement_snapshot: requirements.map((requirement) => ({
            ...requirement,
          })),
        },
      });
      if (!mounted.current) return;
      setState((current) =>
        current.revision !== revision
          ? current
          : { ...current, comparison, view: "results" },
      );
    } catch (caught) {
      if (!mounted.current) return;
      if (caught instanceof ApiError && caught.code === "source_mismatch") {
        setState((current) => ({
          ...current,
          analysis: null,
          requirements: [],
          comparison: null,
          requirementsConfirmed: false,
          view: "source",
          revision: current.revision + 1,
        }));
        setError(
          "The original job analysis no longer matches the backend source checks. Select Analyze requirements again, review the fresh excerpts and confirm the job review before retrying.",
        );
      } else if (
        caught instanceof ApiError &&
        ["review_stale", "review_required"].includes(caught.code ?? "")
      ) {
        setState((current) => ({
          ...current,
          comparison: null,
          requirementsConfirmed: false,
          view: "requirements",
          revision: current.revision + 1,
        }));
        setError(
          `${caught.message} Confirm the current candidate profile and check the job requirement review acknowledgment again.`,
        );
      } else {
        const action =
          caught instanceof ApiError &&
          caught.validationIssues.some(
            (issue) =>
              issue.path[0] === "candidate" ||
              issue.path.includes("candidate_snapshot"),
          )
            ? " Open the selected profile, correct the listed qualification fields and confirm it again."
            : caught instanceof ApiError &&
                ["unsupported_correction", "unsupported_category"].includes(
                  caught.code ?? "",
                )
              ? " Restore the source-supported wording or category, or edit the source description and analyze it again."
              : "";
        setError(
          `${caught instanceof Error ? caught.message : "Evidence comparison failed. Please try again."}${action}`,
        );
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
  }
  function reset() {
    setError(null);
    setState((current) => ({
      ...emptyJobSession(),
      selectedId: current.selectedId,
      revision: current.revision + 1,
    }));
  }

  const hasReviewFooter =
    !!state.analysis &&
    state.view === "requirements" &&
    state.requirements.length > 0;

  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REQUIREMENTS & SOURCE EVIDENCE</span>
          <h1>Job Analysis</h1>
          <p>
            Review explicit job requirements and compare the information in a
            confirmed profile.
          </p>
        </div>
        <span className="badge violet">
          <ClipboardList size={14} />
          French & English
        </span>
      </div>
      <div className="job-workflow">
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
        <div className="job-input-grid">
          <section className="card">
            <div className="section-heading">
              <div className="icon-box">
                <FileText size={20} />
              </div>
              <div>
                <h2>
                  {state.analysis
                    ? "Job description & reviewed requirements"
                    : "Enter a job description"}
                </h2>
                <p>Local, deterministic analysis with source excerpts.</p>
              </div>
            </div>
            {state.analysis && (
              <>
                {state.view === "results" ? (
                  <details className="job-source job-results-context">
                    <summary>Job context and source evidence</summary>
                    <JobMetadata analysis={state.analysis} />
                  </details>
                ) : (
                  <JobMetadata analysis={state.analysis} />
                )}
                <div className="job-tabs" aria-label="Review views">
                  <button
                    type="button"
                    aria-pressed={state.view === "source"}
                    disabled={blocked}
                    onClick={() =>
                      setState((current) => ({ ...current, view: "source" }))
                    }
                  >
                    Source description
                  </button>
                  <button
                    type="button"
                    aria-pressed={state.view === "requirements"}
                    disabled={blocked}
                    onClick={() =>
                      setState((current) => ({
                        ...current,
                        view: "requirements",
                      }))
                    }
                  >
                    Reviewed requirements
                  </button>
                  <button
                    type="button"
                    aria-pressed={state.view === "results"}
                    disabled={blocked || !state.comparison}
                    onClick={() =>
                      setState((current) => ({ ...current, view: "results" }))
                    }
                  >
                    Comparison results
                  </button>
                </div>
              </>
            )}
            {(!state.analysis || state.view === "source") && (
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
                        <LoaderCircle size={17} className="spin" />
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
            )}
            {state.analysis && state.view === "requirements" && (
              <>
                <WarningList warnings={state.analysis.warnings} />
                {state.analysis.warnings.length > 0 && (
                  <p className="job-analysis-status" role="status">
                    Analysis completed with notes. Review the analysis notes and
                    original evidence before confirming.
                  </p>
                )}
                {!state.requirements.length ? (
                  <div className="job-empty">
                    <HelpCircle size={29} />
                    <h3>
                      No job-related qualifications or technical information
                      detected
                    </h3>
                    <p>
                      Check that the pasted description includes qualifications
                      or a technical environment. Return to the source to add
                      missing job text; no requirements have been invented.
                    </p>
                    <button
                      className="button secondary"
                      onClick={() =>
                        setState((current) => ({ ...current, view: "source" }))
                      }
                    >
                      Return to source description
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="job-boundary" style={{ marginTop: 18 }}>
                      Correct the wording and labels against the source.
                      Technical skills and evidence remain tied to the original
                      excerpt. Editing clears your confirmation. Unsupported
                      additions are rejected by the comparison API.
                    </p>
                    {environmentRequirements.length > 0 &&
                      qualificationRequirements.length === 0 && (
                        <div className="notice info job-analysis-status">
                          <HelpCircle size={18} />
                          <div>
                            <strong>Technical environment extracted</strong>
                            <p>
                              No mandatory qualifications are explicitly stated.
                              Review the environment mentions below and return
                              to the source if qualification text is missing.
                              Environment evidence remains subject to human
                              interpretation during comparison.
                            </p>
                          </div>
                        </div>
                      )}
                    {ambiguousQualifications && (
                      <p className="job-analysis-status">
                        Some qualification classifications are unspecified.
                        Their required or preferred status is unclear in the
                        original source; review the excerpts before confirming.
                      </p>
                    )}
                    {classifications.map((classification) => {
                      const requirements = qualificationRequirements.filter(
                        (requirement) =>
                          requirement.classification === classification,
                      );
                      return (
                        <section
                          className="job-requirement-group"
                          key={classification}
                          aria-label={`${classificationLabels[classification]} criteria`}
                        >
                          <h3>
                            {classificationLabels[classification]} criteria
                            <span className="count">{requirements.length}</span>
                          </h3>
                          {requirements.length ? (
                            requirements.map((requirement) => {
                              const original =
                                state.analysis!.requirements.find(
                                  (item) => item.id === requirement.id,
                                )!;
                              return (
                                <RequirementEditor
                                  key={requirement.id}
                                  original={original}
                                  reviewed={requirement}
                                  disabled={blocked}
                                  onChange={(changes) =>
                                    editRequirement(requirement.id, changes)
                                  }
                                />
                              );
                            })
                          ) : (
                            <p className="job-no-items">
                              No criteria in this section.
                            </p>
                          )}
                        </section>
                      );
                    })}
                    {environmentRequirements.length > 0 && (
                      <section
                        className="job-requirement-group job-environment-group"
                        aria-label="Technical environment mentions"
                      >
                        <h3>
                          Technical environment mentions
                          <span className="count">
                            {environmentRequirements.length}
                          </span>
                        </h3>
                        <p className="job-boundary">
                          These technologies appear in an environment or stack
                          list. Their original requirement status is
                          unspecified; they are separate from qualifications.
                        </p>
                        {environmentRequirements.map((requirement) => {
                          const original = state.analysis!.requirements.find(
                            (item) => item.id === requirement.id,
                          )!;
                          return (
                            <RequirementEditor
                              key={requirement.id}
                              original={original}
                              reviewed={requirement}
                              disabled={blocked}
                              onChange={(changes) =>
                                editRequirement(requirement.id, changes)
                              }
                            />
                          );
                        })}
                      </section>
                    )}
                  </>
                )}
              </>
            )}
            {state.analysis && state.view === "results" && state.comparison && (
              <>
                <div className="job-results-header" style={{ marginTop: 22 }}>
                  <div>
                    <h2>Requirement evidence checklist</h2>
                    <p>
                      Reviewed profile:{" "}
                      {selected?.reviewedCandidate?.full_name ??
                        selected?.filename ??
                        "Session profile"}
                    </p>
                  </div>
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
                <div style={{ marginTop: 18 }}>
                  <ComparisonResults
                    result={state.comparison}
                    analysis={state.analysis}
                  />
                </div>
              </>
            )}
            {state.view !== "results" && (
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
                          <LoaderCircle size={17} className="spin" />
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
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {busy && (
              <p className="job-loading" role="status">
                <LoaderCircle size={15} className="spin" />
                {busy === "analyze"
                  ? "Reading explicit requirements from your description."
                  : "Checking qualification evidence in the reviewed profile."}
              </p>
            )}
          </section>
          <aside className="job-aside">
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
          </aside>
        </div>
      </div>
    </>
  );
}
