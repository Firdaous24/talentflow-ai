import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

// Candidate space against the real stack (nginx -> FastAPI -> PostgreSQL, e-mails
// in Mailpit): sign-up, CV upload and review, a pasted job post, criteria review,
// documentary coverage with side-by-side evidence, honest gaps, a second CV
// version, version diff, export and complete deletion. Fictional data only.
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const mailpit = process.env.MAILPIT_URL ?? "http://host.docker.internal:8025";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = `candidate-space-${run}@example.com`;
const password = "a long fictional passphrase for e2e";
const JOB = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\nTechnical environment: PostgreSQL, Redis\n";
const cv = (skills) => `<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Avery Example
Email: avery@example.com
Technical Skills
${skills}
Education
Degree: BSc
Institution: Fictional Computing College
Field of study: Computer Science
Projects
Name: Practice API
Description: A fictional learning API.
Technologies: Python, FastAPI
Languages
English: Fluent</div></body></html>`;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
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

async function pdf(skills) {
  const renderer = await context.newPage();
  await renderer.setContent(cv(skills));
  const bytes = await renderer.pdf({ format: "A4" });
  await renderer.close();
  return bytes;
}

async function verificationToken(address) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
    const { messages = [] } = await search.json();
    for (const summary of messages) {
      const message = await (await fetch(`${mailpit}/api/v1/message/${summary.ID}`)).json();
      const match = message.Text?.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification e-mail for ${address}`);
}

const text = async (locator) => (await locator.textContent()).replace(/\s+/g, " ").trim();
const nav = () => page.getByRole("navigation", { name: "Espace candidat" });

async function upload(bytes, number) {
  await nav().getByRole("link", { name: "Mon CV", exact: true }).click();
  await page.getByLabel("Fichier PDF", { exact: true }).setInputFiles({ name: `fictional-cv-${number}.pdf`, mimeType: "application/pdf", buffer: bytes });
  await page.getByRole("button", { name: "Déposer cette version", exact: true }).click();
  await page.getByText(`Version ${number} créée. Revoyez-la, puis confirmez-la.`, { exact: true }).waitFor();
  return page.getByRole("region", { name: `Revoir la version ${number}` });
}

async function confirm(review) {
  await review.getByRole("checkbox", { name: "J'ai relu les avertissements et vérifié mon profil." }).check();
  await review.getByRole("button", { name: "Confirmer ce profil", exact: true }).click();
  await review.getByText("Profil confirmé. Il sert désormais à la couverture de vos offres.", { exact: true }).waitFor();
}

try {
  // Sign up as a candidate (French by default) and sign in.
  await page.goto(`${base}/register/candidate`);
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("checkbox", { name: /^J'accepte/ }).check();
  await page.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  await page.getByRole("heading", { name: "Vérifiez votre boîte de réception", exact: true }).waitFor();
  await page.goto(`${base}/verify-email?token=${await verificationToken(email)}`);
  await page.getByRole("button", { name: "Confirmer mon adresse", exact: true }).click();
  await page.getByText("Adresse confirmée. Vous pouvez vous connecter.", { exact: true }).waitFor();
  await page.goto(`${base}/login`);
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  const path = page.getByRole("region", { name: "Votre parcours" });
  await path.getByRole("link", { name: "Prochaine étape : Déposer mon CV" }).waitFor();

  // Version 1: upload, check the extraction, confirm without edits.
  const first = await upload(await pdf("Python, FastAPI, Git"), 1);
  const skills = first.getByRole("group", { name: "Compétences techniques", exact: true });
  const values = await skills.getByLabel("Nom", { exact: true }).evaluateAll((inputs) => inputs.map((input) => input.value));
  assert.deepEqual(values, ["Python", "FastAPI", "Git"]);
  await page.getByText("Ce serveur ne conserve que le texte chiffré : le PDF original n'est pas gardé.", { exact: true }).waitFor();
  await confirm(first);

  // Paste a job post: coverage stays blocked until its criteria are confirmed.
  await nav().getByRole("link", { name: "Mes offres", exact: true }).click();
  await page.getByLabel("Texte de l'offre (français ou anglais)").fill(JOB);
  await page.getByRole("button", { name: "Analyser l'offre", exact: true }).click();
  await page.getByRole("heading", { level: 2, name: "Backend Developer", exact: true }).waitFor();
  await page.getByText("Confirmez d'abord les critères de cette offre.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("region", { name: "Couverture documentaire" }).count(), 0);
  assert.equal(await page.getByLabel("Classification du critère req-002").inputValue(), "required");
  await page.getByRole("button", { name: "Confirmer les critères", exact: true }).click();

  // Coverage: exact counts, permanent notice, neutral absence, exact highlighted spans.
  const report = page.getByRole("region", { name: "Couverture documentaire" });
  const count = report.getByRole("group", { name: "Décompte" });
  await count.waitFor();
  assert.equal(await text(count), "1/3 requis · 1/2 souhaités · 1 à interpréter");
  assert.match(await text(report.getByRole("note")), /version 1\). Ce n'est pas une évaluation de votre compétence/);
  const docker = report.getByRole("article", { name: "Docker", exact: true });
  assert.equal(await text(docker.locator(".status-pill")), "Non documenté");
  // A neutral, dashed absence: never the red reserved for system errors.
  assert.equal(await docker.evaluate((element) => getComputedStyle(element).borderTopStyle), "dashed");
  const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--danger").trim());
  const colors = await docker.locator(".status-pill").evaluate((element) => [getComputedStyle(element).color, getComputedStyle(element).borderColor]);
  const probe = await page.evaluate((value) => { const node = document.createElement("span"); node.style.color = value; document.body.append(node); const rgb = getComputedStyle(node).color; node.remove(); return rgb; }, danger);
  assert.ok(!colors.includes(probe), "not documented is never red");
  await docker.getByText("Aucun passage de votre CV ne documente ce critère.").waitFor();
  const python = report.getByRole("article", { name: "Python", exact: true });
  const quotes = await python.locator("blockquote").evaluateAll((items) => items.map((item) => item.firstChild.textContent));
  // One job span and one or more CV spans; each highlighted span is exactly the evidence.
  assert.ok(quotes.length >= 2 && quotes.every((quote) => quote === "Python"), quotes.join());
  const jobBadge = await text(python.locator(".evidence-doc.job .offset-badge"));
  const [, start, end] = jobBadge.match(/(\d+)–(\d+)/).map(Number);
  assert.equal(Array.from(JOB).slice(start, end).join(""), "Python");
  await report.getByRole("button", { name: "Afficher : 1/3 requis" }).click();
  assert.deepEqual(await report.getByRole("article").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))), ["Python", "Docker", "Fluent English"]);
  await report.getByRole("button", { name: "Tous les critères", exact: true }).click();
  assert.equal(await report.getByText(/\d+\s?%|score/i).count(), 0);

  // Gaps are fixed sentences; the link opens the matching CV section.
  const gaps = page.getByRole("region", { name: "Écarts" });
  const dockerGap = gaps.getByRole("listitem").filter({ hasText: "Docker" });
  await dockerGap.getByText("Ce critère n'apparaît pas dans votre CV. Si c'est vrai, ajoutez-le avec un exemple vérifiable.", { exact: true }).waitFor();
  const offerUrl = page.url();
  await dockerGap.getByRole("link", { name: "Revoir « Compétences techniques » dans mon CV" }).click();
  await page.waitForURL(/\/account\/cv#cv-section-technical_skills$/);
  await page.waitForFunction(() => document.activeElement?.id === "cv-section-technical_skills");

  // Version 2: the candidate documents Docker in a new upload. Version 1 stays readable.
  const second = await upload(await pdf("Python, FastAPI, Docker"), 2);
  await confirm(second);
  const history = page.getByRole("list", { name: "Historique des versions" });
  assert.equal(await history.getByRole("listitem").count(), 2);
  await page.getByRole("button", { name: "Ouvrir la version 1", exact: true }).click();
  const old = page.getByRole("region", { name: "Revoir la version 1" });
  await old.getByText(/Version antérieure : consultable, mais plus modifiable/).waitFor();
  assert.equal(await old.getByRole("button", { name: "Enregistrer la revue" }).count(), 0);
  const diff = page.getByRole("region", { name: "Comparer deux versions" });
  await diff.getByLabel("Version de départ").selectOption({ label: "Version 1" });
  await diff.getByLabel("Version d'arrivée").selectOption({ label: "Version 2" });
  await diff.getByRole("button", { name: "Comparer", exact: true }).click();
  const changed = diff.getByRole("group", { name: "Compétences techniques" });
  assert.match(await text(changed), /Ajouté Docker/);
  assert.match(await text(changed), /Retiré Git/);

  // The coverage now uses version 2: one more required criterion is documented.
  await page.goto(offerUrl);
  await count.waitFor();
  assert.equal(await text(count), "2/3 requis · 1/2 souhaités · 1 à interpréter");
  assert.match(await text(report.getByRole("note")), /version 2\)/);
  await nav().getByRole("link", { name: "Aperçu", exact: true }).click();
  await path.getByRole("link", { name: "Prochaine étape : Lire ma couverture et mes écarts" }).waitFor();

  // Narrow screens: the CV page fits without horizontal scrolling.
  await page.setViewportSize({ width: 390, height: 844 });
  await nav().getByRole("link", { name: "Mon CV", exact: true }).click();
  await page.getByRole("region", { name: "Revoir la version 2" }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no horizontal overflow on mobile");
  await page.setViewportSize({ width: 1280, height: 900 });

  // Export: complete and decrypted for the owner only.
  await nav().getByRole("link", { name: "Aperçu", exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Exporter mes données", exact: true }).click()]);
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.account.email, email);
  assert.deepEqual(exported.cv_versions.map((version) => version.number), [1, 2]);
  assert.match(exported.cv_versions[1].extracted_text, /Docker/);
  assert.equal(exported.cv_versions[0].original_pdf_base64, null);
  assert.equal(exported.job_posts[0].source_text, JOB);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);

  // Deleting the account removes everything; the job post URL no longer answers.
  const zone = page.locator("section", { has: page.getByRole("heading", { name: "Supprimer mon compte" }) });
  await zone.getByLabel("Mot de passe actuel", { exact: true }).fill(password);
  await zone.getByRole("button", { name: "Supprimer définitivement mon compte", exact: true }).click();
  await page.getByText("Votre compte et ses données personnelles ont été supprimés.", { exact: true }).waitFor();
  assert.equal((await page.request.get(`${base}/api/v2/me/cv/versions`)).status(), 401);
  await page.goto(`${base}/login`);
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByText("Adresse e-mail ou mot de passe incorrect.", { exact: true }).waitFor();

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(cspViolations, []);
  console.log("candidate-smoke: CV versions, review, job post criteria, coverage counts, evidence, gaps, diff, export and deletion passed");
} finally {
  await browser.close();
}
