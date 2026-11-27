import type {
  CVParsingResponse,
  HealthResponse,
  ExtractionConfig,
} from "./types";

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(
  /\/+$/,
  "",
);
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export interface ApiValidationIssue {
  path: (string | number)[];
  message: string;
}
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly validationIssues: ApiValidationIssue[] = [],
    public readonly detail?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
function validationIssues(body: unknown): ApiValidationIssue[] {
  if (
    !body ||
    typeof body !== "object" ||
    !("detail" in body) ||
    !Array.isArray(body.detail)
  )
    return [];
  return body.detail.map((item: unknown) => {
    if (!item || typeof item !== "object")
      return { path: [], message: "Invalid request" };
    const path =
      "loc" in item && Array.isArray(item.loc)
        ? item.loc.filter(
            (part): part is string | number =>
              typeof part === "string" || typeof part === "number",
          )
        : [];
    return {
      path: path[0] === "body" ? path.slice(1) : path,
      message:
        "msg" in item && typeof item.msg === "string"
          ? item.msg
          : "Invalid request",
    };
  });
}
function errorDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("detail" in body))
    return undefined;
  const detail = body.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return validationIssues(body)
      .map((issue) =>
        issue.path.length
          ? `${issue.path.join(".")}: ${issue.message}`
          : issue.message,
      )
      .join("; ");
  if (
    detail &&
    typeof detail === "object" &&
    "message" in detail &&
    typeof detail.message === "string"
  )
    return detail.message;
}
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code =
        body &&
        typeof body === "object" &&
        "detail" in body &&
        body.detail &&
        typeof body.detail === "object" &&
        "code" in body.detail
          ? String(body.detail.code)
          : undefined;
      throw new ApiError(
        errorDetail(body) ??
          `The API returned an error (${response.status}). Please try again.`,
        response.status,
        code,
        validationIssues(body),
        // Preserve only the purpose-limited agent failure trace. FastAPI validation
        // entries can contain rejected private inputs and must never be retained.
        body && typeof body === "object" && "detail" in body &&
          body.detail && typeof body.detail === "object" &&
          !Array.isArray(body.detail) && "workflow" in body.detail
          ? { workflow: body.detail.workflow }
          : undefined,
      );
    }
    if (body === null)
      throw new ApiError(
        "The API returned an unreadable response. Please try again.",
      );
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new ApiError("The request timed out. Please try again.");
    throw new ApiError(
      "Unable to reach the backend. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
  }
}
export async function validatePdf(file: File): Promise<string | null> {
  if (
    !/\.pdf$/i.test(file.name) ||
    (file.type && file.type !== "application/pdf")
  )
    return "Choose a PDF file (.pdf).";
  if (file.size === 0)
    return "This file is empty. Choose a PDF containing text.";
  if (file.size > MAX_PDF_BYTES) return "This PDF exceeds the 5 MiB limit.";
  const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (String.fromCharCode(...header) !== "%PDF-")
    return "This file does not have a valid PDF header.";
  return null;
}
export const api = {
  health: () => request<HealthResponse>("/api/v1/health"),
  extractionConfig: () =>
    request<ExtractionConfig>("/api/v1/candidates/extraction-config"),
  parse: (file: File, modelConsent = false) => {
    const body = new FormData();
    body.append("file", file);
    if (modelConsent) {
      body.append("use_llm", "true");
      body.append("external_consent", "true");
    }
    return request<CVParsingResponse>("/api/v1/candidates/parse", {
      method: "POST",
      body,
    });
  },
};
