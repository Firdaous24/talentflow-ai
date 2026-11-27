import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { resetCsrf } from "../auth/api";
import { i18n } from "../i18n";

type Handler = (body: Record<string, unknown> | undefined) => [number, unknown?];
interface Call { method: string; path: string; body?: Record<string, unknown>; form?: FormData }

const recruiter = { id: "u-1", email: "rec@example.com", role: "recruiter", locale: "fr", email_verified: true, created_at: "2026-11-27T10:00:00Z", organizations: [{ id: "o-1", name: "Hiring Org", org_role: "owner" }] };
const candidate = { ...recruiter, id: "u-2", email: "cand@example.com", role: "candidate", organizations: [] };
const consents = { current_policy_version: "2026-11-27", consents: [], history: [] };
const SOURCE = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\n";
const requirements = [
  { id: "req-001", text: "Python", category: "technical_skill", classification: "required" },
  { id: "req-002", text: "Docker", category: "technical_skill", classification: "required" },
];
const job = {
  id: "j-1", title: "Backend Developer", created_at: "2026-11-27T10:00:00Z", requirement_count: 2, criteria_confirmed_at: "2026-11-27T10:05:00Z", status: "open", visibility: "public",
  source_text: SOURCE, requirements, requirements_reviewed: true,
  analysis: { job: { title: "Backend Developer", company: null, location: null, employment_type: null, work_mode: null, metadata_evidence: {}, text: SOURCE, responsibilities: [] }, requirements: requirements.map((item) => ({ ...item, origin: "qualification", technical_skills: [], evidence: [{ quote: item.text, start: SOURCE.indexOf(item.text), end: SOURCE.indexOf(item.text) + item.text.length }], warnings: [] })), warnings: [], method: "deterministic-v1" },
};
const counts = (required: number, preferred: number, review: number) => ({ required_documented: required, required_total: 3, preferred_documented: preferred, preferred_total: 2, needs_review: review });
const ranking = {
  job_id: "j-1", notice: "documentary_coverage_not_competence_decision_is_human", sort_key: "required_documented_desc,preferred_documented_desc,needs_review_asc", pending: 0, to_review: 1,
  groups: [
    { required_documented: 2, preferred_documented: 1, needs_review: 1, tie_order: "arrival_not_meaningful", entries: [{ match_id: "m-1", alias: 1, source: "import", counts: counts(2, 1, 1), identity_revealed: false }, { match_id: "m-3", alias: 3, source: "application", counts: counts(2, 1, 1), identity_revealed: false }] },
    { required_documented: 1, preferred_documented: 0, needs_review: 1, tie_order: "arrival_not_meaningful", entries: [{ match_id: "m-2", alias: 2, source: "import", counts: counts(1, 0, 1), identity_revealed: false }] },
  ],
};
const comparison = (id: string, text: string, status: string, classification: string) => ({
  requirement_id: id, requirement_text: text, original_requirement_text: text, category: "technical_skill", classification, origin: "qualification", status,
  job_evidence: [{ quote: text, start: SOURCE.indexOf(text), end: SOURCE.indexOf(text) + text.length }], explanation: "fixed", review_notes: [],
  candidate_evidence: status === "documented" ? [{ field: "technical_skills[0].name", quote: text, unverified: true, excerpt: { quote: text, start: 0, end: text.length } }] : [],
});
const match = {
  match_id: "m-1", job_id: "j-1", alias: 1, source: "import", counts: counts(2, 1, 1), job_source_text: SOURCE, imported_profile_id: "p-1", identity_revealed_at: null, reveal_reason: null, identity: null, technical_evidence: [],
  comparisons: [comparison("req-001", "Python", "documented", "required"), comparison("req-002", "Docker", "documented", "required"), comparison("req-004", "Kubernetes", "not_documented", "preferred")],
};

function server(account: typeof recruiter, handlers: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  const all: Record<string, Handler> = {
    "GET /api/v2/auth/csrf": () => [200, { csrf_token: "csrf-token" }],
    "GET /api/v2/auth/me": () => [200, account],
    "GET /api/v2/me/consents": () => [200, consents],
    ...handlers,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url, "http://localhost").pathname;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, form: init.body instanceof FormData ? init.body : undefined });
    const handler = all[`${method} ${path}`];
    const [status, data] = handler ? handler(body) : [404, { detail: { code: "not_found", message: "Not found" } }];
    return new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  }));
  return calls;
}

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

beforeEach(async () => {
  resetCsrf();
  await i18n.changeLanguage("fr");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const jobHandlers = (extra: Record<string, Handler> = {}): Record<string, Handler> => ({
  "GET /api/v2/orgs/o-1/jobs/j-1": () => [200, job],
  "GET /api/v2/orgs/o-1/jobs/j-1/imports": () => [200, []],
  "GET /api/v2/orgs/o-1/jobs/j-1/review-queue": () => [200, []],
  "GET /api/v2/orgs/o-1/jobs/j-1/ranking": () => [200, ranking],
  ...extra,
});

describe("Recruiter space", () => {
  it("shows an anonymous ranking: grouped ties, counts, the permanent notice below, and no score", async () => {
    server(recruiter, jobHandlers());
    renderAt("/account/jobs/j-1");
    const section = await screen.findByRole("region", { name: "Classement anonyme" });
    const list = await within(section).findByRole("list", { name: "Profils classés" });
    const rows = within(list).getAllByRole("listitem").filter((item) => item.classList.contains("ranking-row"));
    expect(rows.map((row) => row.querySelector(".ranking-alias")?.textContent)).toEqual(["Candidat·e A-1", "Candidat·e A-3", "Candidat·e A-2"]);
    expect(within(section).getByText("Même couverture · ordre d'arrivée, non significatif")).toBeInTheDocument();
    expect(within(section).getByRole("group", { name: "Candidat·e A-1" })).toHaveTextContent("2/3 requis · 1/2 souhaités · 1 à interpréter");
    const notice = within(section).getByRole("note");
    expect(notice).toHaveTextContent("Classement par couverture documentaire. Il n'évalue pas la compétence réelle. La décision appartient au recruteur.");
    expect(notice).toHaveTextContent("Aucune action automatique : ni rejet, ni acceptation, ni e-mail aux candidats.");
    expect(list.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(section).getByText("1 profil à revoir avant classement")).toBeInTheDocument();
    // The notice says "no score": no figure is ever a score, a percentage or a rank position.
    expect(section.textContent).not.toMatch(/\d+\s?%|score\s*:|n°\s*\d|#\d/i);
    expect(section.querySelectorAll("progress, meter").length).toBe(0);
  });

  it("opens the evidence of a count and reveals identity only with a reason and a note", async () => {
    const user = userEvent.setup();
    const calls = server(recruiter, jobHandlers({
      "GET /api/v2/orgs/o-1/matches/m-1": () => [200, match],
      "POST /api/v2/orgs/o-1/matches/m-1/reveal": (body) => [200, { ...match, identity_revealed_at: "2026-11-27T12:00:00Z", reveal_reason: body?.reason, identity: { full_name: "Imported Person 1", email: "imported1@example.com", phone: null, linkedin_url: null, github_url: null } }],
    }));
    renderAt("/account/jobs/j-1");
    const section = await screen.findByRole("region", { name: "Classement anonyme" });
    await user.click(within(await within(section).findByRole("group", { name: "Candidat·e A-1" })).getByRole("button", { name: "Ouvrir les preuves : 2/3 requis" }));
    const panel = await screen.findByRole("region", { name: "Preuves · Candidat·e A-1" });
    expect(within(panel).getAllByRole("article").map((item) => item.getAttribute("aria-label"))).toEqual(["Python", "Docker"]);
    expect(within(panel).getAllByText("Dans le CV (qualifications seules)").length).toBe(2);
    expect(panel.textContent).not.toContain("Imported Person");

    const submit = within(panel).getByRole("button", { name: "Lever l'anonymat" });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(panel).getByLabelText("Motif"), "reference_check");
    await user.type(within(panel).getByLabelText("Précision (obligatoire)"), "Appel prévu");
    await user.click(submit);
    expect(await within(panel).findByText("Imported Person 1")).toBeInTheDocument();
    expect(within(panel).getByText(/motif : Vérification des références/)).toBeInTheDocument();
    expect(calls.find((call) => call.path.endsWith("/reveal"))?.body).toEqual({ reason: "reference_check", note: "Appel prévu" });
  });

  it("imports only after the attestation, one file per request", async () => {
    const user = userEvent.setup();
    let uploaded = 0;
    const calls = server(recruiter, jobHandlers({
      "POST /api/v2/orgs/o-1/jobs/j-1/imports": (body) => [201, { id: "b-1", job_id: "j-1", file_count: body?.file_count, uploaded: 0, attested_at: "2026-11-27T10:00:00Z", attestation_version: "2026-11-27", created_at: "2026-11-27T10:00:00Z", expires_at: "2027-02-25T10:00:00Z", progress: { queued: 0, parsing: 0, parsed: 0, failed: 0, duplicate: 0 }, failures: [] }],
      "POST /api/v2/orgs/o-1/imports/b-1/files": () => [202, { position: ++uploaded, status: "queued" }],
    }));
    renderAt("/account/jobs/j-1");
    const card = await screen.findByRole("region", { name: "Importer des CV" });
    const files = [new File(["%PDF-1"], "a.pdf", { type: "application/pdf" }), new File(["%PDF-1"], "b.pdf", { type: "application/pdf" })];
    await user.upload(within(card).getByLabelText("Fichiers PDF"), files);
    const submit = within(card).getByRole("button", { name: "Importer 2 fichiers" });
    expect(submit).toBeDisabled();
    expect(card).toHaveTextContent("supprimés automatiquement 90 jours après l'import");
    await user.click(within(card).getByRole("checkbox", { name: "Les candidats ont été informés du traitement de leur CV." }));
    await user.click(submit);
    await waitFor(() => expect(uploaded).toBe(2));
    expect(calls.find((call) => call.path.endsWith("/imports") && call.method === "POST")?.body).toEqual({ attestation: true, file_count: 2 });
    expect(calls.filter((call) => call.path.endsWith("/files")).map((call) => call.form?.get("file"))).toHaveLength(2);
  });

  it("reviews an imported profile on qualifications only, after an acknowledgement", async () => {
    const user = userEvent.setup();
    let queue = [{ profile_id: "p-9", batch_id: "b-1", position: 4, page_count: 1, expires_at: "2027-02-25T10:00:00Z", warnings: ["experience could not be reliably identified."], qualifications: { education: [{ degree: "BSc", field_of_study: "Computer Science" }], experience: [], technical_skills: [{ name: "Python", category: "programming_language" }], projects: [], certifications: [], languages: [{ name: "English", proficiency: "Fluent" }] } }];
    const calls = server(recruiter, jobHandlers({
      "GET /api/v2/orgs/o-1/jobs/j-1/review-queue": () => [200, queue],
      "POST /api/v2/orgs/o-1/profiles/p-9/confirm": () => {
        queue = [];
        return [201, { match_id: "m-9", alias: 9, source: "import", counts: counts(0, 0, 0), identity_revealed: false }];
      },
    }));
    renderAt("/account/jobs/j-1");
    const item = await screen.findByRole("listitem", { name: "Profil importé n°4" });
    expect(item).toHaveTextContent("Python");
    expect(item).toHaveTextContent("BSc · Computer Science");
    const confirm = within(item).getByRole("button", { name: "Confirmer pour le classement" });
    expect(confirm).toBeDisabled();
    await user.click(within(item).getByRole("checkbox", { name: "J'ai relu ce profil et ses avertissements." }));
    await user.click(confirm);
    expect(await screen.findByText("Aucun profil à revoir.")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/api/v2/orgs/o-1/profiles/p-9/confirm" && call.body?.warnings_acknowledged === true)).toBe(true);
  });
});

describe("Applications and claim links", () => {
  it("explains that applying needs the visibility consent", async () => {
    const user = userEvent.setup();
    server(candidate, {
      "GET /api/v2/candidate/overview": () => [200, { cv_versions: 1, current_version: null, targets: 0, confirmed_targets: 0, recruiter_visibility: false, original_storage_available: false, next_step: "add_target" }],
      "GET /api/v2/me/targets": () => [200, []],
      "GET /api/v2/me/public-jobs": () => [200, [{ id: "j-1", title: "Backend Developer", organization: "Hiring Org", requirement_count: 5, applied: false }]],
      "GET /api/v2/me/applications": () => [200, []],
      "POST /api/v2/me/applications": () => [409, { detail: { code: "consent_required", message: "consent" } }],
    });
    renderAt("/account/offers");
    const offers = await screen.findByRole("region", { name: "Offres publiques" });
    await within(offers).findByText("Hiring Org · 5 critères");
    await user.click(within(offers).getByRole("button", { name: "Postuler · Backend Developer · Hiring Org" }));
    expect(await within(offers).findByText("Activez d'abord « Visibilité auprès des recruteurs » dans l'aperçu.")).toBeInTheDocument();
  });

  it("lets the link holder delete the imported profile without an account", async () => {
    const user = userEvent.setup();
    const calls = server(recruiter, {
      "GET /api/v2/auth/me": () => [401, { detail: { code: "not_authenticated", message: "Sign in." } }],
      "POST /api/v2/claims/inspect": () => [200, { organization: "Hiring Org", job_title: "Backend Developer", expires_at: "2027-02-25T10:00:00Z" }],
      "POST /api/v2/claims/delete": () => [204],
    });
    renderAt("/claim?token=fictional-claim-token-0123456789");
    expect(await screen.findByText(/Hiring Org a importé votre CV pour l'offre « Backend Developer »/)).toBeInTheDocument();
    expect(screen.getByText(/connectez-vous avec un compte candidat/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Supprimer mon profil maintenant" }));
    expect(await screen.findByText("Votre profil importé et votre CV ont été supprimés.")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/api/v2/claims/delete")?.body).toEqual({ token: "fictional-claim-token-0123456789" });
    expect(window.localStorage.length).toBe(0);
  });
});
