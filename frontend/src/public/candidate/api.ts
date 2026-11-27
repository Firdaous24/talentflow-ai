import { call } from "../../auth/api";
import type { CVVersionSummary } from "../../auth/api";
import type { CandidateProfile, CVParsingResponse } from "../../types";
import type { JobAnalysisResponse, RequirementCategory, RequirementClassification, RequirementComparison, ReviewedRequirement, TechnicalEvidence } from "../../jobTypes";

/** Candidate space (/api/v2/me): every response is the signed-in candidate's own data. */
export interface CVVersionDetail extends CVVersionSummary {
  parsed: CVParsingResponse;
  reviewed_profile: CandidateProfile | null;
}
export type ProfileSection = "education" | "experience" | "technical_skills" | "projects" | "certifications" | "languages";
export interface CVDiff {
  from_version: { id: string; number: number };
  to_version: { id: string; number: number };
  fields: { field: string; change: "added" | "removed" | "changed" }[];
  sections: { section: ProfileSection; added: string[]; removed: string[]; unchanged: number }[];
}
export interface TargetSummary { id: string; title: string | null; created_at: string; requirement_count: number; criteria_confirmed_at: string | null }
export interface TargetDetail extends TargetSummary {
  source_text: string;
  analysis: JobAnalysisResponse;
  requirements: ReviewedRequirement[];
  requirements_reviewed: boolean;
}
export interface CoverageCounts {
  required_documented: number;
  required_total: number;
  preferred_documented: number;
  preferred_total: number;
  unspecified_documented: number;
  unspecified_total: number;
  needs_review: number;
}
export interface CoverageReport {
  target_id: string;
  cv_version: { id: string; number: number };
  counts: CoverageCounts;
  comparisons: RequirementComparison[];
  technical_evidence: TechnicalEvidence[];
  warnings: string[];
  notice: "documentary_coverage_not_competence";
}
export interface Gap {
  requirement_id: string;
  requirement_text: string;
  category: RequirementCategory;
  classification: RequirementClassification;
  status: "not_documented" | "needs_review";
  kind: "add_if_true" | "interpretation";
  section: ProfileSection;
  reason: "duration_or_level" | "equivalence" | "language_level" | "context" | null;
}

export const candidateApi = {
  versions: () => call<CVVersionSummary[]>("GET", "/api/v2/me/cv/versions"),
  version: (id: string) => call<CVVersionDetail>("GET", `/api/v2/me/cv/versions/${id}`),
  upload(file: File, keepOriginal: boolean) {
    const form = new FormData();
    form.append("file", file);
    form.append("keep_original", keepOriginal ? "true" : "false");
    return call<CVVersionDetail>("POST", "/api/v2/me/cv", form);
  },
  review: (id: string, profile: CandidateProfile) => call<CVVersionDetail>("PUT", `/api/v2/me/cv/versions/${id}/review`, { profile }),
  confirm: (id: string) => call<CVVersionDetail>("POST", `/api/v2/me/cv/versions/${id}/confirm`, { warnings_acknowledged: true }),
  diff: (from: string, to: string) => call<CVDiff>("GET", `/api/v2/me/cv/diff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  targets: () => call<TargetSummary[]>("GET", "/api/v2/me/targets"),
  target: (id: string) => call<TargetDetail>("GET", `/api/v2/me/targets/${id}`),
  createTarget: (text: string) => call<TargetDetail>("POST", "/api/v2/me/targets", { text }),
  saveRequirements: (id: string, requirements: ReviewedRequirement[]) => call<TargetDetail>("PUT", `/api/v2/me/targets/${id}/requirements`, { requirements }),
  confirmRequirements: (id: string) => call<TargetDetail>("POST", `/api/v2/me/targets/${id}/confirm`),
  deleteTarget: (id: string) => call<null>("DELETE", `/api/v2/me/targets/${id}`),
  coverage: (id: string) => call<CoverageReport>("GET", `/api/v2/me/targets/${id}/coverage`),
  gaps: (id: string) => call<{ target_id: string; cv_version: { id: string; number: number }; gaps: Gap[] }>("GET", `/api/v2/me/targets/${id}/gaps`),
  exportData: () => call<Record<string, unknown>>("GET", "/api/v2/me/export"),
};

/** Saves a JSON document through a temporary link: nothing is written to browser storage. */
export function downloadJson(data: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
