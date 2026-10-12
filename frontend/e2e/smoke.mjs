import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const baseURL = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  // Generate only fictional CV content. PDF bytes remain in memory.
  await page.setContent(`<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Avery Example
Email: avery@example.com
Phone: +1 202 555 0101
Technical Skills
Python, FastAPI, Git
Education
Degree: BSc
Institution: Fictional Computing College
Field of study: Computer Science
Start date: 2020
End date: 2024
Experience
Job title: Developer
Company: Synthetic Software Lab
Start date: 2024
End date: Present
Description: Built fictional demonstration APIs.
Projects
Name: Practice API
Description: A fictional learning API.
Technologies: Python, FastAPI
Languages
English: Fluent
Certifications
Name: Fictional Python Fundamentals
Issuer: Example Training
Date: 2024</div></body></html>`);
  const pdf = await page.pdf({ format: "A4" });
  const response = await page.goto(baseURL);
  assert.equal(response.status(), 200);
  await page.getByText("Backend connected").first().waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (process.env.SCREENSHOT_DIR) {
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/dashboard-desktop.png`,
      fullPage: true,
    });
  }
  await page.getByRole("link", { name: "CV Parser", exact: true }).click();
  await page.locator("#cv-file").setInputFiles({
    name: "synthetic.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await page.getByText("synthetic.pdf", { exact: true }).waitFor();
  const parseResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/candidates/parse") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const parsed = await parseResponse;
  assert.equal(parsed.status(), 200);
  const result = await parsed.json();
  assert.equal(result.candidate.full_name, "Avery Example");
  assert.equal(result.candidate.email, "avery@example.com");
  assert.equal(result.parsing_metadata.status, "partial");
  assert.ok(
    result.candidate.technical_skills.some((skill) => skill.name === "Python"),
  );
  await page
    .getByRole("heading", { name: "Avery Example", exact: true })
    .waitFor();
  for (const title of [
    "Work experience",
    "Education",
    "Technical skills",
    "Projects",
    "Languages",
    "Certifications",
  ])
    await page.getByRole("heading", { name: new RegExp(title) }).waitFor();
  await page.getByRole("region", { name: "Extraction warnings" }).waitFor();
  await page.getByRole("button", { name: "Review & correct profile" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Avery Reviewed");
  await page.getByLabel("Phone", { exact: true }).fill("+212 612 345 678");
  await page
    .getByRole("button", { name: "Remove experience 1", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page.getByRole("button", { name: "Confirm reviewed profile" }).click();
  await page
    .getByRole("heading", { name: "Profile confirmed", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Candidates", exact: true }).click();
  await page
    .getByRole("heading", { name: "Avery Reviewed", exact: true })
    .waitFor();
  await page.getByRole("link", { name: /Avery Reviewed/ }).click();
  await page
    .getByRole("heading", { name: "Candidate profile", exact: true })
    .waitFor();
  // Check SPA route fallback and verify that candidate data does not survive refresh.
  await page.reload();
  await page.getByRole("heading", { name: "Profile unavailable" }).waitFor();
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${baseURL}/parser`);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();
  await page
    .getByRole("heading", { name: "A clearer view of talent." })
    .waitFor();
  await page.waitForFunction(
    () => document.querySelector(".sidebar").getBoundingClientRect().right <= 1,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/dashboard-mobile.png`,
      fullPage: true,
    });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "CV Parser", exact: true }).click();
  await page.locator("#cv-file").setInputFiles({
    name: "bad.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("invalid"),
  });
  await page
    .getByRole("alert")
    .filter({ hasText: "valid PDF header" })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Parse CV", exact: true })
      .isDisabled(),
    true,
  );
  const renderer = await browser.newPage();
  await renderer.setContent(
    `<html><body style="font-family:Arial;font-size:11px;padding:25px"><h1 style="font-size:24px">Élodie Exemple</h1><p>elodie@example.com<br>+212 612 345 678</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:35px"><div><h2 style="font-size:14px">Compétences techniques</h2><p>Python, FastAPI, Docker, Git</p><h2 style="font-size:14px">Langues</h2><p>Arabe : langue maternelle<br>Français : maîtrise professionnelle<br>Anglais : niveau professionnel</p></div><div><h2 style="font-size:14px">Expériences professionnelles</h2><p>Développeur backend | Atelier Fictif<br>septembre 2023 - aujourd'hui<br>API fictive en Python et FastAPI.</p><h2 style="font-size:14px">Formation</h2><p>Master en informatique<br>Université Fictive<br>2021 - 2023</p></div></div></body></html>`,
  );
  const frenchPDF = await renderer.pdf({ format: "A4" });
  await renderer.close();
  await page
    .locator("#cv-file")
    .setInputFiles({
      name: "fictional-french.pdf",
      mimeType: "application/pdf",
      buffer: frenchPDF,
    });
  const frenchResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/candidates/parse") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const frenchHTTP = await frenchResponse;
  assert.equal(frenchHTTP.status(), 200);
  const frenchResult = await frenchHTTP.json();
  assert.equal(frenchResult.candidate.full_name, "Élodie Exemple");
  assert.equal(
    frenchResult.candidate.education[0].institution,
    "Université Fictive",
  );
  assert.equal(frenchResult.candidate.experience[0].company, "Atelier Fictif");
  assert.equal(frenchResult.candidate.experience[0].start_date, "2023-09");
  assert.equal(frenchResult.parsing_metadata.engine, "deterministic-v2");
  assert.ok(frenchResult.parsing_metadata.evidence.length > 0);
  await page
    .getByRole("heading", { name: "Élodie Exemple", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Review & correct profile" }).click();
  await page.getByLabel("Full name", { exact: true }).fill("Élodie Revue");
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page.getByRole("button", { name: "Confirm reviewed profile" }).click();
  await page
    .getByRole("heading", { name: "Élodie Revue", exact: true })
    .waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real Chromium desktop/mobile, English and two-column French PDF uploads, source evidence, corrections/removal/confirmation, candidate navigation, SPA refresh, session clearing, invalid PDF and no browser storage.",
  );
} finally {
  await browser.close();
}
