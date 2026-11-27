import { request } from "./api";
import type {
  JobAnalysisResponse,
  JobComparisonRequest,
  JobComparisonResponse,
} from "./jobTypes";

export const jobApi = {
  analyze: (text: string) =>
    request<JobAnalysisResponse>("/api/v1/jobs/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  compare: (payload: JobComparisonRequest) =>
    request<JobComparisonResponse>("/api/v1/jobs/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
};
