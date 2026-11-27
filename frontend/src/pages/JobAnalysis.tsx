import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ClipboardList, FileText, RotateCcw } from "lucide-react";
import { ComparisonResults } from "../components/ComparisonResults";
import { CandidatePanel } from "../components/job/CandidatePanel";
import { EvidenceContextCard } from "../components/job/EvidenceContextCard";
import { JobMetadata } from "../components/job/JobMetadata";
import { JobSourceForm } from "../components/job/JobSourceForm";
import { JobWorkflowSteps } from "../components/job/JobWorkflowSteps";
import { RequirementsReview } from "../components/job/RequirementsReview";
import { ReviewFooter } from "../components/job/ReviewFooter";
import { MAX_TEXT_LENGTH, MIN_TEXT_LENGTH } from "../components/job/shared";
import { jobApi } from "../jobApi";
import { ApiError } from "../api";
import { comparisonBlockers } from "../comparison";
import { emptyJobSession, useJobSession } from "../jobSession";
import { qualificationSnapshot } from "../jobTypes";
import type { ReviewedRequirement } from "../jobTypes";
import { useSession } from "../session";
import "../jobAnalysis.css";

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
        <JobWorkflowSteps state={state} />
        <div className={`job-input-grid${state.view === "results" && state.comparison ? " job-results-layout" : ""}`}>
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
              <JobSourceForm state={state} blocked={blocked} busy={busy} validText={validText} analyze={analyze} changeSource={changeSource} reset={reset} />
            )}
            {state.analysis && state.view === "requirements" && (
              <RequirementsReview state={{ ...state, analysis: state.analysis }} setState={setState} blocked={blocked} environmentRequirements={environmentRequirements} qualificationRequirements={qualificationRequirements} ambiguousQualifications={ambiguousQualifications} editRequirement={editRequirement} />
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
              <ReviewFooter state={state} setState={setState} hasReviewFooter={hasReviewFooter} blocked={blocked} busy={busy} validRequirements={validRequirements} canCompare={canCompare} comparisonProblems={comparisonProblems} selected={selected} ready={ready} compare={compare} reset={reset} />
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {busy && (
              <p className="job-loading" role="status">
                <span className="busy-dot" aria-hidden="true" />
                {busy === "analyze"
                  ? "Reading explicit requirements from your description."
                  : "Checking qualification evidence in the reviewed profile."}
              </p>
            )}
          </section>
          <aside className="job-aside">
            <CandidatePanel candidates={candidates} selected={selected} ready={ready} awaitingCandidates={awaitingCandidates} blocked={blocked} selectCandidate={selectCandidate} />
            <EvidenceContextCard />
          </aside>
        </div>
      </div>
    </>
  );
}
