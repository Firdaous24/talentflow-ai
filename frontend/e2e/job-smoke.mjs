import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const description = `Job title: Backend Engineer
Company: Fictional Byte Workshop
Location: Remote
Employment type: Full-time
About Us
We use Java and MongoDB internally.
Responsibilities
Build dashboards with Tableau.
Required Skills
Python required
FastAPI required
SQL required
Experience
At least 3 years of Python development experience required
Preferred Qualifications
Docker preferred`;

function responseFor(path) {
  return page.waitForResponse(
    (response) =>
      response.url().endsWith(path) && response.request().method() === "POST",
  );
}
async function confirmProfile() {
  await page.getByRole("button", { name: "Review & correct profile" }).click();
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page.getByRole("button", { name: "Confirm reviewed profile" }).click();
  await page
    .getByRole("heading", { name: "Profile confirmed", exact: true })
    .waitFor();
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}
async function uniqueControls(availabilityCount = 1) {
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
  await page.locator("#comparison-availability").waitFor({
    state: availabilityCount ? "visible" : "hidden",
  });
  assert.deepEqual(
    await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
      return ids.filter((id, index) => ids.indexOf(id) !== index);
    }),
    [],
    "Every rendered control ID is unique",
  );
  assert.equal(await page.locator("#comparison-availability").count(), availabilityCount);
  assert.equal(await page.getByRole("region", { name: "Comparison availability", exact: true }).count(), availabilityCount);
}
async function screenshot(name) {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.screenshot({
    path: `${process.env.SCREENSHOT_DIR}/${name}.png`,
    fullPage: true,
  });
}

try {
  // All CV/job content is fictional. The generated PDF remains in browser memory.
  await page.setContent(`<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Morgan Fictional
Email: morgan@example.com
Phone: +1 202 555 0123
Technical Skills
Python, FastAPI, Git
Experience
Job title: Python Developer
Company: Invented Example Lab
Location: Fictional City
Start date: 2024
End date: Present
Description: Built fictional Python services.
Technologies: Python, FastAPI
Education
Degree: Bachelor
Institution: Fictional Computer College
Field of study: Computer Science
Start date: 2020
End date: 2024
Projects
Name: Fictional API
Description: A demonstration API.
Technologies: Python, FastAPI
Languages
English: Fluent</div></body></html>`);
  const pdf = await page.pdf({ format: "A4" });
  await page.goto(`${base}/parser`);
  await page.locator("#cv-file").setInputFiles({
    name: "fictional-job-candidate.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  const parsedResponse = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  assert.equal((await parsedResponse).status(), 200);
  await page
    .getByRole("heading", { name: "Morgan Fictional", exact: true })
    .waitFor();

  // Every profile is selectable; comparison still requires the existing human review.
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
  await uniqueControls();
  const picker = page.getByLabel("Candidate profile", { exact: true });
  assert.equal(await picker.isEnabled(), true);
  assert.equal(await picker.locator("option").count(), 2);
  assert.equal(
    await page
      .getByRole("option", { name: /Morgan Fictional.*Awaiting review/ })
      .count(),
    1,
  );
  assert.equal(await picker.getByRole("option", { name: /Morgan Fictional.*Awaiting review/ }).isEnabled(), true);
  await picker.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await picker.inputValue(), "profile-1");
  await page
    .getByRole("region", { name: "Awaiting review", exact: true })
    .getByRole("heading", { name: "Morgan Fictional", exact: true })
    .waitFor();
  await page
    .getByRole("link", {
      name: "Review selected candidate",
      exact: true,
    })
    .click();
  await confirmProfile();
  await page.getByRole("link", { name: "Continue to Job Analysis", exact: true }).click();
  assert.equal(await picker.isEnabled(), true);
  assert.equal(await picker.getByRole("option", { name: /Morgan Fictional.*Confirmed review/ }).isEnabled(), true);
  assert.equal(await page.getByRole("region", { name: "Awaiting review", exact: true }).count(), 0);
  assert.equal(await picker.inputValue(), "profile-1", "Selection survives profile confirmation");
  // Exercise native selection through keyboard events, not only selectOption().
  await picker.focus();
  await page.keyboard.press("Home");
  assert.equal(await picker.inputValue(), "");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await picker.inputValue(), "profile-1");
  await uniqueControls();
  await page.getByLabel("Job description", { exact: true }).fill(description);
  const analyzedResponse = responseFor("/api/v1/jobs/analyze");
  await page
    .getByRole("button", { name: "Analyze requirements", exact: true })
    .click();
  const analyzedHTTP = await analyzedResponse;
  assert.equal(analyzedHTTP.status(), 200);
  const analyzed = await analyzedHTTP.json();
  assert.equal(analyzed.job.title, "Backend Engineer");
  assert.deepEqual(analyzed.job.responsibilities, [
    "Build dashboards with Tableau.",
  ]);
  assert.equal(analyzed.requirements.length, 5);
  for (const item of analyzed.requirements) {
    for (const evidence of item.evidence) {
      assert.equal(
        Array.from(description).slice(evidence.start, evidence.end).join(""),
        evidence.quote,
      );
    }
  }
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    true,
  );
  await uniqueControls();

  // A human classification correction preserves the original extraction and clears confirmation.
  await page
    .getByRole("checkbox", { name: /I reviewed the requirement wording/ })
    .check();
  await page
    .getByLabel("Classification req-003", { exact: true })
    .selectOption("preferred");
  assert.equal(
    await page
      .getByRole("checkbox", { name: /I reviewed the requirement wording/ })
      .isChecked(),
    false,
  );
  const edited = page.getByRole("article", {
    name: "Requirement req-003",
    exact: true,
  });
  await edited.getByText("Human correction", { exact: true }).waitFor();
  await edited
    .getByText("Original: Required · Technical skill", { exact: true })
    .waitFor();
  await edited.getByText("Job source evidence", { exact: true }).click();
  await edited.getByText("SQL required", { exact: true }).last().waitFor();
  await page
    .getByRole("checkbox", { name: /I reviewed the requirement wording/ })
    .check();
  assert.equal(await page.getByRole("button", { name: "Compare evidence", exact: true }).isEnabled(), true);

  const comparedResponse = responseFor("/api/v1/jobs/compare");
  await page
    .getByRole("button", { name: "Compare evidence", exact: true })
    .click();
  const comparedHTTP = await comparedResponse;
  assert.equal(comparedHTTP.status(), 200);
  const compared = await comparedHTTP.json();
  const payload = comparedHTTP.request().postDataJSON();
  assert.deepEqual(Object.keys(payload.candidate).sort(), [
    "certifications",
    "education",
    "experience",
    "languages",
    "projects",
    "technical_skills",
  ]);
  assert.deepEqual(payload.candidate, payload.review.candidate_snapshot);
  assert.deepEqual(payload.requirements, payload.review.requirement_snapshot);
  for (const record of payload.candidate.experience) {
    for (const key of ["company", "location", "start_date", "end_date"])
      assert.equal(key in record, false);
  }
  for (const record of payload.candidate.education)
    assert.equal("institution" in record, false);
  assert.equal(
    JSON.stringify(payload.candidate).includes("morgan@example.com"),
    false,
  );
  assert.equal(compared.review_assertion, "unverified_client_assertion");
  assert.deepEqual(
    compared.comparisons.map((item) => item.status),
    [
      "documented",
      "documented",
      "not_documented",
      "needs_review",
      "not_documented",
    ],
  );
  assert.equal(compared.comparisons[2].classification, "preferred");
  assert.equal(compared.comparisons[2].job_evidence[0].quote, "SQL required");
  assert.equal(
    compared.comparisons.every((item) =>
      item.candidate_evidence.every((quote) => quote.unverified),
    ),
    true,
  );
  for (const key of [
    "score",
    "ranking",
    "fit_percentage",
    "eligible",
    "recommendation",
  ])
    assert.equal(key in compared, false);
  await page
    .getByRole("heading", {
      name: "Requirement evidence checklist",
      exact: true,
    })
    .waitFor();
  for (const title of [
    "Documented in profile",
    "Not documented in profile",
    "Needs human review",
  ])
    await page
      .getByRole("heading", { name: new RegExp(`^${title}`) })
      .waitFor();
  await uniqueControls(0);
  await noOverflow();
  await screenshot("job-analysis-desktop");
  await page
    .getByRole("button", { name: "Source description", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Job description", { exact: true }).inputValue(),
    description,
  );
  await uniqueControls();
  await page
    .getByRole("button", { name: "Comparison results", exact: true })
    .click();

  // Results survive navigation, then disappear when the reviewed candidate changes.
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
  await page
    .getByRole("link", { name: "Revisit candidate profile", exact: true })
    .click();
  await page.getByRole("button", { name: "Review & correct profile" }).click();
  await page
    .getByLabel("Description", { exact: true })
    .first()
    .fill("Built fictional Python demonstration services.");
  await page
    .getByRole("button", { name: "Save corrections", exact: true })
    .click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Comparison results", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("heading", {
        name: "Requirement evidence checklist",
        exact: true,
      })
      .count(),
    0,
  );

  // A second real French analysis excludes protected text and checks mobile wrapping.
  await page
    .getByRole("button", { name: "Start new analysis", exact: true })
    .click();
  await uniqueControls();
  const french =
    "Poste : Développeur outils\nEntreprise : Studio Fictif\nCompétences requises\nPython\nNationalité française requise\nHabiter dans un quartier précis\nAtouts\nPostgres";
  await page.getByLabel("Job description", { exact: true }).fill(french);
  const frenchResponse = responseFor("/api/v1/jobs/analyze");
  await page
    .getByRole("button", { name: "Analyze requirements", exact: true })
    .click();
  const frenchHTTP = await frenchResponse;
  assert.equal(frenchHTTP.status(), 200);
  const frenchResult = await frenchHTTP.json();
  assert.deepEqual(
    frenchResult.requirements.map((item) => item.text),
    ["Python", "Postgres"],
  );
  assert.deepEqual(
    frenchResult.requirements.map((item) => item.classification),
    ["required", "preferred"],
  );
  await page.getByLabel("Requirement text req-001", { exact: true }).waitFor();
  await uniqueControls();
  await page.setViewportSize({ width: 390, height: 844 });
  const candidateBox = await page
    .getByLabel("Candidate profile", { exact: true })
    .boundingBox();
  const requirementBox = await page
    .getByLabel("Requirement text req-001", { exact: true })
    .boundingBox();
  assert.ok(
    candidateBox.y < requirementBox.y,
    "Candidate selection appears before requirements on mobile",
  );
  await noOverflow();
  await screenshot("job-analysis-mobile");
  await page.reload();
  await page
    .getByRole("heading", {
      name: "No candidates available",
      exact: true,
    })
    .waitFor();
  await uniqueControls();
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
    "PASS: Upload CV -> select awaiting profile with keyboard -> Review -> Confirm -> preserved native selection -> Analyze job -> Review requirements -> Compare evidence -> Results; all-profile picker with comparison review gate, working review link, unique IDs/single availability, FR/EN source evidence, privacy snapshots, route retention, edit invalidation, desktop/mobile and no storage.",
  );
} finally {
  await browser.close();
}
