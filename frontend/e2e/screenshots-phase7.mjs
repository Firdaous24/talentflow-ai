import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Review captures of the phase 7 candidate space, light and dark, in French.
// Creates one fictional candidate (example.com), captures the overview, the CV
// review, the job posts and a coverage report, then deletes the account.
// Writes PNG files to OUT_DIR (mount a host folder there).
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const mailpit = process.env.MAILPIT_URL ?? "http://host.docker.internal:8025";
const out = process.env.OUT_DIR ?? "/out";
const email = `screens-${Date.now().toString(36)}@example.com`;
const password = "a long fictional passphrase for screenshots";
const JOB = "Backend Developer\nRequired qualifications:\n- Python\n- Docker\n- Fluent English\nPreferred qualifications:\n- Kubernetes\n- FastAPI\nTechnical environment: PostgreSQL, Redis\n";
const CV = `<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Avery Example
Email: avery@example.com
Technical Skills
Python, FastAPI, Git
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

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(20000);

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

async function shot(name, theme, fullPage = false) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${name}-${theme}.png`, fullPage });
}

try {
  const renderer = await context.newPage();
  await renderer.setContent(CV);
  const pdf = await renderer.pdf({ format: "A4" });
  await renderer.close();

  await page.goto(`${base}/register/candidate`);
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
  await page.getByRole("region", { name: "Votre parcours" }).waitFor();

  await page.goto(`${base}/account/cv`);
  await page.getByLabel("Fichier PDF", { exact: true }).setInputFiles({ name: "fictional-cv.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.getByRole("button", { name: "Déposer cette version" }).click();
  const review = page.getByRole("region", { name: "Revoir la version 1" });
  await review.getByRole("checkbox", { name: "J'ai relu les avertissements et vérifié mon profil." }).check();
  await review.getByRole("button", { name: "Confirmer ce profil" }).click();
  await review.getByText("Profil confirmé. Il sert désormais à la couverture de vos offres.").waitFor();

  await page.goto(`${base}/account/offers`);
  await page.getByLabel("Texte de l'offre (français ou anglais)").fill(JOB);
  await page.getByRole("button", { name: "Analyser l'offre" }).click();
  await page.getByRole("button", { name: "Confirmer les critères" }).click();
  await page.getByRole("group", { name: "Décompte" }).waitFor();
  const offer = page.url();

  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => localStorage.setItem("talentflow-theme", value), theme);
    await page.goto(`${base}/account`);
    await page.getByRole("region", { name: "Votre parcours" }).waitFor();
    await shot("candidate-overview", theme);
    await page.goto(`${base}/account/cv`);
    await page.getByRole("region", { name: "Revoir la version 1" }).waitFor();
    await shot("candidate-cv", theme);
    await page.goto(`${base}/account/offers`);
    await page.getByRole("list", { name: "Offres enregistrées" }).waitFor();
    await shot("candidate-offers", theme);
    await page.goto(offer);
    await page.getByRole("group", { name: "Décompte" }).waitFor();
    await top("coverage-heading");
    await shot("candidate-coverage", theme);
    await top("gaps-heading");
    await shot("candidate-gaps", theme);
  }

  await page.evaluate(() => localStorage.clear());
  await page.goto(`${base}/account`);
  const zone = page.locator("section", { has: page.getByRole("heading", { name: "Supprimer mon compte" }) });
  await zone.getByLabel("Mot de passe actuel", { exact: true }).fill(password);
  await zone.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
  await page.getByText("Votre compte et ses données personnelles ont été supprimés.").waitFor();
  console.log(`screenshots written to ${out}; the fictional account was deleted`);
} finally {
  await browser.close();
}
