import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { resetCsrf } from "../auth/api";
import { i18n } from "../i18n";

type Handler = (body: Record<string, unknown> | undefined) => [number, unknown?];
interface Call { method: string; path: string; body?: Record<string, unknown>; form?: FormData }

const account = { id: "u-1", email: "juno@example.com", role: "candidate", locale: "fr", email_verified: true, created_at: "2026-11-27T10:00:00Z", organizations: [] };
const consents = { current_policy_version: "2026-11-27", consents: ["processing", "recruiter_visibility", "model_assistance", "marketing"].map((purpose) => ({ purpose, granted: purpose === "processing", policy_version: purpose === "processing" ? "2026-11-27" : null, granted_at: purpose === "processing" ? "2026-11-27T10:00:00Z" : null })), history: [] };
const profile = {
  full_name: "Juno Fictional", email: "juno@example.com", phone: null, linkedin_url: null, github_url: null,
  education: [], experience: [], projects: [], certifications: [],
  technical_skills: [{ name: "Python", category: "programming_language" }, { name: "FastAPI", category: "framework" }],
  languages: [{ name: "English", proficiency: "Fluent" }],
};
const summary = (number: number, status: string, current: boolean) => ({ id: `v-${number}`, number, created_at: "2026-11-27T10:00:00Z", page_count: 1, status, reviewed_at: null, confirmed_at: status === "confirmed" ? "2026-11-27T11:00:00Z" : null, has_original: false, current });
const detail = (number: number, status: string, current: boolean) => ({ ...summary(number, status, current), parsed: { candidate: profile, parsing_metadata: { status: "partial", page_count: 1, warnings: ["experience could not be reliably identified."], engine: "deterministic-v2", evidence: [] } }, reviewed_profile: null });
const overview = (step: string, extra: Record<string, unknown> = {}) => ({ cv_versions: 0, current_version: null, targets: 0, confirmed_targets: 0, recruiter_visibility: false, original_storage_available: false, next_step: step, ...extra });
const SOURCE = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\n";
const span = (quote: string) => {
  const start = Array.from(SOURCE).join("").indexOf(quote);
  return { quote, start, end: start + Array.from(quote).length };
};
const requirement = (id: string, text: string, category: string, classification: string) => ({ id, text, category, classification });
const requirements = [
  requirement("req-001", "Python", "technical_skill", "required"),
  requirement("req-002", "Docker", "technical_skill", "required"),
  requirement("req-003", "Fluent English", "language", "required"),
  requirement("req-004", "Kubernetes", "technical_skill", "preferred"),
  requirement("req-005", "FastAPI", "technical_skill", "preferred"),
];
const target = (confirmed: boolean) => ({
  id: "t-1", title: "Backend Developer", created_at: "2026-11-27T10:00:00Z", requirement_count: 5, criteria_confirmed_at: confirmed ? "2026-11-27T12:00:00Z" : null,
  source_text: SOURCE, requirements, requirements_reviewed: confirmed,
  analysis: { job: { title: "Backend Developer", company: null, location: null, employment_type: null, work_mode: null, metadata_evidence: {}, text: SOURCE, responsibilities: [] }, requirements: requirements.map((item) => ({ ...item, origin: "qualification", technical_skills: [], evidence: [span(item.text)], warnings: [] })), warnings: [], method: "deterministic-v1" },
});
const statuses: Record<string, string> = { "req-001": "documented", "req-002": "not_documented", "req-003": "needs_review", "req-004": "not_documented", "req-005": "documented" };
const coverage = {
  target_id: "t-1", cv_version: { id: "v-1", number: 1 }, warnings: [], technical_evidence: [], notice: "documentary_coverage_not_competence",
  counts: { required_documented: 1, required_total: 3, preferred_documented: 1, preferred_total: 2, unspecified_documented: 0, unspecified_total: 0, needs_review: 1 },
  comparisons: requirements.map((item) => ({
    requirement_id: item.id, requirement_text: item.text, original_requirement_text: item.text, category: item.category, classification: item.classification, origin: "qualification",
    status: statuses[item.id], job_evidence: [span(item.text)], explanation: "fixed", review_notes: [],
    candidate_evidence: statuses[item.id] === "documented" ? [{ field: "technical_skills[0].name", quote: item.text, unverified: true, excerpt: { quote: item.text, start: 0, end: item.text.length } }] : [],
  })),
};
const gaps = { target_id: "t-1", cv_version: { id: "v-1", number: 1 }, gaps: [
  { requirement_id: "req-002", requirement_text: "Docker", category: "technical_skill", classification: "required", status: "not_documented", kind: "add_if_true", section: "technical_skills", reason: null },
  { requirement_id: "req-003", requirement_text: "Fluent English", category: "language", classification: "required", status: "needs_review", kind: "interpretation", section: "languages", reason: "language_level" },
] };

function server(handlers: Record<string, Handler>): Call[] {
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

describe("Candidate space", () => {
  it("shows the path in order, the next step and an explicit export", async () => {
    const user = userEvent.setup();
    const calls = server({
      "GET /api/v2/candidate/overview": () => [200, overview("review_cv", { cv_versions: 1, current_version: summary(1, "to_review", true) })],
      "GET /api/v2/me/export": () => [200, { format: "talentflow-export-v1" }],
    });
    const createObjectURL = vi.fn(() => "blob:export");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    renderAt("/account");
    const path = await screen.findByRole("region", { name: "Votre parcours" });
    const steps = within(path).getAllByRole("listitem");
    expect(steps.map((step) => step.textContent)).toEqual(["Déposer mon CVFait", "2Revoir et confirmer mon CVÀ faire", "3Ajouter une offreÀ faire", "4Revoir les critères d'une offreÀ faire", "5Lire ma couverture et mes écartsÀ faire"]);
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(within(path).getByRole("link", { name: "Prochaine étape : Revoir et confirmer mon CV" })).toHaveAttribute("href", "/account/cv");
    expect(within(path).getByText(/Version 1 · À revoir/)).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Espace candidat" });
    expect(within(nav).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/account", "/account/cv", "/account/offers"]);

    await user.click(screen.getByRole("button", { name: "Exporter mes données" }));
    expect(await screen.findByText("Export téléchargé.")).toBeInTheDocument();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(calls.some((call) => call.method === "GET" && call.path === "/api/v2/me/export")).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it("uploads a version, saves an edited review, then confirms only after the acknowledgement", async () => {
    const user = userEvent.setup();
    let reviewed: Record<string, unknown> | undefined;
    const calls = server({
      "GET /api/v2/candidate/overview": () => [200, overview("upload_cv")],
      "GET /api/v2/me/cv/versions": () => [200, reviewed ? [summary(1, "reviewed", true)] : []],
      "POST /api/v2/me/cv": () => [201, detail(1, "to_review", true)],
      "GET /api/v2/me/cv/versions/v-1": () => [200, detail(1, "to_review", true)],
      "PUT /api/v2/me/cv/versions/v-1/review": (body) => {
        reviewed = body?.profile as Record<string, unknown>;
        return [200, { ...detail(1, "reviewed", true), reviewed_profile: reviewed, reviewed_at: "2026-11-27T10:30:00Z" }];
      },
      "POST /api/v2/me/cv/versions/v-1/confirm": () => [200, { ...detail(1, "confirmed", true), reviewed_profile: reviewed }],
    });
    renderAt("/account/cv");
    expect(await screen.findByText("Aucune version pour l'instant.")).toBeInTheDocument();
    expect(screen.getByText("Ce serveur ne conserve que le texte chiffré : le PDF original n'est pas gardé.")).toBeInTheDocument();
    const pdf = new File(["%PDF-1.7 fictional"], "fictional.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Fichier PDF"), pdf);
    await user.click(screen.getByRole("button", { name: "Déposer cette version" }));
    expect(await screen.findByText("Version 1 créée. Revoyez-la, puis confirmez-la.")).toBeInTheDocument();
    const upload = calls.find((call) => call.method === "POST" && call.path === "/api/v2/me/cv");
    expect(upload?.form?.get("keep_original")).toBe("false");
    expect(upload?.form?.get("file")).toBeInstanceOf(File);

    const review = await screen.findByRole("region", { name: "Revoir la version 1" });
    expect(within(review).getByText("experience could not be reliably identified.")).toBeInTheDocument();
    const confirm = within(review).getByRole("button", { name: "Confirmer ce profil" });
    expect(confirm).toBeDisabled();
    await user.click(within(review).getByRole("button", { name: "Ajouter : Compétences techniques" }));
    const added = within(review).getByRole("group", { name: "Compétences techniques · élément 3" });
    await user.type(within(added).getByLabelText("Nom"), "  Docker ");
    await user.selectOptions(within(added).getByLabelText("Catégorie"), "cloud_devops");
    expect(within(review).getByText("Modifications non enregistrées.")).toBeInTheDocument();
    expect(within(review).getByRole("checkbox", { name: "J'ai relu les avertissements et vérifié mon profil." })).toBeDisabled();
    await user.click(within(review).getByRole("button", { name: "Enregistrer la revue" }));
    expect(await within(review).findByText("Revue enregistrée. Confirmez-la pour l'utiliser dans vos couvertures.")).toBeInTheDocument();
    expect((reviewed?.technical_skills as { name: string }[]).map((skill) => skill.name)).toEqual(["Python", "FastAPI", "Docker"]);

    await user.click(within(review).getByRole("checkbox", { name: "J'ai relu les avertissements et vérifié mon profil." }));
    await user.click(within(review).getByRole("button", { name: "Confirmer ce profil" }));
    expect(await within(review).findByText("Profil confirmé. Il sert désormais à la couverture de vos offres.")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/api/v2/me/cv/versions/v-1/confirm")?.body).toEqual({ warnings_acknowledged: true });
  });

  it("keeps an earlier version read-only and shows what changed between versions", async () => {
    const user = userEvent.setup();
    server({
      "GET /api/v2/candidate/overview": () => [200, overview("review_cv")],
      "GET /api/v2/me/cv/versions": () => [200, [summary(2, "to_review", true), summary(1, "confirmed", false)]],
      "GET /api/v2/me/cv/versions/v-2": () => [200, detail(2, "to_review", true)],
      "GET /api/v2/me/cv/versions/v-1": () => [200, detail(1, "confirmed", false)],
      "GET /api/v2/me/cv/diff": () => [200, { from_version: { id: "v-1", number: 1 }, to_version: { id: "v-2", number: 2 }, fields: [{ field: "email", change: "removed" }], sections: [{ section: "technical_skills", added: ["Docker"], removed: ["Git"], unchanged: 2 }] }],
    });
    renderAt("/account/cv");
    expect(await screen.findByRole("region", { name: "Revoir la version 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ouvrir la version 1" }));
    const old = await screen.findByRole("region", { name: "Revoir la version 1" });
    expect(within(old).getByText(/Version antérieure : consultable, mais plus modifiable/)).toBeInTheDocument();
    expect(within(old).queryByRole("button", { name: "Enregistrer la revue" })).not.toBeInTheDocument();
    expect(within(old).getAllByLabelText("Nom")[0]).toHaveAttribute("readonly");

    await user.click(screen.getByRole("button", { name: "Comparer" }));
    const diff = screen.getByRole("region", { name: "Comparer deux versions" });
    const skills = await within(diff).findByRole("group", { name: "Compétences techniques" });
    expect(skills).toHaveTextContent("Ajouté Docker");
    expect(skills).toHaveTextContent("Retiré Git");
    expect(skills).toHaveTextContent("2 éléments inchangés");
    expect(within(diff).getByText("E-mail · retiré")).toBeInTheDocument();
  });

  it("reads a coverage report: exact counts, neutral absences, evidence side by side and honest gaps", async () => {
    const user = userEvent.setup();
    server({
      "GET /api/v2/candidate/overview": () => [200, overview("view_coverage")],
      "GET /api/v2/me/targets/t-1": () => [200, target(true)],
      "GET /api/v2/me/targets/t-1/coverage": () => [200, coverage],
      "GET /api/v2/me/targets/t-1/gaps": () => [200, gaps],
    });
    renderAt("/account/offers/t-1");
    const report = await screen.findByRole("region", { name: "Couverture documentaire" });
    expect(within(report).getByRole("group", { name: "Décompte" })).toHaveTextContent("1/3 requis · 1/2 souhaités · 1 à interpréter");
    expect(within(report).getByRole("note")).toHaveTextContent("Ce n'est pas une évaluation de votre compétence");
    const docker = within(report).getByRole("article", { name: "Docker" });
    const absent = within(docker).getByText("Non documenté");
    expect(absent.closest(".status-pill")).toHaveClass("not_documented");
    expect(docker.className).not.toMatch(/danger|error/);
    expect(within(docker).getByText("Aucun passage de votre CV ne documente ce critère.")).toBeInTheDocument();
    const python = within(report).getByRole("article", { name: "Python" });
    const quotes = python.querySelectorAll("blockquote");
    expect(Array.from(quotes).map((quote) => quote.firstChild?.textContent)).toEqual(["Python", "Python"]);

    await user.click(within(report).getByRole("button", { name: "Afficher : 1/3 requis" }));
    expect(within(report).getAllByRole("article").map((item) => item.getAttribute("aria-label"))).toEqual(["Python", "Docker", "Fluent English"]);
    await user.click(within(report).getByRole("button", { name: "Afficher : 1 à interpréter" }));
    expect(within(report).getAllByRole("article").map((item) => item.getAttribute("aria-label"))).toEqual(["Fluent English"]);

    const gapList = screen.getByRole("region", { name: "Écarts" });
    expect(gapList).toHaveTextContent("Ce critère n'apparaît pas dans votre CV. Si c'est vrai, ajoutez-le avec un exemple vérifiable.");
    expect(gapList).toHaveTextContent("Une personne doit interpréter le niveau de langue demandé.");
    expect(within(gapList).getByRole("link", { name: "Revoir « Compétences techniques » dans mon CV" })).toHaveAttribute("href", "/account/cv#cv-section-technical_skills");
    expect(document.body.textContent).not.toMatch(/\d+\s?%|score/i);
  });

  it("blocks the coverage until both reviews, and resets the confirmation when criteria change", async () => {
    const user = userEvent.setup();
    let current = target(true);
    const calls = server({
      "GET /api/v2/candidate/overview": () => [200, overview("review_cv")],
      "GET /api/v2/me/targets/t-1": () => [200, current],
      "GET /api/v2/me/targets/t-1/coverage": () => [409, { detail: { code: current.criteria_confirmed_at ? "cv_review_required" : "criteria_review_required", message: "blocked" } }],
      "GET /api/v2/me/targets/t-1/gaps": () => [409, { detail: { code: "cv_review_required", message: "blocked" } }],
      "PUT /api/v2/me/targets/t-1/requirements": (body) => {
        current = { ...target(false), requirements: body?.requirements as typeof requirements };
        return [200, current];
      },
    });
    renderAt("/account/offers/t-1");
    expect(await screen.findByText("Revoyez et confirmez d'abord la version actuelle de votre CV.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aller à mon CV" })).toHaveAttribute("href", "/account/cv");
    expect(screen.queryByRole("region", { name: "Couverture documentaire" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Classification du critère req-002"), "preferred");
    expect(screen.getByRole("button", { name: "Confirmer les critères" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Enregistrer les critères" }));
    expect(await screen.findByText("Critères enregistrés. Confirmez-les pour calculer la couverture.")).toBeInTheDocument();
    expect(screen.getByText(/Critères non confirmés\./)).toBeInTheDocument();
    expect(await screen.findByText("Confirmez d'abord les critères de cette offre.")).toBeInTheDocument();
    const saved = calls.find((call) => call.method === "PUT")?.body?.requirements as { id: string; classification: string }[];
    expect(saved.find((item) => item.id === "req-002")?.classification).toBe("preferred");
  });

  it("pastes a job post and opens it; the coverage reads in English after a language switch", async () => {
    const user = userEvent.setup();
    server({
      "GET /api/v2/candidate/overview": () => [200, overview("add_target")],
      "GET /api/v2/me/targets": () => [200, []],
      "POST /api/v2/me/targets": () => [201, target(true)],
      "GET /api/v2/me/targets/t-1": () => [200, target(true)],
      "GET /api/v2/me/targets/t-1/coverage": () => [200, coverage],
      "GET /api/v2/me/targets/t-1/gaps": () => [200, gaps],
    });
    renderAt("/account/offers");
    expect(await screen.findByText("Aucune offre pour l'instant.")).toBeInTheDocument();
    const analyze = screen.getByRole("button", { name: "Analyser l'offre" });
    expect(analyze).toBeDisabled();
    await user.type(screen.getByLabelText("Texte de l'offre (français ou anglais)"), "Backend Developer. Required qualifications: Python, Docker.");
    await user.click(analyze);
    expect(await screen.findByRole("region", { name: "Couverture documentaire" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("group", { name: "Count" })).toHaveTextContent("1/3 required · 1/2 preferred · 1 to interpret"));
    expect(screen.getByRole("region", { name: "Gaps" })).toHaveTextContent("If it is true, add it with a verifiable example.");
  });
});
