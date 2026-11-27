import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

// The regression fixture is fictional and independent of the frozen Phase 4.3
// evaluation corpus. Exercise real PDF parsing and API calls, without mocks.
const fixture = JSON.parse(await readFile(
  process.env.FINAL_ACCURACY_FIXTURE_PATH ?? "/fixtures/job_final_accuracy.json",
  "utf8",
));
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
const jobPosts = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.method() === "POST" && /\/api\/v1\/jobs\/(analyze|compare)$/.test(request.url()))
    jobPosts.push(request.url());
});

const responseFor = (path) => page.waitForResponse(
  (response) => response.url().endsWith(path) && response.request().method() === "POST",
);
const picker = page.getByLabel("Candidate profile", { exact: true });
const overview = page.getByRole("region", { name: "Technical Evidence Overview", exact: true });
const requirements = page.getByRole("region", { name: "Requirement evidence", exact: true });
const acknowledgment = page.getByRole("checkbox", { name: /I reviewed the requirement wording/ });
const compareButton = page.getByRole("button", { name: "Compare evidence", exact: true });
const positiveName = "Alex Fictif";
const negativeName = "Sam Fictif";
const expectedTechnologies = ["Airflow", "GCP", "SQL", "Teradata"];

function exactSpan(source, evidence) {
  assert.ok(Number.isInteger(evidence.start) && evidence.start >= 0);
  assert.ok(Number.isInteger(evidence.end) && evidence.end > evidence.start);
  assert.equal(
    Array.from(source).slice(evidence.start, evidence.end).join(""),
    evidence.quote,
    "Source offsets count Unicode code points and preserve exact copied text",
  );
}
function profileField(profile, path) {
  return path.split(".").reduce((value, key) => value[key], profile);
}
function validateCandidateEvidence(evidence, candidate) {
  const full = profileField(candidate, evidence.field);
  assert.equal(evidence.unverified, true);
  assert.equal(evidence.quote, full, "Full evidence remains the exact reviewed field");
  if (evidence.excerpt) exactSpan(full, evidence.excerpt);
}
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
async function uniqueIds() {
  assert.deepEqual(await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((node) => node.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  }), []);
}
async function screenshot(name) {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}
async function createPdf(name, profile) {
  // A separate page avoids replacing the application's shared React session.
  // Bytes stay in memory; these are fictional profiles, never real candidate CVs.
  const sourcePage = await browser.newPage();
  try {
    const job = profile.experience[0];
    const lines = [
      `Name: ${name}`,
      `Email: ${name === positiveName ? "alex" : "sam"}@example.com`,
      "Phone: +1 202 555 0119",
      "Professional Experience",
      `${job.job_title} | Atelier Azur Fictif`,
      "2024 - 2025",
      ...job.description.split("\n").map((line) => `- ${line}`),
    ];
    if (profile.projects?.length) {
      lines.push("Academic Projects", "Atelier de démonstration");
      for (const project of profile.projects)
        lines.push(...project.description.split("\n").map((line) => `- ${line}`));
    }
    lines.push("Technical Skills", "SQL");
    await sourcePage.setContent('<html><body style="font-family:Arial;font-size:11px;line-height:1.6"><div id="cv-source" style="white-space:pre-line"></div></body></html>');
    await sourcePage.locator("#cv-source").evaluate((element, text) => {
      element.textContent = text;
    }, lines.join("\n"));
    return await sourcePage.pdf({ format: "A4" });
  } finally {
    await sourcePage.close();
  }
}
async function upload(name, profile, filename) {
  const pdf = await createPdf(name, profile);
  await page.locator("#cv-file").setInputFiles({
    name: filename, mimeType: "application/pdf", buffer: pdf,
  });
  const waiting = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const response = await waiting;
  assert.equal(response.status(), 200);
  const parsed = await response.json();
  assert.equal(parsed.candidate.experience.length, 1);
  assert.equal(parsed.candidate.experience[0].job_title, profile.experience[0].job_title);
  for (const line of profile.experience[0].description.split("\n"))
    assert.ok(parsed.candidate.experience[0].description.includes(line), `PDF retains ${line}`);
  assert.equal(parsed.candidate.projects.length, profile.projects?.length ?? 0);
  if (profile.projects?.length) {
    assert.ok(parsed.candidate.projects[0].description.includes("Apache Airflow"));
    assert.equal(parsed.candidate.experience[0].description.includes("Airflow"), false,
      "Academic project technologies do not become professional experience");
  }
  await page.getByRole("heading", { name, exact: true }).waitFor();
  assert.ok(parsed.parsing_metadata.warnings.length, "Partial extraction still requires human review");
  return parsed;
}
async function confirmSelected() {
  await page.getByRole("link", { name: "Review selected candidate", exact: true }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  const confirm = page.getByRole("button", { name: "Confirm reviewed profile", exact: true });
  assert.equal(await confirm.isDisabled(), true);
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await confirm.click();
  await page.getByRole("heading", { name: "Profile confirmed", exact: true }).waitFor();
  await page.getByRole("link", { name: "Continue to Job Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
}
async function compare() {
  const waiting = responseFor("/api/v1/jobs/compare");
  await compareButton.click();
  const response = await waiting;
  assert.equal(response.status(), 200);
  const result = await response.json();
  const payload = response.request().postDataJSON();
  assert.deepEqual(Object.keys(payload.candidate).sort(), [
    "certifications", "education", "experience", "languages", "projects", "technical_skills",
  ]);
  assert.equal(payload.review.candidate_confirmed, true);
  assert.equal(payload.review.requirements_reviewed, true);
  assert.deepEqual(payload.review.candidate_snapshot, payload.candidate);
  assert.deepEqual(payload.review.requirement_snapshot, payload.requirements);
  for (const value of [positiveName, negativeName, "alex@example.com", "sam@example.com", "+1 202 555 0119", "Atelier Azur Fictif", "2024", "2025"])
    assert.equal(JSON.stringify(payload.candidate).includes(value), false,
      `Qualification-only payload excludes ${value}`);
  for (const collection of [payload.candidate.experience, payload.candidate.projects])
    for (const entry of collection)
      for (const field of ["company", "location", "start_date", "end_date", "github_url"])
        assert.equal(field in entry, false);
  assert.equal(result.review_assertion, "unverified_client_assertion");
  assert.equal(result.comparisons.length, 6);
  for (const row of [...result.comparisons, ...result.technical_evidence])
    for (const evidence of row.candidate_evidence)
      validateCandidateEvidence(evidence, payload.candidate);
  for (const row of result.comparisons)
    for (const evidence of row.job_evidence) exactSpan(fixture.copied_job, evidence);
  for (const technology of result.technical_evidence)
    for (const reference of technology.job_references)
      for (const evidence of reference.evidence) exactSpan(fixture.copied_job, evidence);
  assert.deepEqual(result.technical_evidence.map((item) => item.name).sort(), expectedTechnologies);
  await overview.waitFor();
  await uniqueIds();
  return { result, payload };
}
async function inspectEvidence(container, evidence) {
  let found;
  for (const block of await container.locator(".comparison-profile-evidence").all()) {
    const quote = await block.locator("blockquote").evaluate((element) => {
      const copy = element.cloneNode(true);
      copy.querySelectorAll("small").forEach((child) => child.remove());
      return copy.textContent.trim();
    });
    if (quote === (evidence.excerpt?.quote ?? evidence.quote).trim() &&
      (await block.innerText()).includes(evidence.field)) {
      found = block;
      break;
    }
  }
  assert.ok(found, `Exact concise excerpt is rendered for ${evidence.field}`);
  if (evidence.excerpt && evidence.excerpt.quote !== evidence.quote) {
    const original = found.locator("[data-full-source]");
    assert.equal(await original.isVisible(), false);
    await found.getByText("View full reviewed field", { exact: true }).click();
    assert.equal(await original.isVisible(), true);
    assert.equal(await original.textContent(), evidence.quote);
    await found.getByText("View full reviewed field", { exact: true }).click();
    assert.equal(await original.isVisible(), false);
  }
}
async function openCard(id) {
  const card = requirements.getByRole("article", { name: `Comparison ${id}`, exact: true });
  await card.getByRole("button", { name: `Expand evidence for ${id}`, exact: true }).click();
  return card;
}
function byId(result, id) {
  const row = result.comparisons.find((item) => item.requirement_id === id);
  assert.ok(row);
  return row;
}
async function technologyGroups(bothNames) {
  assert.deepEqual((await overview.getByRole("region", {
    name: "Mentioned in both documents", exact: true,
  }).locator(".comparison-technology-name").allTextContents()).sort(), bothNames);
  assert.deepEqual((await overview.getByRole("region", {
    name: "No supporting mention found in the reviewed CV", exact: true,
  }).locator(".comparison-technology-name").allTextContents()).sort(),
  expectedTechnologies.filter((name) => !bothNames.includes(name)));
}

try {
  assert.ok(fixture.copied_job.includes("\\\n"), "Copied literal backslashes are in the source");
  await page.goto(`${base}/parser`);
  await upload(positiveName, fixture.candidate_with_business_evidence, "fictional-final-positive.pdf");
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  assert.equal(await picker.getByRole("option", { name: /Alex Fictif.*Awaiting review/ }).isEnabled(), true);
  await picker.selectOption("profile-1");
  assert.equal(await picker.inputValue(), "profile-1");
  await page.getByRole("region", { name: "Comparison availability", exact: true })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true }).waitFor();
  assert.equal(jobPosts.length, 0);
  await confirmSelected();
  assert.equal(await picker.inputValue(), "profile-1", "Selection survives confirmation and route return");
  assert.equal(await picker.getByRole("option", { name: /Alex Fictif.*Confirmed review/ }).isEnabled(), true);

  await page.getByLabel("Job description", { exact: true }).fill(fixture.copied_job);
  const analyzing = responseFor("/api/v1/jobs/analyze");
  await page.getByRole("button", { name: "Analyze requirements", exact: true }).click();
  const response = await analyzing;
  assert.equal(response.status(), 200);
  const analysis = await response.json();
  assert.equal(analysis.job.text, fixture.copied_job, "Source is not globally sanitized");
  assert.equal(analysis.requirements.length, 6, "Six real qualification bullets have no phantom seventh row");
  assert.deepEqual(analysis.requirements.map((item) => item.id), ["req-001", "req-002", "req-003", "req-004", "req-005", "req-006"]);
  for (const requirement of analysis.requirements) {
    assert.match(requirement.text, /[\p{L}\p{N}]/u);
    for (const evidence of requirement.evidence) exactSpan(fixture.copied_job, evidence);
  }
  assert.equal(analysis.requirements[0].classification, "required");
  assert.equal(analysis.requirements[4].classification, "preferred");
  assert.deepEqual([...new Set(analysis.requirements.flatMap((item) => item.technical_skills.map((skill) => skill.name)))].sort(), expectedTechnologies);
  assert.equal(await page.getByRole("article", { name: /^Requirement req-/ }).count(), 6);
  assert.equal(await page.getByLabel("Classification req-001", { exact: true }).inputValue(), "required");
  assert.equal(await page.getByLabel("Classification req-005", { exact: true }).inputValue(), "preferred");
  assert.equal(await page.locator("#comparison-availability").count(), 1);
  await uniqueIds();
  assert.equal(await acknowledgment.isChecked(), false);
  assert.equal(await compareButton.isDisabled(), true);
  await page.getByRole("region", { name: "Comparison availability", exact: true })
    .getByText(/Check the job requirement review acknowledgment/).waitFor();
  await acknowledgment.check();
  assert.equal(await acknowledgment.isChecked(), true);
  assert.equal(await compareButton.isEnabled(), true);

  const positive = await compare();
  const business = byId(positive.result, "req-002");
  const sql = byId(positive.result, "req-003");
  assert.equal(byId(positive.result, "req-001").classification, "required");
  assert.equal(byId(positive.result, "req-001").status, "needs_review",
    "An internship title does not establish five years or role equivalence");
  assert.equal(business.status, "needs_review", "Business task mentions do not establish mastery");
  assert.equal(sql.status, "needs_review", "SQL mention does not establish advanced mastery");
  assert.equal(byId(positive.result, "req-004").status, "needs_review");
  assert.equal(byId(positive.result, "req-005").classification, "preferred");
  assert.deepEqual(byId(positive.result, "req-005").candidate_evidence, []);
  assert.ok(business.candidate_evidence.length > 0);
  assert.ok(business.candidate_evidence.some((item) => (item.excerpt?.quote ?? item.quote).includes("Recueil de besoins")));
  assert.ok(business.candidate_evidence.some((item) => (item.excerpt?.quote ?? item.quote).includes("spécifications fonctionnelles")));
  for (const evidence of business.candidate_evidence) {
    assert.equal(evidence.field, "experience.0.description");
    assert.ok(evidence.excerpt, "Relevant BA bullets are shorter than the entire experience field");
    assert.equal(evidence.excerpt.quote.includes("Requêtes SQL"), false);
    assert.equal(evidence.excerpt.quote.includes("Présentation"), false);
  }
  await technologyGroups(["Airflow", "SQL"]);
  assert.ok(positive.result.technical_evidence.find((item) => item.name === "Airflow")
    .candidate_evidence.every((item) => item.field.startsWith("projects.")),
  "Airflow academic evidence remains a project citation");
  const evidence = business.candidate_evidence[0];
  const beforeInspection = jobPosts.length;
  assert.equal(await requirements.locator(".comparison-expanded-evidence").count(), 0);
  await noOverflow();
  await screenshot("final-job-accuracy-desktop");
  const businessCard = await openCard(business.requirement_id);
  await inspectEvidence(businessCard, evidence);
  await businessCard.getByText(business.explanation, { exact: true }).waitFor();
  await screenshot("final-job-accuracy-expanded");

  // The full original pasted source and review acknowledgment survive tab and
  // route navigation without a refresh or an additional analysis request.
  await page.getByRole("button", { name: "Source description", exact: true }).click();
  assert.equal(await page.getByLabel("Job description", { exact: true }).inputValue(), fixture.copied_job);
  await page.getByRole("button", { name: "Reviewed requirements", exact: true }).click();
  assert.equal(await acknowledgment.isChecked(), true);
  await page.getByRole("button", { name: "Comparison results", exact: true }).click();
  await page.getByRole("link", { name: "Candidates", exact: true }).click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await overview.waitFor();
  assert.equal(await picker.inputValue(), "profile-1");
  assert.equal(jobPosts.length, beforeInspection);

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  const mobileBusiness = await openCard(business.requirement_id);
  await inspectEvidence(mobileBusiness, evidence);
  await noOverflow();
  await screenshot("final-job-accuracy-mobile");
  assert.equal(jobPosts.length, beforeInspection);
  await uniqueIds();

  // A second independently parsed CV genuinely lacks all BA statements. Selecting
  // its unconfirmed profile must revoke the previous comparison, never reuse it.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("link", { name: "CV Parser", exact: true }).click();
  await upload(negativeName, fixture.candidate_without_business_evidence, "fictional-final-negative.pdf");
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  assert.equal(await picker.getByRole("option", { name: /Sam Fictif.*Awaiting review/ }).isEnabled(), true);
  await picker.selectOption("profile-2");
  assert.equal(await picker.inputValue(), "profile-2");
  assert.equal(await overview.count(), 0);
  assert.equal(await compareButton.isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Comparison results", exact: true }).isDisabled(), true);
  await page.getByRole("region", { name: "Comparison availability", exact: true })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true }).waitFor();
  assert.equal(jobPosts.length, beforeInspection);
  await confirmSelected();
  assert.equal(await picker.inputValue(), "profile-2");
  assert.equal(await picker.getByRole("option", { name: /Sam Fictif.*Confirmed review/ }).isEnabled(), true);
  await acknowledgment.check();
  assert.equal(await compareButton.isEnabled(), true);
  const negative = await compare();
  const negativeBusiness = byId(negative.result, "req-002");
  assert.deepEqual(negativeBusiness.candidate_evidence, [],
    "Dashboards, meetings and VoIP are not invented BA evidence");
  assert.equal(negativeBusiness.status, "needs_review");
  assert.deepEqual(byId(negative.result, "req-005").candidate_evidence, [],
    "VoIP does not establish telecommunications-sector experience");
  assert.equal(byId(negative.result, "req-003").status, "needs_review");
  await technologyGroups(["SQL"]);
  const negativeCard = await openCard(negativeBusiness.requirement_id);
  await negativeCard.getByText(/No supporting profile excerpt returned/).waitFor();
  assert.equal(await negativeCard.locator(".comparison-profile-evidence").count(), 0);
  await noOverflow();

  // Saving changed qualification text removes confirmation and stale results.
  const postsBeforeEdit = jobPosts.length;
  await page.getByRole("link", { name: "Revisit candidate profile", exact: true }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  const description = page.getByLabel("Description", { exact: true }).first();
  await description.fill(`${await description.inputValue()}\nRédaction de notes de démonstration.`);
  await page.getByRole("button", { name: "Save corrections", exact: true }).click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  assert.equal(await picker.inputValue(), "profile-2");
  assert.equal(await overview.count(), 0);
  assert.equal(await compareButton.isDisabled(), true);
  await page.getByRole("region", { name: "Comparison availability", exact: true })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true }).waitFor();
  assert.equal(jobPosts.length, postsBeforeEdit);
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: real fictional positive/negative PDFs → review and confirm → select → copied French job with literal backslashes → six meaningful rows → minimum-five-years required/telecom preferred → requirement review → comparison → source-bound BA evidence only when present; SQL/Airflow vs neutral GCP/Teradata, no mastery/duration/industry inference, exact code-point offsets and expandable full fields, desktop/mobile, route/session retention, unreviewed gating, qualification-only privacy and stale-result invalidation.");
} finally {
  await browser.close();
}
