import assert from "node:assert/strict";
import { chromium } from "playwright";
import { selectNativeOptionByMouse, startNativeDisplay } from "./native-select.mjs";

const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const stopDisplay = process.env.NATIVE_MOUSE ? await startNativeDisplay() : () => {};
const browser = await chromium.launch({ headless: !process.env.NATIVE_MOUSE });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
let comparisonRequests = 0;
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    request.method() === "POST" &&
    request.url().endsWith("/api/v1/jobs/compare")
  )
    comparisonRequests++;
});
const responseFor = (path) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith(path) && response.request().method() === "POST",
  );
const description =
  "Job title: Fictional API Developer\nTechnical environment\nPython, FastAPI, Docker, PostgreSQL";
const oversized = [
  "Python",
  "FastAPI",
  ...Array.from({ length: 99 }, (_, index) => `fictional${index}`),
];
async function confirm() {
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page
    .getByRole("button", { name: "Confirm reviewed profile", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Profile confirmed", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Continue to Job Analysis", exact: true })
    .click();
}
async function compare() {
  const waiting = responseFor("/api/v1/jobs/compare");
  await page
    .getByRole("button", { name: "Compare evidence", exact: true })
    .click();
  const response = await waiting;
  assert.equal(response.status(), 200);
  const result = await response.json();
  assert.ok(
    result.comparisons.every(
      (item) =>
        item.origin === "technical_environment" &&
        item.classification === "unspecified" &&
        item.status === "needs_review",
    ),
  );
  assert.equal(result.review_assertion, "unverified_client_assertion");
  const payload = response.request().postDataJSON();
  assert.equal("full_name" in payload.candidate, false);
  assert.equal("email" in payload.candidate, false);
  assert.equal("company" in payload.candidate.experience[0], false);
  assert.deepEqual(payload.candidate, payload.review.candidate_snapshot);
  await page
    .getByRole("heading", {
      name: "Requirement evidence checklist",
      exact: true,
    })
    .waitFor();
  return payload;
}

try {
  await page.setContent(`<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Jordan Fictional
Email: jordan@example.com
Technical Skills
Python, FastAPI
Experience
Job title: Python Developer
Company: Invented Example Studio
Description: Built fictional Python services.
Technologies: Python, FastAPI</div></body></html>`);
  const pdf = await page.pdf({ format: "A4" });
  await page.goto(`${base}/parser`);
  await page.locator("#cv-file").setInputFiles({
    name: "fictional-comparison-workflow.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  const parsed = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  assert.equal((await parsed).status(), 200);
  await page
    .getByRole("heading", { name: "Jordan Fictional", exact: true })
    .waitFor();

  // A second unconfirmed profile keeps a real mixed list after the first is confirmed.
  const peerPage = await browser.newPage();
  await peerPage.setContent('<html><body style="font-family:Arial;font-size:13px"><div style="white-space:pre-line">Name: Casey Fictional\nEmail: casey@example.com\nTechnical Skills\nPython, Git\nExperience\nJob title: Developer\nCompany: Invented Peer Studio\nDescription: Built fictional Python examples.</div></body></html>');
  const peerPdf = await peerPage.pdf({ format: "A4" });
  await peerPage.close();
  await page.getByRole("button", { name: "Upload another CV", exact: true }).click();
  await page.locator("#cv-file").setInputFiles({ name: "fictional-awaiting-peer.pdf", mimeType: "application/pdf", buffer: peerPdf });
  const peerParsed = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  assert.equal((await peerParsed).status(), 200);
  await page.getByRole("heading", { name: "Casey Fictional", exact: true }).waitFor();

  // Analyse before candidate review to exercise retention and immediate route updates.
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("option", { name: /Jordan Fictional.*Awaiting review/ })
      .count(),
    1,
  );
  assert.equal(
    await page.getByLabel("Candidate profile", { exact: true }).isDisabled(),
    false,
  );
  await page
    .getByText(
      "All session profiles are selectable. Selecting a profile does not confirm it or approve it for comparison.",
      { exact: true },
    )
    .waitFor();
  const awaitingProfiles = page.getByRole("region", { name: "Awaiting review", exact: true });
  assert.equal(await awaitingProfiles.getByRole("article").count(), 2);
  await awaitingProfiles.getByRole("link", { name: "Review profile: Casey Fictional", exact: true }).waitFor();
  const picker = page.getByLabel("Candidate profile", { exact: true });
  assert.equal(await picker.locator("option").count(), 3);
  for (const option of await picker.locator("option").all()) assert.equal(await option.isEnabled(), true);
  if (process.env.NATIVE_MOUSE) {
    await selectNativeOptionByMouse(page, picker, "profile-2");
    assert.equal(await page.getByRole("link", { name: "Review selected candidate", exact: true }).getAttribute("href"), "/candidates/profile-2");
    await selectNativeOptionByMouse(page, picker, "profile-1");
  } else {
    await picker.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    assert.equal(await picker.inputValue(), "profile-2");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
  }
  assert.equal(await picker.inputValue(), "profile-1");
  console.log("PASS: two awaiting profiles selectable using native mouse and independent keyboard changes");
  assert.equal(await page.getByRole("link", { name: "Review selected candidate", exact: true }).getAttribute("href"), "/candidates/profile-1");
  // Keyboard navigation independently changes the same native control and React selection.
  await picker.focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  assert.equal(await picker.inputValue(), "profile-2");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await picker.inputValue(), "profile-1");
  await page.getByLabel("Job description", { exact: true }).fill(description);
  const analyzed = responseFor("/api/v1/jobs/analyze");
  await page
    .getByRole("button", { name: "Analyze requirements", exact: true })
    .click();
  const analysis = await analyzed;
  assert.equal(analysis.status(), 200);
  assert.ok(
    (await analysis.json()).requirements.every(
      (item) =>
        item.classification === "unspecified" &&
        item.origin === "technical_environment",
    ),
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("region", { name: "Comparison availability" })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true })
    .waitFor();
  const initialJobAcknowledgment = page.getByRole("checkbox", { name: /I reviewed the requirement wording/ });
  await initialJobAcknowledgment.check();
  assert.equal(await page.getByRole("button", { name: "Compare evidence", exact: true }).isDisabled(), true, "Job review cannot authorize an unconfirmed profile");
  assert.equal(comparisonRequests, 0, "An awaiting profile never reaches the comparison API");
  await initialJobAcknowledgment.uncheck();
  await page
    .getByRole("link", {
      name: "Review selected candidate",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Confirm reviewed profile", exact: true })
      .isDisabled(),
    true,
  );
  await confirm();
  console.log("PASS: selected profile confirmed and returned without refresh");
  assert.equal(
    await page
      .getByRole("option", { name: /Jordan Fictional.*Confirmed review/ })
      .isDisabled(),
    false,
  );
  assert.equal(await picker.inputValue(), "profile-1", "Selection persists through review and confirmation");
  assert.equal(await picker.getByRole("option").count(), 3);
  assert.equal(await page.getByRole("option", { name: /Casey Fictional.*Awaiting review/ }).isEnabled(), true);
  assert.equal(await page.getByRole("region", { name: "Awaiting review", exact: true }).getByRole("article").count(), 1);
  const acknowledgment = page.getByRole("checkbox", {
    name: /I reviewed the requirement wording/,
  });
  const reviewGroup = page.getByRole("group", {
    name: "Job review and comparison",
    exact: true,
  });
  await reviewGroup.getByRole("region", { name: "Comparison availability" }).waitFor();
  await reviewGroup.getByRole("button", { name: "Compare evidence", exact: true }).waitFor();
  assert.equal(await acknowledgment.getAttribute("aria-describedby"), "job-requirements-confirmation-help");
  await page.getByText(/Confirming a candidate profile does not complete this job requirement review/).waitFor();
  assert.equal(await acknowledgment.isChecked(), false);
  await page
    .getByRole("region", { name: "Comparison availability" })
    .getByText(/Check the job requirement review acknowledgment/)
    .waitFor();
  await acknowledgment.check();
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    false,
  );
  await acknowledgment.uncheck();
  assert.equal(await page.getByRole("button", { name: "Compare evidence", exact: true }).isDisabled(), true);
  await reviewGroup.getByText(/Check the job requirement review acknowledgment/).waitFor();
  await acknowledgment.check();
  // Ordinary route changes preserve confirmation, selection and the job review.
  await page.getByRole("link", { name: "Candidates", exact: true }).click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  assert.equal(await page.getByLabel("Candidate profile", { exact: true }).inputValue(), "profile-1");
  assert.equal(await acknowledgment.isChecked(), true);
  assert.equal(await page.getByRole("button", { name: "Compare evidence", exact: true }).isDisabled(), false);
  await compare();
  console.log("PASS: environment-only comparison returned real API 200 with qualification-only payload");

  // Saving edits invalidates the result and requires confirmation; oversized data is retained, never truncated.
  await page
    .getByRole("link", { name: "Revisit candidate profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  await page
    .getByLabel("Technologies (comma separated)", { exact: true })
    .fill(oversized.join(", "));
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
  await page
    .getByRole("region", { name: "Comparison availability" })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("heading", {
        name: "Requirement evidence checklist",
        exact: true,
      })
      .count(),
    0,
  );
  await page
    .getByRole("link", { name: "Review selected candidate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  assert.equal(
    await page
      .getByLabel("Technologies (comma separated)", { exact: true })
      .inputValue(),
    oversized.join(", "),
  );
  await confirm();
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("region", { name: "Comparison availability" })
    .getByText(
      "Experience 1 lists 101 technologies. Comparison accepts at most 100; review the profile and remove extra entries.",
      { exact: true },
    )
    .waitFor();
  assert.equal(
    comparisonRequests,
    1,
    "The invalid profile never reaches the comparison API",
  );
  await page
    .getByRole("link", { name: "Review selected profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  await page
    .getByLabel("Technologies (comma separated)", { exact: true })
    .fill(oversized.slice(0, 100).join(", "));
  await confirm();
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    false,
  );
  const corrected = await compare();
  assert.equal(corrected.candidate.experience[0].technologies.length, 100);

  // An unchanged context-sensitive qualification used to produce a false unsupported-correction HTTP 422.
  await page
    .getByRole("button", { name: "Start new analysis", exact: true })
    .click();
  const contextual =
    "Job title: Fictional API Developer\nTechnical environment\napi / Python knowledge required\nAzure OpenAI";
  await page.getByLabel("Job description", { exact: true }).fill(contextual);
  const contextAnalysis = responseFor("/api/v1/jobs/analyze");
  await page
    .getByRole("button", { name: "Analyze requirements", exact: true })
    .click();
  assert.equal((await contextAnalysis).status(), 200);
  await page
    .getByRole("checkbox", { name: /I reviewed the requirement wording/ })
    .check();
  const contextComparison = responseFor("/api/v1/jobs/compare");
  await page
    .getByRole("button", { name: "Compare evidence", exact: true })
    .click();
  const contextHTTP = await contextComparison;
  assert.equal(contextHTTP.status(), 200);
  const contextResult = await contextHTTP.json();
  assert.equal(contextResult.comparisons[1].origin, "technical_environment");
  assert.equal(contextResult.comparisons[1].status, "needs_review");
  await page
    .getByRole("heading", {
      name: "Requirement evidence checklist",
      exact: true,
    })
    .waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real upload/review/confirmation/select without refresh, environment-only unspecified needs_review, exact blocked-step messages, profile-edit invalidation, 101-item preflight/correction/reconfirmation without truncation, privacy snapshots, former acronym-context 422 now 200, mobile and no storage.",
  );
} finally {
  await browser.close();
  stopDisplay();
}
