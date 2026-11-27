import type { SessionCandidate } from "./types";
import type { JobAnalysisResponse, ReviewedRequirement } from "./jobTypes";
import { qualificationSnapshot } from "./jobTypes";

export interface ComparisonBlocker {
  code: string;
  message: string;
  reviewProfile?: boolean;
}

interface ComparisonState {
  candidates: SessionCandidate[];
  selectedId: string;
  analysis: JobAnalysisResponse | null;
  requirements: ReviewedRequirement[];
  requirementsConfirmed: boolean;
  busy: "analyze" | "compare" | null;
}

// Matches the purpose-limited QualificationProfile contract; never truncate evidence.
const MAX_QUALIFICATION_ITEMS = 100;
const collectionLabels = {
  education: "Education",
  experience: "Experience",
  technical_skills: "Technical skills",
  projects: "Projects",
  certifications: "Certifications",
  languages: "Languages",
};

export function comparisonBlockers(
  state: ComparisonState,
): ComparisonBlocker[] {
  if (state.busy)
    return [
      {
        code: "request_pending",
        message:
          state.busy === "analyze"
            ? "Wait for job analysis to finish before comparing."
            : "The comparison is in progress. Wait for the evidence results.",
      },
    ];

  const blockers: ComparisonBlocker[] = [];
  const selected = state.candidates.find(
    (candidate) => candidate.id === state.selectedId,
  );
  if (!state.candidates.length) {
    blockers.push({
      code: "candidate_missing",
      message:
        "Upload a CV and select a candidate before comparison.",
    });
  } else if (!state.selectedId) {
    blockers.push({
      code: "candidate_not_selected",
      message: "Select a candidate from Candidate profile.",
    });
    if (
      !state.candidates.some(
        (candidate) => candidate.confirmed && candidate.reviewedCandidate,
      )
    )
      blockers.push({
        code: "candidate_review_required",
        message:
          "No session profile is confirmed. Select a candidate, then review and confirm it before comparison.",
      });
  } else if (!selected) {
    blockers.push({
      code: "candidate_unavailable",
      message:
        "The selected profile is no longer in this session. Choose another profile.",
    });
  } else if (!selected.confirmed || !selected.reviewedCandidate) {
    blockers.push({
      code: "candidate_review_required",
      message:
        "This candidate must be reviewed and confirmed before comparison.",
      reviewProfile: true,
    });
  } else {
    const snapshot = qualificationSnapshot(selected.reviewedCandidate);
    for (const collection of Object.keys(
      collectionLabels,
    ) as (keyof typeof collectionLabels)[]) {
      const count = snapshot[collection].length;
      if (count > MAX_QUALIFICATION_ITEMS)
        blockers.push({
          code: `profile_limit_${collection}`,
          message: `${collectionLabels[collection]} has ${count} entries. Comparison accepts at most ${MAX_QUALIFICATION_ITEMS}; review the profile and remove extra entries.`,
          reviewProfile: true,
        });
    }
    for (const [collection, label] of [
      ["experience", "Experience"],
      ["projects", "Project"],
    ] as const) {
      snapshot[collection].forEach((record, index) => {
        if (record.technologies.length > MAX_QUALIFICATION_ITEMS)
          blockers.push({
            code: `profile_limit_${collection}_${index}_technologies`,
            message: `${label} ${index + 1} lists ${record.technologies.length} technologies. Comparison accepts at most ${MAX_QUALIFICATION_ITEMS}; review the profile and remove extra entries.`,
            reviewProfile: true,
          });
      });
    }
  }

  if (!state.analysis) {
    blockers.push({
      code: "analysis_missing",
      message: "Analyze the job description before comparing evidence.",
    });
  } else if (!state.requirements.length) {
    blockers.push({
      code: "requirements_missing",
      message:
        "No supported qualifications or environment mentions are available to compare. Review the source and analyze it again.",
    });
  } else {
    state.requirements.forEach((requirement) => {
      if (!requirement.text.trim())
        blockers.push({
          code: `requirement_empty_${requirement.id}`,
          message: `Enter requirement text for ${requirement.id} before confirming the job review.`,
        });
    });
    if (!state.requirementsConfirmed)
      blockers.push({
        code: "requirements_review_required",
        message:
          "Check the job requirement review acknowledgment after reviewing the wording, classifications and source evidence.",
      });
  }
  return blockers;
}
