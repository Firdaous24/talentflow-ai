import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const cases = JSON.parse(
  await readFile(
    process.env.JOB_FIXTURE_PATH ?? "/fixtures/jobs_realistic.json",
    "utf8",
  ),
).cases;
const fixture = cases.find((entry) => entry.id === "ai_architect_fr");
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const responseFor = (path) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith(path) && response.request().method() === "POST",
  );
const exactSource = (text, evidence) =>
  assert.equal(
    Array.from(text).slice(evidence.start, evidence.end).join(""),
    evidence.quote,
  );
async function screenshot(name) {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: `${process.env.SCREENSHOT_DIR}/${name}.png`,
    fullPage: true,
  });
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}

try {
  // Only invented content; the CV PDF is generated in memory, never persisted.
  await page.setContent(`<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Robin Fictional
Email: robin@example.com
Technical Skills
Python, FastAPI
Experience
Job title: Python Developer
Company: Synthetic Learning Studio
Start date: 2024
End date: Present
Description: Built fictional Python services.
Projects
Name: Demonstration API
Technologies: Python, FastAPI</div></body></html>`);
  const bytes = await page.pdf({ format: "A4" });
  await page.goto(`${base}/parser`);
  await page
    .locator("#cv-file")
    .setInputFiles({
      name: "fictional-phase41.pdf",
      mimeType: "application/pdf",
      buffer: bytes,
    });
  const parseResponse = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const parseHTTP = await parseResponse;
  assert.equal(parseHTTP.status(), 200);
  const parsed = await parseHTTP.json();
  assert.ok(
    parsed.candidate.technical_skills.every((skill) =>
      ["Python", "FastAPI"].includes(skill.name),
    ),
    "Job-only vocabulary does not invent CV skills",
  );
  await page
    .getByRole("heading", { name: "Robin Fictional", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("option", { name: /Robin Fictional.*Awaiting review/ })
      .count(),
    1,
  );
  const picker = page.getByLabel("Candidate profile", { exact: true });
  assert.equal(await picker.isEnabled(), true);
  assert.equal(await picker.getByRole("option", { name: /Robin Fictional.*Awaiting review/ }).isEnabled(), true);
  await picker.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await picker.inputValue(), "profile-1");
  await page
    .getByRole("region", { name: "Awaiting review", exact: true })
    .getByRole("heading", { name: "Robin Fictional", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Review selected candidate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page
    .getByRole("button", { name: "Confirm reviewed profile", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Profile confirmed", exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  assert.equal(await picker.inputValue(), "profile-1", "Confirmation preserves selected candidate without refresh");
  await page.getByLabel("Job description", { exact: true }).fill(fixture.text);
  const analyzeResponse = responseFor("/api/v1/jobs/analyze");
  await page
    .getByRole("button", { name: "Analyze requirements", exact: true })
    .click();
  const analyzeHTTP = await analyzeResponse;
  assert.equal(analyzeHTTP.status(), 200);
  const analysis = await analyzeHTTP.json();
  for (const [key, expected] of Object.entries(fixture.expected_job))
    assert.equal(analysis.job[key], expected);
  assert.equal(
    analysis.requirements.length,
    fixture.expected_requirements.length,
  );
  for (const expected of fixture.expected_requirements) {
    const row = analysis.requirements.find(
      (item) => item.text === expected.evidence,
    );
    assert.ok(row, `Source clause ${expected.key} extracted`);
    assert.equal(row.origin, "technical_environment");
    assert.equal(row.classification, "unspecified");
    assert.deepEqual(
      row.technical_skills.map((skill) => skill.name).sort(),
      [...expected.skills].sort(),
    );
    row.evidence.forEach((evidence) => exactSource(fixture.text, evidence));
  }
  for (const evidence of Object.values(analysis.job.metadata_evidence).flat())
    exactSource(fixture.text, evidence);
  for (const [key, quote] of Object.entries(fixture.expected_metadata_evidence))
    assert.ok(
      analysis.job.metadata_evidence[key].some(
        (evidence) => evidence.quote === quote,
      ),
    );
  await page
    .getByRole("heading", { name: /^Technical environment mentions/ })
    .waitFor();
  await page
    .getByText("Technical environment extracted", { exact: true })
    .waitFor();
  await page
    .getByText(/No mandatory qualifications are explicitly stated/)
    .waitFor();
  const displayedMetadata = await page.locator(".job-summary").innerText();
  for (const value of ["Rabat/Technopolis", "CDI", "Hybrid"])
    assert.ok(
      displayedMetadata.includes(value),
      `${value} is displayed outside collapsed evidence`,
    );
  await page
    .getByText("Work mode source and schedule", { exact: true })
    .click();
  await page
    .locator(".job-summary blockquote")
    .filter({ hasText: fixture.expected_metadata_evidence.work_mode })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    true,
  );

  // Editing classification preserves environment provenance. A fabricated extra skill is rejected by the real API.
  const originalText = analysis.requirements[0].text;
  await page
    .getByLabel("Classification req-001", { exact: true })
    .selectOption("required");
  const environment = page.getByRole("region", {
    name: "Technical environment mentions",
    exact: true,
  });
  assert.equal(
    await environment
      .getByRole("article", { name: "Requirement req-001", exact: true })
      .count(),
    1,
  );
  await page
    .getByLabel("Requirement text req-001", { exact: true })
    .fill(`${originalText} / Rust`);
  await page
    .getByRole("checkbox", { name: /I reviewed the requirement wording/ })
    .check();
  const rejectedResponse = responseFor("/api/v1/jobs/compare");
  await page
    .getByRole("button", { name: "Compare evidence", exact: true })
    .click();
  const rejectedHTTP = await rejectedResponse;
  assert.equal(rejectedHTTP.status(), 422);
  assert.equal(
    (await rejectedHTTP.json()).detail.code,
    "unsupported_correction",
  );
  await page.getByRole("alert").waitFor();
  await page
    .getByLabel("Requirement text req-001", { exact: true })
    .fill(originalText);
  assert.equal(
    await page
      .getByRole("checkbox", { name: /I reviewed the requirement wording/ })
      .isChecked(),
    false,
  );
  await page
    .getByRole("checkbox", { name: /I reviewed the requirement wording/ })
    .check();
  const comparisonResponse = responseFor("/api/v1/jobs/compare");
  await page
    .getByRole("button", { name: "Compare evidence", exact: true })
    .click();
  const comparisonHTTP = await comparisonResponse;
  assert.equal(comparisonHTTP.status(), 200);
  const comparison = await comparisonHTTP.json();
  assert.ok(
    comparison.comparisons.every(
      (item) =>
        item.origin === "technical_environment" &&
        item.status === "needs_review",
    ),
  );
  assert.equal(comparison.comparisons[0].classification, "required");
  assert.equal(comparison.comparisons[0].job_evidence[0].quote, originalText);
  assert.equal(comparison.review_assertion, "unverified_client_assertion");
  const submitted = comparisonHTTP.request().postDataJSON();
  assert.equal("full_name" in submitted.candidate, false);
  assert.equal(
    JSON.stringify(submitted.candidate).includes("robin@example.com"),
    false,
  );
  await page
    .getByRole("heading", {
      name: "Requirement evidence checklist",
      exact: true,
    })
    .waitFor();
  await noOverflow();
  await screenshot("realistic-job-desktop");
  await page
    .getByRole("link", { name: "Revisit candidate profile", exact: true })
    .click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page
    .getByRole("heading", {
      name: "Requirement evidence checklist",
      exact: true,
    })
    .waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Reviewed requirements", exact: true })
    .click();
  await page
    .getByText("Work mode source and schedule", { exact: true })
    .click();
  const candidateBox = await page
    .getByLabel("Candidate profile", { exact: true })
    .boundingBox();
  const editorBox = await page
    .getByLabel("Requirement text req-001", { exact: true })
    .boundingBox();
  assert.ok(candidateBox.y < editorBox.y);
  await noOverflow();
  await screenshot("realistic-job-mobile");
  await page
    .getByRole("button", { name: "Source description", exact: true })
    .click();
  await page
    .getByLabel("Job description", { exact: true })
    .fill(fixture.text + "\nRequired Skills\nPython");
  assert.equal(
    await page
      .getByRole("button", { name: "Comparison results", exact: true })
      .count(),
    0,
  );
  await page.reload();
  await page
    .getByRole("heading", {
      name: "No candidates available",
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByLabel("Job description", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: realistic fictional AI post, six environment lists and distinct vocabulary, inline location/contract/hybrid schedule, exact Unicode evidence, confirmed review, source provenance on classification edits, unsupported correction 422/retry, environment-only needs_review, route retention, source invalidation, mobile layout and no storage.",
  );
} finally {
  await browser.close();
}
