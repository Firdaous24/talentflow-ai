import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { resetCsrf } from "../auth/api";
import { i18n } from "../i18n";

type Handler = (body: Record<string, unknown> | undefined) => [number, unknown?, Record<string, string>?];
interface Call { method: string; path: string; body?: Record<string, unknown>; csrf?: string }

const candidate = { id: "u-1", email: "ada@example.com", role: "candidate", locale: "fr", email_verified: true, created_at: "2026-11-27T10:00:00Z", organizations: [] };
const recruiter = { ...candidate, id: "u-2", email: "rec@example.com", role: "recruiter" };
const consents = {
  current_policy_version: "2026-11-27",
  consents: [
    { purpose: "processing", granted: true, policy_version: "2026-11-27", granted_at: "2026-11-27T10:00:00Z" },
    { purpose: "recruiter_visibility", granted: false, policy_version: null, granted_at: null },
    { purpose: "model_assistance", granted: false, policy_version: null, granted_at: null },
    { purpose: "marketing", granted: false, policy_version: null, granted_at: null },
  ],
  history: [],
};
const notSignedIn: Handler = () => [401, { detail: { code: "not_authenticated", message: "Sign in." } }];

function server(handlers: Record<string, Handler>): Call[] {
  const calls: Call[] = [];
  const all: Record<string, Handler> = {
    "GET /api/v2/auth/csrf": () => [200, { csrf_token: "csrf-anonymous" }],
    "GET /api/v1/health": () => [200, { status: "ok" }],
    "GET /api/v1/candidates/extraction-config": () => [200, { available: false, provider: null, destination: null, model: null, connectivity: "not_checked" }],
    ...handlers,
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const path = new URL(url, "http://localhost").pathname;
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, path, body, csrf: (init.headers as Record<string, string> | undefined)?.["X-CSRF-Token"] });
    const handler = all[`${method} ${path}`];
    const [status, data, headers] = handler ? handler(body) : [404, { detail: { code: "not_found", message: "Not found" } }];
    return new Response(status === 204 || data === undefined ? null : JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...headers } });
  }));
  return calls;
}

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}

beforeEach(async () => {
  resetCsrf();
  await i18n.changeLanguage("fr");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Public pages and accounts", () => {
  it("shows the public home in French with the permanent demo warning and no score", async () => {
    server({ "GET /api/v2/auth/me": notSignedIn });
    renderAt("/welcome");
    expect(await screen.findByRole("heading", { level: 1, name: "Des décisions de recrutement qui s'appuient sur des preuves." })).toBeInTheDocument();
    const banner = screen.getByRole("note");
    expect(banner).toHaveTextContent("Version de démonstration");
    expect(banner).toHaveTextContent("Service destiné aux utilisateurs situés au Maroc.");
    expect(screen.getByRole("link", { name: "Essayer la démo sans compte" })).toHaveAttribute("href", "/");
    expect(screen.getAllByRole("link", { name: "Créer un compte" })[0]).toHaveAttribute("href", "/register");
    expect(document.body.textContent).not.toMatch(/\d+\s?%|score\s*:/i);
  });

  it("lets a visitor choose a role, then validates the sign-up form before sending it with consents and CSRF", async () => {
    const user = userEvent.setup();
    const calls = server({ "GET /api/v2/auth/me": notSignedIn, "POST /api/v2/auth/register": () => [202, { status: "accepted", message: "sent" }] });
    renderAt("/register");
    expect(await screen.findByRole("heading", { name: "Quel espace voulez-vous ouvrir ?" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /^Je suis candidat·e/ }));
    expect(await screen.findByRole("heading", { name: "Inscription candidat·e" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));
    expect(screen.getByText("Cette case est nécessaire pour créer un compte.")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/api/v2/auth/register")).toBe(false);

    await user.type(screen.getByLabelText("Adresse e-mail"), "ada@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "a long fictional passphrase");
    expect(screen.getByText("Robuste")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /J'accepte les conditions d'utilisation/ }));
    expect(screen.getByRole("checkbox", { name: "Recevoir des nouvelles du produit (facultatif)" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Créer mon compte" }));

    expect(await screen.findByRole("heading", { name: "Vérifiez votre boîte de réception" })).toBeInTheDocument();
    const sent = calls.find((call) => call.path === "/api/v2/auth/register")!;
    expect(sent.body).toEqual({ email: "ada@example.com", password: "a long fictional passphrase", role: "candidate", locale: "fr", accept_terms: true, marketing: false });
    expect(sent.csrf).toBe("csrf-anonymous");
  });

  it("explains a failed sign-in in amber, never revealing which field was wrong", async () => {
    const user = userEvent.setup();
    server({ "GET /api/v2/auth/me": notSignedIn, "POST /api/v2/auth/login": () => [401, { detail: { code: "invalid_credentials", message: "x" } }] });
    renderAt("/login");
    await user.type(await screen.findByLabelText("Adresse e-mail"), "ada@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "wrong password");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Adresse e-mail ou mot de passe incorrect.");
    expect(alert).toHaveClass("warning");
    expect(alert).not.toHaveClass("error");
  });

  it("offers to resend the confirmation e-mail to an unverified account", async () => {
    const user = userEvent.setup();
    const calls = server({ "GET /api/v2/auth/me": notSignedIn, "POST /api/v2/auth/login": () => [403, { detail: { code: "email_not_verified", message: "x" } }], "POST /api/v2/auth/verify-email/resend": () => [202, { status: "accepted", message: "x" }] });
    renderAt("/login");
    await user.type(await screen.findByLabelText("Adresse e-mail"), "ada@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "a long fictional passphrase");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    await user.click(await screen.findByRole("button", { name: "Renvoyer l'e-mail de confirmation" }));
    expect(await screen.findByText("Si un compte non confirmé existe, un nouvel e-mail a été envoyé.")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/api/v2/auth/verify-email/resend")?.body).toEqual({ email: "ada@example.com" });
  });

  it("signs in to the candidate space, then signs out with the session-bound CSRF token", async () => {
    const user = userEvent.setup();
    const calls = server({
      "GET /api/v2/auth/me": notSignedIn,
      "POST /api/v2/auth/login": () => [200, { account: candidate, csrf_token: "csrf-session" }],
      "GET /api/v2/me/consents": () => [200, consents],
      "GET /api/v2/candidate/overview": () => [200, { cv_versions: 0, recruiter_visibility: false, next_step: "upload_cv" }],
      "POST /api/v2/auth/logout": () => [204],
    });
    renderAt("/login");
    await user.type(await screen.findByLabelText("Adresse e-mail"), "ada@example.com");
    await user.type(screen.getByLabelText("Mot de passe"), "a long fictional passphrase");
    await user.click(screen.getByRole("button", { name: "Se connecter" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Bonjour" })).toBeInTheDocument();
    expect(screen.getByText("Espace candidat")).toBeInTheDocument();
    expect(screen.getByText("Connecté·e en tant que ada@example.com")).toBeInTheDocument();
    expect(await screen.findByRole("switch", { name: "Non visible" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Se déconnecter" }));
    expect(await screen.findByText("Vous êtes déconnecté·e.")).toBeInTheDocument();
    expect(calls.find((call) => call.path === "/api/v2/auth/logout")?.csrf).toBe("csrf-session");
  });

  it("lets a recruiter create an organization", async () => {
    const user = userEvent.setup();
    const calls = server({
      "GET /api/v2/auth/me": () => [200, recruiter],
      "GET /api/v2/me/consents": () => [200, consents],
      "GET /api/v2/orgs": () => [200, []],
      "POST /api/v2/orgs": (body) => [201, { id: "o-1", name: body?.name, org_role: "owner", created_at: "2026-11-27T10:00:00Z", member_count: 1 }],
    });
    renderAt("/account");
    expect(await screen.findByText("Espace recruteur")).toBeInTheDocument();
    await user.type(await screen.findByLabelText("Nom de l'organisation"), "Fictional Hiring Co");
    await user.click(screen.getByRole("button", { name: "Créer l'organisation" }));
    const list = await screen.findByRole("list", { name: "Organisation" });
    expect(within(list).getByText("Fictional Hiring Co")).toBeInTheDocument();
    expect(within(list).getByText("1 membre")).toBeInTheDocument();
    expect(calls.find((call) => call.method === "POST" && call.path === "/api/v2/orgs")?.body).toEqual({ name: "Fictional Hiring Co" });
  });

  it("deletes the account only with the password and lands on the public home", async () => {
    const user = userEvent.setup();
    let attempts = 0;
    const calls = server({
      "GET /api/v2/auth/me": () => [200, candidate],
      "GET /api/v2/me/consents": () => [200, consents],
      "GET /api/v2/candidate/overview": () => [200, { cv_versions: 0, recruiter_visibility: false, next_step: "upload_cv" }],
      "DELETE /api/v2/me": () => (++attempts === 1 ? [403, { detail: { code: "reauthentication_failed", message: "x" } }] : [204]),
    });
    renderAt("/account");
    const zone = (await screen.findByRole("heading", { name: "Supprimer mon compte" })).closest("section")!;
    const confirm = within(zone).getByRole("button", { name: "Supprimer définitivement mon compte" });
    expect(confirm).toBeDisabled();
    await user.type(within(zone).getByLabelText("Mot de passe actuel"), "not my password");
    await user.click(confirm);
    expect(await within(zone).findByText("Mot de passe incorrect. Le compte n'a pas été supprimé.")).toBeInTheDocument();
    await user.clear(within(zone).getByLabelText("Mot de passe actuel"));
    await user.type(within(zone).getByLabelText("Mot de passe actuel"), "a long fictional passphrase");
    await user.click(confirm);
    expect(await screen.findByText("Votre compte et ses données personnelles ont été supprimés.")).toBeInTheDocument();
    expect(calls.filter((call) => call.method === "DELETE").map((call) => call.body)).toEqual([{ password: "not my password" }, { password: "a long fictional passphrase" }]);
  });

  it("sends visitors from the account space to sign-in", async () => {
    server({ "GET /api/v2/auth/me": notSignedIn });
    renderAt("/account");
    expect(await screen.findByRole("heading", { name: "Se connecter" })).toBeInTheDocument();
  });

  it("switches to English and stores the language only on an explicit click", async () => {
    const user = userEvent.setup();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    server({ "GET /api/v2/auth/me": notSignedIn });
    renderAt("/login");
    expect(await screen.findByRole("heading", { name: "Se connecter" })).toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "English" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    expect(storage).toHaveBeenCalledWith("talentflow-language", "en");
    expect(document.querySelector(".public")).toHaveAttribute("lang", "en");
    localStorage.removeItem("talentflow-language");
  });

  it("keeps the demo workbench free of any account call", async () => {
    const calls = server({});
    renderAt("/");
    expect(await screen.findByRole("heading", { name: "A clearer view of talent." })).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.path === "/api/v1/health")).toBe(true));
    expect(calls.filter((call) => call.path.startsWith("/api/v2/"))).toEqual([]);
    expect(screen.getByRole("link", { name: "My account" })).toHaveAttribute("href", "/account");
  });
});
