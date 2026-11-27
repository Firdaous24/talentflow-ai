import assert from "node:assert/strict";
import { chromium } from "playwright";

// Recruiter space against the real stack (nginx -> FastAPI -> PostgreSQL, worker
// queue, e-mails in Mailpit): organization, offer and criteria, bulk import of 10
// generated fictional PDFs with the mandatory attestation, review queue,
// anonymous lexicographic ranking with grouped ties, evidence, reasoned reveal,
// claim link deletion, and a registered candidate who appears only while their
// "visible to recruiters" consent is on. Fictional data only (example.com).
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const mailpit = process.env.MAILPIT_URL ?? "http://host.docker.internal:8025";
const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const password = "a long fictional passphrase for e2e";
const organization = `Fictional Hiring Co ${run}`;
const JOB = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\nTechnical environment: PostgreSQL, Redis\n";
const SKILLS = [["Python", "Docker", "FastAPI"], ["Python"], ["Docker", "Kubernetes"], ["Python", "Docker", "FastAPI"], ["Git"]];
const IDENTITY = /Imported Person|@example\.com|\+212|Fictional College|\b2019\b|\b2022\b/;
const cv = (number) => `<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Imported Person ${number}
Email: imported${number}-${run}@example.com
Phone: +212 600 000 ${String(number).padStart(3, "0")}
Technical Skills
${SKILLS[number % SKILLS.length].join(", ")}
Education
Degree: BSc
Institution: Fictional College ${number}
Field of study: Computer Science
Start date: 2019
End date: 2022
Languages
English: Fluent</div></body></html>`;

const browser = await chromium.launch({ headless: true });
const pageErrors = [];
const externalRequests = [];
const cspViolations = [];
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) cspViolations.push(message.text());
  });
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) externalRequests.push(request.url());
  });
  return page;
}

async function verificationToken(address) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { messages = [] } = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`)).json();
    for (const summary of messages) {
      const match = (await (await fetch(`${mailpit}/api/v1/message/${summary.ID}`)).json()).Text?.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No verification e-mail for ${address}`);
}

async function signUp(page, role, email) {
  await page.goto(`${base}/register/${role}`);
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
  await page.getByRole("heading", { level: 1, name: "Bonjour", exact: true }).waitFor();
}

const text = async (locator) => (await locator.textContent()).replace(/\s+/g, " ").trim();
const COUNTS = /^(\d+)\/(\d+) requis · (\d+)\/(\d+) souhaités · (\d+) à interpréter$/;

async function rankedRows(page) {
  const section = page.getByRole("region", { name: "Classement anonyme" });
  const rows = section.locator(".ranking-row");
  const result = [];
  for (let index = 0; index < (await rows.count()); index += 1) {
    const row = rows.nth(index);
    const [, required, , preferred, , review] = (await text(row.locator(".ranking-counts"))).match(COUNTS).map(Number);
    result.push({ alias: await text(row.locator(".ranking-alias")), required, preferred, review, source: await text(row.locator(".ranking-badges")) });
  }
  return result;
}

async function waitForRanking(page, predicate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const section = page.getByRole("region", { name: "Classement anonyme" });
    await section.waitFor();
    if ((await section.getByText(/en cours de calcul/).count()) === 0) {
      const rows = await rankedRows(page);
      if (predicate(rows)) return rows;
    }
    await page.waitForTimeout(1000);
    await page.reload();
  }
  throw new Error("ranking did not reach the expected state");
}

try {
  // Recruiter: organization, then an offer with confirmed criteria, open and public.
  const recruiter = await newPage();
  await signUp(recruiter, "recruiter", `recruiter-space-${run}@example.com`);
  await recruiter.getByLabel("Nom de l'organisation", { exact: true }).fill(organization);
  await recruiter.getByRole("button", { name: "Créer l'organisation", exact: true }).click();
  await recruiter.getByRole("list", { name: "Organisation" }).getByText(organization, { exact: true }).waitFor();
  const nav = recruiter.getByRole("navigation", { name: "Espace recruteur" });
  await nav.getByRole("link", { name: "Offres", exact: true }).click();
  await recruiter.getByLabel("Texte de l'offre (français ou anglais)").fill(JOB);
  await recruiter.getByRole("button", { name: "Analyser l'offre", exact: true }).click();
  await recruiter.getByRole("heading", { level: 2, name: "Backend Developer", exact: true }).waitFor();
  await recruiter.getByText("Confirmez les critères pour importer des CV et lire le classement.").waitFor();
  await recruiter.getByRole("button", { name: "Confirmer les critères", exact: true }).click();
  await recruiter.getByRole("button", { name: "Ouvrir l'offre", exact: true }).click();
  await recruiter.getByRole("button", { name: "Rendre publique", exact: true }).click();
  await recruiter.getByRole("button", { name: "Rendre privée", exact: true }).waitFor();
  const jobUrl = recruiter.url();

  // Bulk import of 10 generated PDFs: nothing leaves the browser before the attestation.
  const renderer = await recruiter.context().newPage();
  const files = [];
  for (let number = 1; number <= 10; number += 1) {
    await renderer.setContent(cv(number));
    files.push({ name: `fictional-${number}.pdf`, mimeType: "application/pdf", buffer: await renderer.pdf({ format: "A4" }) });
  }
  await renderer.close();
  const importCard = recruiter.getByRole("region", { name: "Importer des CV" });
  await importCard.getByLabel("Fichiers PDF").setInputFiles(files);
  const submit = importCard.getByRole("button", { name: "Importer 10 fichiers", exact: true });
  assert.equal(await submit.isDisabled(), true, "import is blocked without the attestation");
  await importCard.getByText(/supprimés automatiquement 90 jours après l'import/).waitFor();
  await importCard.getByRole("checkbox", { name: "Les candidats ont été informés du traitement de leur CV." }).check();
  await submit.click();
  await importCard.getByText(/10\/10 fichiers · attesté le/).waitFor();
  await importCard.getByText(/^10 analysés$/).waitFor();

  // Review queue: qualifications only, then confirm every profile.
  const review = recruiter.getByRole("region", { name: "À revoir" });
  await review.getByRole("listitem", { name: /^Profil importé n°\d+$/ }).first().waitFor();
  assert.equal(await review.getByRole("listitem", { name: /^Profil importé n°\d+$/ }).count(), 10);
  assert.ok(!IDENTITY.test(await review.textContent()), "the review queue never shows identity, contact, places or dates");
  for (let remaining = 10; remaining > 0; remaining -= 1) {
    const item = review.getByRole("listitem", { name: /^Profil importé n°\d+$/ }).first();
    await item.getByRole("checkbox", { name: "J'ai relu ce profil et ses avertissements." }).check();
    await item.getByRole("button", { name: "Confirmer pour le classement", exact: true }).click();
    for (let attempt = 0; attempt < 100 && (await review.getByRole("listitem", { name: /^Profil importé n°\d+$/ }).count()) !== remaining - 1; attempt += 1) await recruiter.waitForTimeout(100);
  }
  await review.getByText("Aucun profil à revoir.", { exact: true }).waitFor();

  // Anonymous ranking: strict lexicographic order, grouped ties, notice below, no identity in the DOM.
  const rows = await waitForRanking(recruiter, (items) => items.length === 10);
  for (let index = 1; index < rows.length; index += 1) {
    const [a, b] = [rows[index - 1], rows[index]];
    const order = a.required - b.required || a.preferred - b.preferred || b.review - a.review;
    assert.ok(order >= 0, `rows ${index - 1} and ${index} are out of order`);
  }
  assert.deepEqual([rows[0].required, rows[0].preferred, rows[0].review], [2, 1, 1]);
  assert.ok(rows.every((row) => /^Candidat·e A-\d+$/.test(row.alias)));
  const ranking = recruiter.getByRole("region", { name: "Classement anonyme" });
  assert.ok((await ranking.getByText("Même couverture · ordre d'arrivée, non significatif").count()) >= 1, "ties are grouped");
  assert.ok(!IDENTITY.test(await ranking.textContent()), "no identity anywhere in the ranking");
  const notice = ranking.getByRole("note");
  assert.match(await text(notice), /Classement par couverture documentaire\. Il n'évalue pas la compétence réelle\. La décision appartient au recruteur\./);
  assert.match(await text(notice), /ni rejet, ni acceptation, ni e-mail aux candidats/);
  assert.ok(await ranking.locator(".ranking-groups").evaluate((list, note) => Boolean(list.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING), await notice.elementHandle()), "the notice sits below the ranking");
  assert.equal(await ranking.locator("progress, meter").count(), 0);

  // Evidence opens from a count; identity only after a reasoned reveal.
  const top = rows[0].alias;
  const topRow = ranking.locator(".ranking-row").filter({ hasText: top });
  await topRow.getByRole("button", { name: /^Ouvrir les preuves : 2\/3 requis$/ }).click();
  const panel = recruiter.getByRole("region", { name: `Preuves · ${top}` });
  await panel.getByRole("article").first().waitFor();
  assert.deepEqual(await panel.getByRole("article").evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))), ["Python", "Docker", "Fluent English"]);
  assert.ok(!IDENTITY.test(await panel.textContent()));
  const reveal = panel.getByRole("button", { name: "Lever l'anonymat", exact: true });
  assert.equal(await reveal.isDisabled(), true, "a reason and a note are required");
  await panel.getByLabel("Motif").selectOption("interview_scheduled");
  await panel.getByLabel("Précision (obligatoire)").fill("Entretien fictif planifié");
  await reveal.click();
  await panel.getByRole("group", { name: "Identité" }).getByText(/^Imported Person \d+$/).waitFor();
  await panel.getByText(/motif : Entretien planifié/).waitFor();
  await topRow.getByText("Identité révélée").waitFor();

  // Claim link: the candidate deletes the imported profile without an account.
  await panel.getByRole("button", { name: "Créer le lien d'invitation", exact: true }).click();
  const link = await panel.getByLabel(/^Lien d'invitation/).inputValue();
  assert.match(link, /\/claim\?token=[A-Za-z0-9_-]+$/);
  const visitor = await newPage();
  await visitor.goto(link.replace(/^https?:\/\/[^/]+/, base));
  await visitor.getByText(`${organization} a importé votre CV pour l'offre « Backend Developer »`).waitFor();
  await visitor.getByRole("button", { name: "Supprimer mon profil maintenant", exact: true }).click();
  await visitor.getByText("Votre profil importé et votre CV ont été supprimés.", { exact: true }).waitFor();
  await recruiter.goto(jobUrl);
  const afterClaim = await waitForRanking(recruiter, (items) => items.length === 9);
  assert.ok(!afterClaim.some((row) => row.alias === top), "the deleted profile left the ranking");

  // A registered candidate is visible only while their consent is on.
  const candidate = await newPage();
  await signUp(candidate, "candidate", `applicant-${run}@example.com`);
  const renderer2 = await candidate.context().newPage();
  await renderer2.setContent(cv(1).replace("Imported Person 1", "Registered Applicant"));
  const pdf = await renderer2.pdf({ format: "A4" });
  await renderer2.close();
  await candidate.goto(`${base}/account/cv`);
  await candidate.getByLabel("Fichier PDF", { exact: true }).setInputFiles({ name: "applicant.pdf", mimeType: "application/pdf", buffer: pdf });
  await candidate.getByRole("button", { name: "Déposer cette version", exact: true }).click();
  const versionReview = candidate.getByRole("region", { name: "Revoir la version 1" });
  await versionReview.getByRole("checkbox", { name: "J'ai relu les avertissements et vérifié mon profil." }).check();
  await versionReview.getByRole("button", { name: "Confirmer ce profil", exact: true }).click();
  await versionReview.getByText("Profil confirmé. Il sert désormais à la couverture de vos offres.").waitFor();
  await candidate.goto(`${base}/account/offers`);
  const publicJobs = candidate.getByRole("region", { name: "Offres publiques" });
  await publicJobs.getByRole("button", { name: `Postuler · Backend Developer · ${organization}` }).click();
  await publicJobs.getByText("Activez d'abord « Visibilité auprès des recruteurs » dans l'aperçu.").waitFor();
  await candidate.goto(`${base}/account`);
  await candidate.getByRole("switch", { name: "Non visible" }).click();
  await candidate.getByRole("switch", { name: "Visible par les recruteurs" }).waitFor();
  await candidate.goto(`${base}/account/offers`);
  await publicJobs.getByRole("button", { name: `Postuler · Backend Developer · ${organization}` }).click();
  await publicJobs.getByText("Candidature envoyée", { exact: true }).waitFor();
  await recruiter.goto(jobUrl);
  await waitForRanking(recruiter, (items) => items.some((row) => row.source.includes("Candidature")));
  assert.ok(!/Registered Applicant|applicant-/.test(await recruiter.getByRole("region", { name: "Classement anonyme" }).textContent()));

  await candidate.goto(`${base}/account`);
  await candidate.getByRole("switch", { name: "Visible par les recruteurs" }).click();
  await candidate.getByRole("switch", { name: "Non visible" }).waitFor();
  await recruiter.reload();
  const hidden = await waitForRanking(recruiter, (items) => items.length === 9);
  assert.ok(!hidden.some((row) => row.source.includes("Candidature")), "withdrawing the consent hides the candidate at once");

  // Clean up: deleting both accounts removes the organization, its offer, imports and matches.
  for (const page of [candidate, recruiter]) {
    await page.goto(`${base}/account`);
    const zone = page.locator("section", { has: page.getByRole("heading", { name: "Supprimer mon compte" }) });
    await zone.getByLabel("Mot de passe actuel", { exact: true }).fill(password);
    await zone.getByRole("button", { name: "Supprimer définitivement mon compte", exact: true }).click();
    await page.getByText("Votre compte et ses données personnelles ont été supprimés.", { exact: true }).waitFor();
  }

  assert.deepEqual(pageErrors, []);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(cspViolations, []);
  console.log("recruiter-smoke: offer, attested import of 10 PDFs, review, anonymous lexicographic ranking, evidence, reasoned reveal, claim deletion and consent-gated application passed");
} finally {
  await browser.close();
}
