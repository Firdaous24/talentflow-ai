import { call } from "../../auth/api";
import type { QualificationProfile, RequirementComparison, ReviewedRequirement, TechnicalEvidence } from "../../jobTypes";
import type { TargetDetail } from "../candidate/api";

/** Recruiter space (/api/v2/orgs/{id}/…). Ranking and match payloads are anonymous unless a reveal was made. */
export type JobStatus = "draft" | "open" | "closed";
export type Visibility = "private" | "public";
export type RevealReason = "interview_scheduled" | "reference_check" | "candidate_request" | "other";
export interface OrgJobSummary { id: string; title: string | null; created_at: string; status: JobStatus; visibility: Visibility; requirement_count: number; criteria_confirmed_at: string | null; ranked: number; pending: number; to_review: number }
export interface OrgJobDetail extends TargetDetail { status: JobStatus; visibility: Visibility }
export interface ImportBatch {
  id: string;
  job_id: string;
  file_count: number;
  uploaded: number;
  attested_at: string;
  attestation_version: string;
  created_at: string;
  expires_at: string;
  progress: { queued: number; parsing: number; parsed: number; failed: number; duplicate: number };
  failures: { position: number; status: "failed" | "duplicate"; error_code: string | null }[];
}
export interface ReviewItem { profile_id: string; batch_id: string; position: number; page_count: number; qualifications: QualificationProfile; warnings: string[]; expires_at: string }
export interface Counts { required_documented: number; required_total: number; preferred_documented: number; preferred_total: number; needs_review: number }
export interface RankingEntry { match_id: string; alias: number; source: "import" | "application"; counts: Counts; identity_revealed: boolean }
export interface RankingGroup { required_documented: number; preferred_documented: number; needs_review: number; tie_order: "arrival_not_meaningful"; entries: RankingEntry[] }
export interface Ranking { job_id: string; notice: string; sort_key: string; groups: RankingGroup[]; pending: number; to_review: number }
export interface Identity { full_name: string | null; email: string | null; phone: string | null; linkedin_url: string | null; github_url: string | null }
export interface MatchDetail {
  match_id: string;
  job_id: string;
  alias: number;
  source: "import" | "application";
  counts: Counts;
  comparisons: RequirementComparison[];
  technical_evidence: TechnicalEvidence[];
  job_source_text: string;
  imported_profile_id: string | null;
  identity_revealed_at: string | null;
  reveal_reason: RevealReason | null;
  identity: Identity | null;
}

export function recruiterApi(org: string) {
  const base = `/api/v2/orgs/${org}`;
  return {
    jobs: () => call<OrgJobSummary[]>("GET", `${base}/jobs`),
    job: (id: string) => call<OrgJobDetail>("GET", `${base}/jobs/${id}`),
    createJob: (text: string) => call<OrgJobDetail>("POST", `${base}/jobs`, { text }),
    updateJob: (id: string, patch: { status?: JobStatus; visibility?: Visibility }) => call<OrgJobDetail>("PATCH", `${base}/jobs/${id}`, patch),
    deleteJob: (id: string) => call<null>("DELETE", `${base}/jobs/${id}`),
    saveRequirements: (id: string, requirements: ReviewedRequirement[]) => call<OrgJobDetail>("PUT", `${base}/jobs/${id}/requirements`, { requirements }),
    confirmRequirements: (id: string) => call<OrgJobDetail>("POST", `${base}/jobs/${id}/confirm`),
    imports: (job: string) => call<ImportBatch[]>("GET", `${base}/jobs/${job}/imports`),
    createImport: (job: string, fileCount: number) => call<ImportBatch>("POST", `${base}/jobs/${job}/imports`, { attestation: true, file_count: fileCount }),
    uploadFile(batch: string, file: File) {
      const form = new FormData();
      form.append("file", file);
      return call<{ position: number; status: string }>("POST", `${base}/imports/${batch}/files`, form);
    },
    reviewQueue: (job: string) => call<ReviewItem[]>("GET", `${base}/jobs/${job}/review-queue`),
    confirmProfile: (profile: string) => call<RankingEntry>("POST", `${base}/profiles/${profile}/confirm`, { warnings_acknowledged: true }),
    deleteProfile: (profile: string) => call<null>("DELETE", `${base}/profiles/${profile}`),
    invitation: (profile: string) => call<{ url: string; expires_at: string }>("POST", `${base}/profiles/${profile}/invitation`),
    ranking: (job: string) => call<Ranking>("GET", `${base}/jobs/${job}/ranking`),
    match: (id: string) => call<MatchDetail>("GET", `${base}/matches/${id}`),
    reveal: (id: string, reason: RevealReason, note: string) => call<MatchDetail>("POST", `${base}/matches/${id}/reveal`, { reason, note }),
  };
}

export interface PublicJob { id: string; title: string | null; organization: string; requirement_count: number; applied: boolean }
export interface Application { id: string; job_id: string; job_title: string | null; organization: string; created_at: string; visible_to_recruiters: boolean }

export const applicationsApi = {
  publicJobs: () => call<PublicJob[]>("GET", "/api/v2/me/public-jobs"),
  list: () => call<Application[]>("GET", "/api/v2/me/applications"),
  apply: (jobId: string) => call<Application>("POST", "/api/v2/me/applications", { job_id: jobId }),
  withdraw: (id: string) => call<null>("DELETE", `/api/v2/me/applications/${id}`),
  inspectClaim: (token: string) => call<{ organization: string; job_title: string | null; expires_at: string }>("POST", "/api/v2/claims/inspect", { token }),
  deleteByClaim: (token: string) => call<null>("POST", "/api/v2/claims/delete", { token }),
  acceptClaim: (token: string) => call<null>("POST", "/api/v2/claims/accept", { token }),
};
