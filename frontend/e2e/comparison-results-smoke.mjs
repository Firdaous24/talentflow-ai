import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

const cases = JSON.parse(await readFile(process.env.JOB_FIXTURE_PATH ?? "/fixtures/jobs_realistic.json", "utf8")).cases;
const fixture = cases.find((entry) => entry.id === "ai_architect_fr");
assert.ok(fixture);
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
const jobPosts = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (request.method() === "POST" && /\/api\/v1\/jobs\/(analyze|compare)$/.test(request.url())) jobPosts.push(request.url());
});
const responseFor = (path) => page.waitForResponse((response) => response.url().endsWith(path) && response.request().method() === "POST");
const overview = page.getByRole("region", { name: "Technical Evidence Overview", exact: true });
const summary = page.getByRole("region", { name: "Comparison summary", exact: true });
const both = overview.getByRole("region", { name: "Mentioned in both documents", exact: true });
const without = overview.getByRole("region", { name: "No supporting mention found in the reviewed CV", exact: true });
const interpretation = overview.getByRole("region", { name: "Requires interpretation", exact: true });
const requirements = page.getByRole("region", { name: "Requirement evidence", exact: true });
const filters = requirements.getByRole("group", { name: "Filter comparison results", exact: true });
const cards = requirements.getByRole("article");
const projectDescription = "Built fictional GraphRAG and RAG prototypes using LLMs and AI Agents. Evaluated Machine Learning runs with MLflow.";

async function screenshot(name) {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
async function confirmProfile() {
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page.getByRole("button", { name: "Confirm reviewed profile", exact: true }).click();
  await page.getByRole("heading", { name: "Profile confirmed", exact: true }).waitFor();
  await page.getByRole("link", { name: "Continue to Job Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
}
async function compare() {
  const waiting = responseFor("/api/v1/jobs/compare");
  await page.getByRole("button", { name: "Compare evidence", exact: true }).click();
  const response = await waiting;
  assert.equal(response.status(), 200);
  const result = await response.json();
  const payload = response.request().postDataJSON();
  assert.deepEqual(Object.keys(payload.candidate).sort(), ["certifications", "education", "experience", "languages", "projects", "technical_skills"]);
  assert.deepEqual(payload.candidate, payload.review.candidate_snapshot);
  assert.deepEqual(payload.requirements, payload.review.requirement_snapshot);
  for (const value of ["devon@example.com", "Devon Fictional", "Imaginary Studio", "fictional.example.com"]) assert.equal(JSON.stringify(payload.candidate).includes(value), false);
  assert.equal(result.review_assertion, "unverified_client_assertion");
  await page.getByRole("heading", { name: "Requirement evidence checklist", exact: true }).waitFor();
  await overview.waitFor();
  return result;
}
async function assertCounts(result) {
  for (const status of ["documented", "not_documented", "needs_review"]) {
    const expected = result.comparisons.filter((item) => item.status === status).length;
    assert.equal(Number(await summary.locator(`.comparison-summary-item.${status} strong`).innerText()), expected);
  }
  const technologies = result.technical_evidence;
  assert.equal(technologies.length, new Set(technologies.map((item) => item.name)).size);
  assert.deepEqual((await both.locator(".comparison-technology-name").allTextContents()).sort(), technologies.filter((item) => item.candidate_evidence.length).map((item) => item.name).sort());
  assert.deepEqual((await without.locator(".comparison-technology-name").allTextContents()).sort(), technologies.filter((item) => !item.candidate_evidence.length).map((item) => item.name).sort());
  assert.equal(await interpretation.getByRole("link").count(), result.comparisons.length);
}
function technology(name) {
  return overview.locator(`details[aria-label="Technical evidence for ${name}"]`);
}
async function quotes(locator) {
  return locator.locator("blockquote").evaluateAll((blocks) => blocks.map((block) => {
    const copy = block.cloneNode(true);
    copy.querySelectorAll("small").forEach((element) => element.remove());
    return copy.textContent.trim();
  }));
}

try {
  // Only fictional content. PDF bytes remain in browser memory.
  await page.setContent(`<html><body style="font-family:Arial;font-size:12px"><div style="white-space:pre-line">Name: Devon Fictional
Email: devon@example.com
Technical Skills
Python, FastAPI
Experience
Job title: Python Developer
Company: Imaginary Studio
Description: Built fictional Python services.
Technologies: Python, FastAPI
Projects
Name: Fictional Knowledge Prototype
Description: ${projectDescription}
Technologies: Python, FastAPI
GitHub: https://github.com/fictional-example/prototype</div></body></html>`);
  const pdf = await page.pdf({ format: "A4" });
  await page.goto(`${base}/parser`);
  await page.locator("#cv-file").setInputFiles({ name: "fictional-technical-evidence.pdf", mimeType: "application/pdf", buffer: pdf });
  const parseWaiting = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const parsedResponse = await parseWaiting;
  assert.equal(parsedResponse.status(), 200);
  const parsed = await parsedResponse.json();
  assert.ok(parsed.candidate.projects.some((project) => project.description?.includes("GraphRAG")));
  await page.getByRole("heading", { name: "Devon Fictional", exact: true }).waitFor();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
  const picker = page.getByLabel("Candidate profile", { exact: true });
  assert.equal(await picker.getByRole("option", { name: /Devon Fictional.*Awaiting review/ }).isEnabled(), true);
  await picker.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await picker.inputValue(), "profile-1");
  await page.getByRole("link", { name: "Review selected candidate", exact: true }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  await confirmProfile();
  assert.equal(await picker.inputValue(), "profile-1");
  await page.getByLabel("Job description", { exact: true }).fill(fixture.text);
  const analysisWaiting = responseFor("/api/v1/jobs/analyze");
  await page.getByRole("button", { name: "Analyze requirements", exact: true }).click();
  const analysisResponse = await analysisWaiting;
  assert.equal(analysisResponse.status(), 200);
  const analysis = await analysisResponse.json();
  assert.equal(analysis.requirements.length, 6);
  assert.ok(analysis.requirements.every((item) => item.origin === "technical_environment" && item.classification === "unspecified"));
  await page.getByRole("checkbox", { name: /I reviewed the requirement wording/ }).check();
  const result = await compare();
  assert.equal(result.comparisons.length, 6);
  assert.ok(result.comparisons.every((item) => item.status === "needs_review" && item.origin === "technical_environment" && item.classification === "unspecified"));
  assert.equal(result.technical_evidence.length, 18);
  assert.deepEqual(result.technical_evidence.filter((item) => item.candidate_evidence.length).map((item) => item.name).sort(), ["AI Agents", "LLMs", "MLflow", "Machine Learning", "RAG"].sort());
  await assertCounts(result);
  await summary.getByText("These technologies describe the job's technical environment. Their presence does not establish mandatory candidate qualifications.", { exact: true }).waitFor();
  assert.equal(await overview.locator(".comparison-technology-name").count(), 18);
  for (const name of ["AI", "Azure", "Azure AI", "Azure OpenAI", "OpenAI", "MLOps", "API"]) assert.equal(result.technical_evidence.find((item) => item.name === name).candidate_evidence.length, 0, `${name} is not inferred from another technology`);
  assert.equal(result.technical_evidence.some((item) => item.name === "GraphRAG"), false, "CV-only GraphRAG is not invented as a job technology");

  // Exact source offsets and qualification-field references survive aggregation.
  for (const item of result.technical_evidence) {
    const keys = item.job_references.map((reference) => `${reference.requirement_id}:${reference.origin}:${reference.classification}`);
    assert.equal(keys.length, new Set(keys).size);
    for (const reference of item.job_references) {
      for (const evidence of reference.evidence) assert.equal(Array.from(analysis.job.text).slice(evidence.start, evidence.end).join(""), evidence.quote);
    }
    for (const evidence of item.candidate_evidence) assert.equal(evidence.unverified, true);
  }
  const ai = result.technical_evidence.find((item) => item.name === "AI");
  assert.equal(ai.job_references.length, 2);
  assert.equal(await technology("AI").count(), 1, "Repeated AI mentions aggregate to one technology");
  await technology("AI").locator("summary").click();
  assert.equal(await technology("AI").locator(".comparison-source-reference").count(), ai.job_references.length);
  assert.deepEqual((await quotes(technology("AI"))).sort(), ai.job_references.flatMap((reference) => reference.evidence.map((item) => item.quote)).sort());
  await technology("AI").locator("summary").click();
  const rag = result.technical_evidence.find((item) => item.name === "RAG");
  const ragDetails = technology("RAG");
  await ragDetails.locator(":scope > summary").focus();
  await page.keyboard.press("Enter");
  assert.equal(await ragDetails.evaluate((element) => element.open), true);
  assert.deepEqual((await quotes(ragDetails)).sort(), [...rag.job_references.flatMap((reference) => reference.evidence.map((item) => item.quote)), ...rag.candidate_evidence.map((item) => item.excerpt?.quote ?? item.quote)].sort());
  assert.ok((await ragDetails.innerText()).includes("Profile field: projects.0.description"));
  await page.keyboard.press("Enter");
  assert.equal(await ragDetails.evaluate((element) => element.open), false);

  const postsBeforeInspection = jobPosts.length;
  assert.equal(await cards.count(), result.comparisons.length);
  assert.equal(await requirements.locator(".comparison-expanded-evidence").count(), 0);
  await noOverflow();
  await screenshot("comparison-results-desktop");
  const first = result.comparisons[0];
  const firstCard = requirements.getByRole("article", { name: `Comparison ${first.requirement_id}`, exact: true });
  const expand = firstCard.getByRole("button", { name: `Expand evidence for ${first.requirement_id}`, exact: true });
  assert.equal(await expand.getAttribute("aria-expanded"), "false");
  await expand.focus();
  await page.keyboard.press("Enter");
  const firstEvidence = firstCard.getByRole("region", { name: `Evidence for ${first.requirement_id}`, exact: true });
  await firstEvidence.waitFor();
  assert.equal(await firstCard.getByRole("button", { name: `Collapse evidence for ${first.requirement_id}`, exact: true }).getAttribute("aria-expanded"), "true");
  assert.deepEqual((await quotes(firstEvidence)).sort(), [...first.job_evidence.map((item) => item.quote), ...first.candidate_evidence.map((item) => item.excerpt?.quote ?? item.quote)].sort());
  await screenshot("comparison-results-expanded");
  await requirements.getByRole("button", { name: "Expand all", exact: true }).click();
  assert.equal(await requirements.locator(".comparison-expanded-evidence").count(), result.comparisons.length);
  await requirements.getByRole("button", { name: "Collapse all", exact: true }).click();
  assert.equal(await requirements.locator(".comparison-expanded-evidence").count(), 0);
  for (const [label, status] of [["Documented", "documented"], ["Not documented", "not_documented"], ["Needs review", "needs_review"], ["All", null]]) {
    await filters.getByRole("button", { name: label, exact: true }).click();
    const count = status ? result.comparisons.filter((item) => item.status === status).length : result.comparisons.length;
    assert.equal(await cards.count(), count);
    assert.equal(await filters.getByRole("button", { name: label, exact: true }).getAttribute("aria-pressed"), "true");
    await requirements.getByText(`Showing ${count} of ${result.comparisons.length} clauses`, { exact: true }).waitFor();
  }
  await filters.getByRole("button", { name: "Documented", exact: true }).click();
  await interpretation.getByRole("link").first().click();
  assert.equal(await filters.getByRole("button", { name: "All", exact: true }).getAttribute("aria-pressed"), "true");
  await firstEvidence.waitFor();
  assert.equal(await firstCard.evaluate((element) => document.activeElement === element), true);
  await requirements.getByRole("button", { name: "Collapse all", exact: true }).click();
  assert.equal(jobPosts.length, postsBeforeInspection, "Filters, source disclosure and expansion perform no backend POSTs");

  // Tabs and routes retain the same source, review and comparison data.
  await page.getByRole("button", { name: "Source description", exact: true }).click();
  assert.equal(await page.getByLabel("Job description", { exact: true }).inputValue(), fixture.text);
  await page.getByRole("button", { name: "Reviewed requirements", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: /I reviewed the requirement wording/ }).isChecked(), true);
  await page.getByRole("button", { name: "Comparison results", exact: true }).click();
  await overview.waitFor();
  await assertCounts(result);
  await page.getByRole("link", { name: "Candidates", exact: true }).click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await overview.waitFor();
  assert.equal(await picker.inputValue(), "profile-1");
  await assertCounts(result);
  assert.equal(jobPosts.length, postsBeforeInspection);

  const context = page.getByText("Job context and source evidence", { exact: true });
  await context.click();
  assert.equal(await page.locator(".job-summary").isVisible(), true);
  await context.click();
  assert.equal(await page.locator(".job-summary").isVisible(), false);

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await filters.getByRole("button", { name: "Needs review", exact: true }).click();
  await requirements.getByRole("button", { name: "Expand all", exact: true }).click();
  await noOverflow();
  await requirements.getByRole("button", { name: "Collapse all", exact: true }).click();
  await filters.getByRole("button", { name: "All", exact: true }).click();
  await screenshot("comparison-results-mobile");
  assert.equal(jobPosts.length, postsBeforeInspection);

  // A GraphRAG-only correction must not fabricate separate RAG evidence.
  await page.getByRole("link", { name: "Revisit candidate profile", exact: true }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  await page.getByLabel("Description", { exact: true }).last().fill(projectDescription.replace("GraphRAG and RAG", "GraphRAG"));
  await page.getByLabel("Technologies (comma separated)", { exact: true }).last().fill("Python, FastAPI, GraphRAG, LLMs, AI Agents, Machine Learning, MLflow");
  await page.getByRole("button", { name: "Save corrections", exact: true }).click();
  await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page.getByRole("heading", { name: "Job Analysis", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Comparison results", exact: true }).isDisabled(), true);
  assert.equal(await overview.count(), 0);
  assert.equal(await page.getByRole("button", { name: "Compare evidence", exact: true }).isDisabled(), true);
  await page.getByRole("link", { name: "Review selected candidate", exact: true }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  await confirmProfile();
  await page.getByRole("checkbox", { name: /I reviewed the requirement wording/ }).check();
  const corrected = await compare();
  assert.equal(corrected.technical_evidence.find((item) => item.name === "RAG").candidate_evidence.length, 0, "GraphRAG alone does not count as RAG");
  assert.equal(corrected.technical_evidence.filter((item) => item.candidate_evidence.length).length, 4);
  await assertCounts(corrected);
  assert.equal(await without.locator('details[aria-label="Technical evidence for RAG"]').count(), 1);
  await noOverflow();

  // Source edits invalidate the result as well; no stale overview survives.
  await page.getByRole("button", { name: "Source description", exact: true }).click();
  await page.getByLabel("Job description", { exact: true }).fill(`${fixture.text}\nRequired Skills\nPython`);
  assert.equal(await page.getByRole("button", { name: "Comparison results", exact: true }).count(), 0);
  assert.equal(await overview.count(), 0);
  assert.equal(jobPosts.length, postsBeforeInspection + 1, "Only the explicit corrected comparison sent another POST");
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.deepEqual(errors, []);
  console.log("PASS: real fictional CV/review/FR job comparison, dynamic 0/0/6 summary, 18 canonical technologies with 5 shared/13 without CV evidence, aggregated exact provenance, no inferred name overlaps, accessible collapsed evidence/filters/interpretation links without extra API calls, route/tab retention, profile/source invalidation, GraphRAG-only correction, desktop/mobile and no storage.");
} finally {
  await browser.close();
}
