import { API_BASE_URL } from "../api";

/**
 * Client for /api/v2 (accounts). The session lives in an httpOnly cookie that
 * JavaScript never reads; unsafe requests carry the CSRF token from
 * GET /api/v2/auth/csrf, refreshed once if the server rejects it.
 */
export type Role = "candidate" | "recruiter" | "admin";
export type Locale = "fr" | "en";
export interface OrganizationSummary { id: string; name: string; org_role: "owner" | "member" }
export interface Account { id: string; email: string; role: Role; locale: Locale; email_verified: boolean; created_at: string; organizations: OrganizationSummary[] }
export interface Organization extends OrganizationSummary { created_at: string; member_count: number }
export type ConsentPurpose = "processing" | "recruiter_visibility" | "model_assistance" | "marketing";
export interface ConsentState { purpose: ConsentPurpose; granted: boolean; policy_version: string | null; granted_at: string | null }
export interface Consents { current_policy_version: string; consents: ConsentState[]; history: { purpose: ConsentPurpose; policy_version: string; granted_at: string; withdrawn_at: string | null }[] }
export interface CandidateOverview { cv_versions: number; recruiter_visibility: boolean; next_step: string }
export interface RegisterInput { email: string; password: string; role: "candidate" | "recruiter"; locale: Locale; accept_terms: true; marketing: boolean }

export class AuthApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "AuthApiError";
  }
}

let csrfToken: string | null = null;

export function resetCsrf() {
  csrfToken = null;
}

async function parse(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = csrfToken ?? (await fetchCsrf());
  try {
    return await fetch(`${API_BASE_URL}${path}`, { method, headers, credentials: "same-origin", body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new AuthApiError(0, "network", "Network error");
  }
}

async function fetchCsrf(): Promise<string> {
  const response = await send("GET", "/api/v2/auth/csrf");
  const data = (await parse(response)) as { csrf_token?: string } | null;
  if (!response.ok || !data?.csrf_token) throw toError(response, data);
  csrfToken = data.csrf_token;
  return csrfToken;
}

function toError(response: Response, data: unknown): AuthApiError {
  const detail = data && typeof data === "object" && "detail" in data ? (data as { detail: unknown }).detail : null;
  const code = detail && typeof detail === "object" && "code" in detail ? String((detail as { code: unknown }).code) : `http_${response.status}`;
  const message = detail && typeof detail === "object" && "message" in detail ? String((detail as { message: unknown }).message) : response.statusText;
  const retry = Number(response.headers.get("Retry-After"));
  return new AuthApiError(response.status, code, message, Number.isFinite(retry) && retry > 0 ? retry : undefined);
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response = await send(method, path, body);
  let data = await parse(response);
  if (response.status === 403 && method !== "GET" && toError(response, data).code === "csrf_failed") {
    // The token is bound to the session: refresh it once (e.g. after another tab signed in).
    resetCsrf();
    response = await send(method, path, body);
    data = await parse(response);
  }
  if (!response.ok) throw toError(response, data);
  return data as T;
}

export const authApi = {
  me: () => call<Account>("GET", "/api/v2/auth/me"),
  register: (input: RegisterInput) => call<{ status: string; message: string }>("POST", "/api/v2/auth/register", input),
  verifyEmail: (token: string) => call<{ status: string }>("POST", "/api/v2/auth/verify-email", { token }),
  resendVerification: (email: string) => call("POST", "/api/v2/auth/verify-email/resend", { email }),
  async login(email: string, password: string): Promise<Account> {
    const data = await call<{ account: Account; csrf_token: string }>("POST", "/api/v2/auth/login", { email, password });
    csrfToken = data.csrf_token;
    return data.account;
  },
  async logout() {
    try {
      await call("POST", "/api/v2/auth/logout");
    } finally {
      resetCsrf();
    }
  },
  forgotPassword: (email: string) => call("POST", "/api/v2/auth/password/forgot", { email }),
  resetPassword: (token: string, password: string) => call("POST", "/api/v2/auth/password/reset", { token, password }),
  updateLocale: (locale: Locale) => call<Account>("PATCH", "/api/v2/me", { locale }),
  async deleteAccount(password: string) {
    await call("DELETE", "/api/v2/me", { password });
    resetCsrf();
  },
  consents: () => call<Consents>("GET", "/api/v2/me/consents"),
  setConsent: (purpose: ConsentPurpose, granted: boolean) => call<Consents>("PUT", `/api/v2/me/consents/${purpose}`, { granted }),
  organizations: () => call<Organization[]>("GET", "/api/v2/orgs"),
  createOrganization: (name: string) => call<Organization>("POST", "/api/v2/orgs", { name }),
  candidateOverview: () => call<CandidateOverview>("GET", "/api/v2/candidate/overview"),
};
