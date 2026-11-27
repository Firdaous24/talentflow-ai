import assert from "node:assert/strict";
import { chromium } from "playwright";

// Accounts against the real stack (nginx -> FastAPI -> PostgreSQL, e-mails in
// Mailpit): sign-up with a role choice, e-mail verification, sign-in, sign-out,
// session revocation and account deletion, in French then in English. The demo
// must keep working without an account. Fictional addresses only (example.com).
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const mailpit = process.env.MAILPIT_URL ?? "http://host.docker.internal:8025";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = "a long fictional passphrase for e2e";
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(20000);
const pageErrors = [];
const externalRequests = [];
const cspViolations = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
});
page.on("request", (request) => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) externalRequests.push(request.url());
});

async function mailFor(email, path) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages = [] } = await search.json();
    for (const summary of messages) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${summary.ID}`)).json();
      const match = message.Text?.match(new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`));
      if (match) return { token: match[1], subject: message.Subject };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No ${path} e-mail for ${email}`);
}

async function signUp({ email, roleLink, formHeading, submit, sent }) {
  await page.goto(`${base}/register`);
  await page.getByRole("link", { name: roleLink }).click();
  await page.getByRole("heading", { name: formHeading, exact: true }).waitFor();
  await page.getByLabel(/^(Adresse e-mail|E-mail address)$/).fill(email);
  await page.getByLabel(/^(Mot de passe|Password)$/).fill(password);
  await page.getByRole("checkbox", { name: /^(J'accepte|I accept)/ }).check();
  const response = page.waitForResponse((item) => new URL(item.url()).pathname === "/api/v2/auth/register");
  await page.getByRole("button", { name: submit, exact: true }).click();
  assert.equal((await response).status(), 202);
  await page.getByRole("heading", { name: sent, exact: true }).waitFor();
}

async function signIn(email, submit) {
  await page.goto(`${base}/login`);
  await page.getByLabel(/^(Adresse e-mail|E-mail address)$/).fill(email);
  await page.getByLabel(/^(Mot de passe|Password)$/).fill(password);
  await page.getByRole("button", { name: submit, exact: true }).click();
}

async function status(path) {
  return (await page.request.get(`${base}${path}`)).status();
}

try {
  // Public home: French by default, permanent demo warning, Morocco-only notice.
  await page.goto(`${base}/welcome`);
  await page.getByRole("heading", { level: 1, name: "Des décisions de recrutement qui s'appuient sur des preuves." }).waitFor();
  const banner = page.getByRole("note");
  assert.match(await banner.innerText(), /Version de démonstration/i);
  assert.match(await banner.innerText(), /Maroc/);
  assert.equal(await page.locator("html").getAttribute("data-theme") !== null, true);

  // French candidate: role choice, sign-up, verification, sign-in.
  const candidate = `candidate-${run}@example.com`;
  await page.getByRole("main").getByRole("link", { name: "Créer un compte", exact: true }).click();
  await page.getByRole("heading", { name: "Quel espace voulez-vous ouvrir ?" }).waitFor();
  await signUp({ email: candidate, roleLink: /^Je suis candidat·e/, formHeading: "Inscription candidat·e", submit: "Créer mon compte", sent: "Vérifiez votre boîte de réception" });

  await signIn(candidate, "Se connecter");
  await page.getByText("Confirmez d'abord votre adresse e-mail.", { exact: true }).waitFor();
  assert.equal(await status("/api/v2/auth/me"), 401);

  const verification = await mailFor(candidate, "/verify-email");
  assert.equal(verification.subject, "Confirmez votre adresse e-mail");
  await page.goto(`${base}/verify-email?token=${verification.token}`);
  await page.getByRole("button", { name: "Confirmer mon adresse", exact: true }).click();
  await page.getByText("Adresse confirmée. Vous pouvez vous connecter.", { exact: true }).waitFor();

  await signIn(candidate, "Se connecter");
  await page.getByRole("heading", { level: 1, name: "Bonjour", exact: true }).waitFor();
  await page.getByText("Espace candidat", { exact: true }).waitFor();
  await page.getByText(`Connecté·e en tant que ${candidate}`, { exact: true }).waitFor();
  const session = (await context.cookies()).find((cookie) => cookie.name === "tf_session");
  assert.ok(session, "session cookie set");
  assert.equal(session.httpOnly, true);
  assert.equal(session.sameSite, "Lax");
  assert.equal(await page.evaluate(() => document.cookie.includes("tf_session")), false, "session cookie hidden from JavaScript");
  assert.equal(await status("/api/v2/candidate/overview"), 200);
  assert.equal(await status("/api/v2/orgs"), 403, "candidates cannot use recruiter routes");

  // The session survives a reload; sign-out revokes it server-side.
  await page.reload();
  await page.getByRole("heading", { level: 1, name: "Bonjour", exact: true }).waitFor();
  await page.getByRole("button", { name: "Se déconnecter", exact: true }).click();
  await page.getByText("Vous êtes déconnecté·e.", { exact: true }).waitFor();
  assert.equal(await status("/api/v2/auth/me"), 401);
  await context.addCookies([{ ...session, url: base, domain: undefined, path: undefined }]);
  assert.equal(await status("/api/v2/auth/me"), 401, "a copied cookie is useless after sign-out");
  await context.clearCookies({ name: "tf_session" });

  // An unsafe request without the CSRF token is refused.
  const forged = await page.request.post(`${base}/api/v2/auth/logout`);
  assert.equal(forged.status(), 403);
  assert.equal((await forged.json()).detail.code, "csrf_failed");

  // Account deletion needs the password, then the account is gone.
  await signIn(candidate, "Se connecter");
  await page.getByRole("heading", { level: 1, name: "Bonjour", exact: true }).waitFor();
  const zone = page.locator("section", { has: page.getByRole("heading", { name: "Supprimer mon compte" }) });
  await zone.getByLabel("Mot de passe actuel", { exact: true }).fill("not the password at all");
  await zone.getByRole("button", { name: "Supprimer définitivement mon compte", exact: true }).click();
  await zone.getByText("Mot de passe incorrect. Le compte n'a pas été supprimé.", { exact: true }).waitFor();
  await zone.getByLabel("Mot de passe actuel", { exact: true }).fill(password);
  await zone.getByRole("button", { name: "Supprimer définitivement mon compte", exact: true }).click();
  await page.getByText("Votre compte et ses données personnelles ont été supprimés.", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/welcome");
  await signIn(candidate, "Se connecter");
  await page.getByText("Adresse e-mail ou mot de passe incorrect.", { exact: true }).waitFor();

  // English recruiter: the language switch is explicit and stored on click.
  await page.goto(`${base}/welcome`);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Hiring decisions grounded in evidence." }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("talentflow-language")), "en");
  const recruiter = `recruiter-${run}@example.com`;
  await signUp({ email: recruiter, roleLink: /^I am recruiting/, formHeading: "Recruiter sign-up", submit: "Create my account", sent: "Check your inbox" });
  const recruiterMail = await mailFor(recruiter, "/verify-email");
  assert.equal(recruiterMail.subject, "Confirm your e-mail address");
  await page.goto(`${base}/verify-email?token=${recruiterMail.token}`);
  await page.getByRole("button", { name: "Confirm my address", exact: true }).click();
  await page.getByText("Address confirmed. You can now sign in.", { exact: true }).waitFor();
  await signIn(recruiter, "Sign in");
  await page.getByText("Recruiter space", { exact: true }).waitFor();
  assert.equal(await status("/api/v2/candidate/overview"), 403, "recruiters cannot use candidate routes");
  await page.getByLabel("Organization name", { exact: true }).fill("Fictional Hiring Co");
  await page.getByRole("button", { name: "Create the organization", exact: true }).click();
  const organizations = page.getByRole("list", { name: "Organization" });
  await organizations.getByText("Fictional Hiring Co", { exact: true }).waitFor();
  await organizations.getByText("1 member", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByText("You are signed out.", { exact: true }).waitFor();
  assert.equal(await status("/api/v2/orgs"), 401);

  // Narrow screens: the role choice fits without horizontal scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/register`);
  await page.getByRole("heading", { name: "Which space do you want to open?" }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal overflow on mobile");
  await page.setViewportSize({ width: 1280, height: 900 });

  // The demo still works without any account.
  await context.clearCookies();
  await page.goto(base);
  await page.getByRole("heading", { name: "A clearer view of talent.", exact: true }).waitFor();
  await page.getByRole("link", { name: "My account", exact: true }).waitFor();

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(cspViolations, []);
  console.log("auth-smoke: FR candidate and EN recruiter sign-up, verification, sign-in, sign-out, revocation, CSRF and deletion passed");
} finally {
  await browser.close();
}
