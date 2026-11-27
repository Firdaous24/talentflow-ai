import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Review captures of the phase 8 recruiter space, light and dark, in French:
// job posts, bulk import with the review queue, anonymous ranking, identity
// reveal (form and result). Creates one fictional recruiter (example.com),
// imports 8 generated fictional PDFs, then deletes the account (and with it the
// organization, offer, imports and matches). Writes PNG files to OUT_DIR.
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const mailpit = process.env.MAILPIT_URL ?? "http://host.docker.internal:8025";
const out = process.env.OUT_DIR ?? "/out";
const run = Date.now().toString(36);
const email = `screens-recruiter-${run}@example.com`;
const password = "a long fictional passphrase for screenshots";
const JOB = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\nTechnical environment: PostgreSQL, Redis\n";
const SKILLS = [["Python", "Docker", "FastAPI"], ["Python"], ["Docker", "Kubernetes"], ["Python", "Docker", "FastAPI"], ["Python", "FastAPI"]];
const cv = (number) => `<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Fictional Applicant ${number}
Email: applicant${number}-${run}@example.com
Technical Skills
${SKILLS[number % SKILLS.length].join(", ")}
Education
Degree: BSc
Field of study: Computer Science
Languages
English: Fluent</div></body></html>`;

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(30000);

async function token() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const { messages = [] } = await (await fetch(`${mailpit}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    for (const summary of messages) {
      const match = (await (await fetch(`${mailpit}/api/v1/message/${summary.ID}`)).json()).Text?.match(/\/verify-email\?token=([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("no verification e-mail");
}

async function top(id) {
  await page.evaluate((target) => {
    const element = document.getElementById(target);
    window.scrollTo(0, element.getBoundingClientRect().top + window.scrollY - 24);
  }, id);
}

async function shot(name, theme) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${name}-${theme}.png` });
}

async function ranked() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const section = page.getByRole("region", { name: "Classement anonyme" });
    await section.waitFor();
    if ((await section.locator(".ranking-row").count()) === 6 && (await section.getByText(/en cours de calcul/).count()) === 0) return section;
    await page.waitForTimeout(1000);
    await page.reload();
  }
  throw new Error("ranking not ready");
}

try {
  await page.goto(`${base}/register/recruiter`);
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("checkbox", { name: /^J'accepte/ }).check();
  await page.getByRole("button", { name: "Créer mon compte", exact: true }).click();
  await page.getByRole("heading", { name: "Vérifiez votre boîte de réception" }).waitFor();
  await page.goto(`${base}/verify-email?token=${await token()}`);
  await page.getByRole("button", { name: "Confirmer mon adresse" }).click();
  await page.getByText("Adresse confirmée. Vous pouvez vous connecter.").waitFor();
  await page.goto(`${base}/login`);
  await page.getByLabel("Adresse e-mail", { exact: true }).fill(email);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page.getByLabel("Nom de l'organisation", { exact: true }).fill("Atlas Recrutement (fictif)");
  await page.getByRole("button", { name: "Créer l'organisation" }).click();
  await page.getByRole("list", { name: "Organisation" }).getByText("Atlas Recrutement (fictif)").waitFor();

  await page.goto(`${base}/account/jobs`);
  await page.getByLabel("Texte de l'offre (français ou anglais)").fill(JOB);
  await page.getByRole("button", { name: "Analyser l'offre" }).click();
  await page.getByRole("button", { name: "Confirmer les critères" }).click();
  await page.getByRole("button", { name: "Ouvrir l'offre" }).click();
  await page.getByRole("button", { name: "Rendre publique" }).click();
  await page.getByRole("button", { name: "Rendre privée" }).waitFor();
  const jobUrl = page.url();

  const renderer = await context.newPage();
  const files = [];
  for (let number = 1; number <= 8; number += 1) {
    await renderer.setContent(cv(number));
    files.push({ name: `fictional-${number}.pdf`, mimeType: "application/pdf", buffer: await renderer.pdf({ format: "A4" }) });
  }
  await renderer.close();
  const importCard = page.getByRole("region", { name: "Importer des CV" });
  await importCard.getByLabel("Fichiers PDF").setInputFiles(files);
  await importCard.getByRole("checkbox", { name: "Les candidats ont été informés du traitement de leur CV." }).check();
  await importCard.getByRole("button", { name: "Importer 8 fichiers" }).click();
  await importCard.getByText(/^8 analysés$/).waitFor();
  const review = page.getByRole("region", { name: "À revoir" });
  for (let remaining = 8; remaining > 2; remaining -= 1) {
    const item = review.getByRole("listitem", { name: /^Profil importé n°\d+$/ }).first();
    await item.getByRole("checkbox", { name: "J'ai relu ce profil et ses avertissements." }).check();
    await item.getByRole("button", { name: "Confirmer pour le classement" }).click();
    for (let attempt = 0; attempt < 100 && (await review.getByRole("listitem", { name: /^Profil importé n°\d+$/ }).count()) !== remaining - 1; attempt += 1) await page.waitForTimeout(100);
  }
  await page.goto(jobUrl);
  await ranked();

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("talentflow-theme", value), theme);
    await page.goto(`${base}/account/jobs`);
    await page.getByRole("list", { name: "Offres de l'organisation" }).waitFor();
    await shot("recruiter-jobs", theme);

    await page.goto(jobUrl);
    await page.getByRole("region", { name: "Importer des CV" }).getByText(/8\/8 fichiers/).waitFor();
    await page.getByRole("listitem", { name: /^Profil importé n°\d+$/ }).first().waitFor();
    await top("import-heading");
    await shot("recruiter-import", theme);

    const section = await ranked();
    await top("ranking-heading");
    await shot("recruiter-ranking", theme);

    // Light: the reveal form, then its result on the top match. Dark: the result, then the form on the next one.
    const rows = section.locator(".ranking-row");
    const openRow = async (index) => {
      await rows.nth(index).getByRole("button", { name: /^Ouvrir les preuves : .* requis$/ }).click();
      await page.getByRole("heading", { level: 3, name: /^Preuves · / }).waitFor();
      await page.locator(".evidence-panel article").first().waitFor();
    };
    const form = async (index) => {
      await openRow(index);
      await page.getByLabel("Motif").selectOption("interview_scheduled");
      await page.getByLabel("Précision (obligatoire)").fill("Entretien prévu (fictif)");
      await page.locator(".reveal-form").scrollIntoViewIfNeeded();
      await page.evaluate(() => window.scrollBy(0, 160));
      await shot("recruiter-reveal-form", theme);
    };
    if (theme === "light") {
      await form(0);
      await page.getByRole("button", { name: "Lever l'anonymat", exact: true }).click();
    } else {
      await openRow(0);
    }
    await page.getByRole("group", { name: "Identité" }).waitFor();
    await page.getByRole("group", { name: "Identité" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 200));
    await shot("recruiter-reveal-done", theme);
    if (theme === "dark") {
      await page.goto(jobUrl);
      await ranked();
      await form(1);
    }
  }

  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/account`);
  const zone = page.locator("section", { has: page.getByRole("heading", { name: "Supprimer mon compte" }) });
  await zone.getByLabel("Mot de passe actuel", { exact: true }).fill(password);
  await zone.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
  await page.getByText("Votre compte et ses données personnelles ont été supprimés.").waitFor();
  console.log(`screenshots written to ${out}; the fictional account and its organization were deleted`);
} finally {
  await browser.close();
}
