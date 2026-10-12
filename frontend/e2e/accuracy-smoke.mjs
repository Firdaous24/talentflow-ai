import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const fixtures = JSON.parse(
  await readFile(
    process.env.ACCURACY_FIXTURE_PATH ?? "/fixtures/accuracy_regression.json",
    "utf8",
  ),
);
const fixture = fixtures[0];
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const escape = (text) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  const rows = fixture.rows
    .map(
      (row) =>
        `<div style="position:absolute;left:${row.x ?? 40}pt;top:${row.y}pt;width:${row.width ?? 515}pt;font-size:${row.size ?? 8.5}pt;font-weight:${row.bold ? "bold" : "normal"}">${escape(row.text)}</div>${row.date ? `<div style="position:absolute;left:415pt;top:${row.y + (row.date_offset ?? 0)}pt;width:140pt;font-size:8pt">${escape(row.date)}</div>` : ""}`,
    )
    .join("");
  await page.setContent(
    `<html><body style="margin:0;font-family:Arial;position:relative;width:595pt;height:842pt">${rows}</body></html>`,
  );
  const bytes = await page.pdf({
    width: `${595 / 72}in`,
    height: `${842 / 72}in`,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  await page.goto(`${base}/parser`);
  await page
    .locator("#cv-file")
    .setInputFiles({
      name: "fictional-accuracy.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
  const response = page.waitForResponse(
    (value) =>
      value.url().endsWith("/api/v1/candidates/parse") &&
      value.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const http = await response;
  assert.equal(http.status(), 200);
  const parsed = await http.json();
  assert.equal(parsed.parsing_metadata.llm_status, "not_requested");
  assert.equal(parsed.candidate.experience.length, 3);
  assert.equal(parsed.candidate.education.length, 3);
  assert.equal(parsed.candidate.projects.length, 3);
  assert.equal(
    parsed.candidate.experience[0].job_title,
    fixture.ground_truth.experience[0].job_title,
  );
  assert.equal(
    parsed.candidate.experience[0].company,
    fixture.ground_truth.experience[0].company,
  );
  assert.equal(parsed.candidate.experience[0].location, "Maroc");
  assert.equal(parsed.candidate.experience[0].start_date, "2026-02");
  assert.equal(
    parsed.candidate.education[1].degree,
    "Cycle Préparatoire Intégré",
  );
  assert.ok(
    parsed.candidate.technical_skills.some((value) => value.name === "Talend"),
  );
  await page
    .getByRole("heading", { name: "Alex Fictif", exact: true })
    .waitFor();
  const toggle = page.getByRole("button", { name: "Show all warnings" });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.click();
  const hide = page.getByRole("button", { name: "Hide warnings" });
  assert.equal(await hide.getAttribute("aria-expanded"), "true");
  await hide.click();
  const exp = await page
    .getByRole("heading", { name: /^Work experience/ })
    .locator("..")
    .boundingBox();
  const edu = await page
    .getByRole("heading", { name: /^Education/ })
    .locator("..")
    .boundingBox();
  assert.ok(
    exp.height > edu.height + 40,
    "Experience and education keep independent content heights",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (process.env.SCREENSHOT_DIR) {
    await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/phase36-profile-desktop.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: `${process.env.SCREENSHOT_DIR}/phase36-profile-mobile.png`,
      fullPage: true,
    });
  await page.getByRole("button", { name: "Review & correct profile" }).click();
  await page
    .getByLabel("Location", { exact: true })
    .first()
    .fill("Lieu corrigé");
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page.getByRole("button", { name: "Confirm reviewed profile" }).click();
  await page
    .getByRole("heading", { name: "Profile confirmed", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: live dense French CV, 3 jobs/3 education/3 projects, full role/employer/month dates/location, skills, warning toggles, natural card heights, mobile review and no external model.",
  );
} finally {
  await browser.close();
}
