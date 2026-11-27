import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Fictional documents, actual local API and a genuine server-side LangGraph
// checkpoint. This test does not intercept, mock, or simulate graph execution.
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const pageErrors = [];
const graphPosts = [];
const externalRequests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error" && message.text().includes("TypeError"))
    pageErrors.push(message.text());
});
page.on("request", (request) => {
  if (request.method() === "POST" && request.url().includes("/api/v1/agents/workflows"))
    graphPosts.push(request);
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin)
    externalRequests.push(request.url());
});

const source = "Fictional Data Platform Engineer 😀\nTechnical Environment\nSQL / GCP / Apache Airflow";
const nodes = [
  "intake_validation", "candidate_preparation", "job_preparation",
  "evidence_comparison", "evidence_verification", "human_review", "final_report",
];
const startButton = page.getByRole("button", { name: "Start evidence workflow", exact: true });
const resumeButton = page.getByRole("button", { name: "Review & Resume", exact: true });
const reviewAck = page.getByRole("checkbox", { name: /I inspected the source evidence and acknowledge this local review assertion/ });
const responseFor = (path, method = "POST") => page.waitForResponse(
  (response) => new URL(response.url()).pathname === path && response.request().method() === method,
);

async function nav(name) {
  const link = page.getByRole("link", { name, exact: true });
  if (!(await link.isVisible())) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await link.click();
}
async function uniqueIdsAndLayout() {
  assert.deepEqual(await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map((element) => element.id);
    return ids.filter((id, index) => ids.indexOf(id) !== index);
  }), []);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
}
async function screenshot(name) {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${process.env.SCREENSHOT_DIR}/${name}.png`, fullPage: true });
}
async function createPdf() {
  const pdfPage = await browser.newPage();
  try {
    await pdfPage.setContent(`<html><body style="font-family:Arial;font-size:11px;line-height:1.7;white-space:pre-line">Name: Nora Fictive
Email: nora.fictive@example.com
Phone: +1 202 555 0119
Professional Experience
Developer | Fictional Orchard Labs
2023 - 2024
- Built SQL dashboards using Python.
Academic Projects
Orchestration demonstration
- Created an Apache Airflow pipeline for a fictional data project.
Technical Skills
SQL, Python</body></html>`);
    return await pdfPage.pdf({ format: "A4" });
  } finally { await pdfPage.close(); }
}
function assertMinimized(comparison) {
  assert.deepEqual(Object.keys(comparison.candidate).sort(), [
    "certifications", "education", "experience", "languages", "projects", "technical_skills",
  ]);
  assert.deepEqual(comparison.review.candidate_snapshot, comparison.candidate);
  assert.deepEqual(comparison.review.requirement_snapshot, comparison.requirements);
  assert.equal(comparison.review.candidate_confirmed, true);
  assert.equal(comparison.review.requirements_reviewed, true);
  const serialized = JSON.stringify(comparison.candidate);
  for (const value of ["Nora Fictive", "nora.fictive@example.com", "+1 202 555 0119", "Fictional Orchard Labs", "2023", "2024"])
    assert.equal(serialized.includes(value), false, `Graph qualification projection excludes ${value}`);
  for (const experience of comparison.candidate.experience)
    assert.deepEqual(Object.keys(experience).sort(), ["description", "job_title", "technologies"]);
}
function assertTrace(workflow, completed) {
  assert.deepEqual(workflow.steps.map((step) => step.node), nodes);
  assert.deepEqual(workflow.steps.map((step) => step.status), completed
    ? nodes.map(() => "completed")
    : ["completed", "completed", "completed", "completed", "completed", "waiting_for_review", "pending"]);
  assert.equal(workflow.human_review_status, completed ? "acknowledged" : "required");
  assert.equal(workflow.status, completed ? "completed" : "waiting_for_review");
  assert.equal(workflow.review_assertion, "unverified_client_assertion");
  const inspect = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(["score", "ranking", "match_percentage", "hiring_recommendation", "eligibility", "suitability_score"].includes(key), false);
      inspect(child);
    }
  };
  inspect(workflow);
}
function validateEvidence(workflow, comparison) {
  const result = workflow.comparison;
  assert.ok(result?.comparisons.length);
  assert.ok(result.comparisons.every((row) => row.origin === "technical_environment" && row.status === "needs_review"));
  const technologies = new Map(result.technical_evidence.map((item) => [item.name, item]));
  assert.deepEqual([...technologies.keys()].sort(), ["Airflow", "GCP", "SQL"]);
  assert.ok(technologies.get("SQL").candidate_evidence.length);
  assert.ok(technologies.get("Airflow").candidate_evidence.length);
  assert.deepEqual(technologies.get("GCP").candidate_evidence, []);
  for (const item of result.technical_evidence) {
    assert.equal(item.requires_interpretation, true);
    for (const reference of item.job_references) {
      assert.equal(reference.origin, "technical_environment");
      assert.equal(reference.classification, "unspecified");
      for (const span of reference.evidence)
        assert.equal(Array.from(source).slice(span.start, span.end).join(""), span.quote);
    }
    for (const evidence of item.candidate_evidence) {
      const field = evidence.field.split(".").reduce((value, key) => value[key], comparison.candidate);
      assert.equal(evidence.quote, field);
      assert.equal(evidence.unverified, true);
      if (evidence.excerpt)
        assert.equal(Array.from(field).slice(evidence.excerpt.start, evidence.excerpt.end).join(""), evidence.excerpt.quote);
    }
  }
  assert.ok(technologies.get("Airflow").candidate_evidence.every((item) => item.field.startsWith("projects.")),
    "The graph preserves academic project evidence and does not invent employment");
}
async function api(path, capability, method = "GET", data) {
  return page.request.fetch(`${base}${path}`, {
    method, data, headers: capability ? { "X-Workflow-Session": capability } : {},
  });
}
async function startWorkflow() {
  assert.equal(await startButton.isEnabled(), true);
  const pending = responseFor("/api/v1/agents/workflows");
  await startButton.click();
  const response = await pending;
  assert.equal(response.status(), 201, await response.text());
  assert.ok(response.headers()["cache-control"].split(/\s*,\s*/).every((value) => value === "no-store"),
    "The API and same-origin proxy both prohibit caching workflow evidence");
  const request = response.request();
  const capability = request.headers()["x-workflow-session"];
  assert.match(capability, /^[A-Za-z0-9_-]{43,128}$/);
  assert.equal(request.url().includes(capability), false);
  const payload = request.postDataJSON();
  assertMinimized(payload.comparison);
  const workflow = await response.json();
  assertTrace(workflow, false);
  validateEvidence(workflow, payload.comparison);
  assert.equal(JSON.stringify(workflow).includes(capability), false);
  await page.getByRole("heading", { name: "Evidence awaiting human review", exact: true }).waitFor();
  await page.getByRole("region", { name: "Execution timeline", exact: true }).waitFor();
  assert.equal(await resumeButton.isDisabled(), true);
  assert.equal(await reviewAck.isChecked(), false);
  await uniqueIdsAndLayout();
  return { workflow, payload, capability, path: `/api/v1/agents/workflows/${workflow.workflow_id}` };
}
async function inspectSources(workflow) {
  const sql = page.locator('details[aria-label="Technical evidence for SQL"]');
  await sql.locator("summary").first().click();
  assert.equal(await sql.locator(".comparison-technology-sources").isVisible(), true);
  const shown = await sql.locator(".comparison-profile-evidence blockquote").evaluateAll((elements) => elements.map((element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll("small").forEach((small) => small.remove());
    return copy.textContent.trim();
  }));
  const evidence = workflow.comparison.technical_evidence.find((item) => item.name === "SQL").candidate_evidence;
  assert.deepEqual(shown, evidence.map((item) => (item.excerpt?.quote ?? item.quote).trim()));
  assert.match(await sql.innerText(), /Source characters/);
  assert.match(await sql.innerText(), /Profile field:/);
  await sql.locator("summary").first().click();
  const row = workflow.comparison.comparisons[0];
  const card = page.getByRole("article", { name: `Comparison ${row.requirement_id}`, exact: true });
  await card.getByRole("button", { name: `Expand evidence for ${row.requirement_id}`, exact: true }).click();
  assert.equal(await card.locator(".comparison-expanded-evidence").isVisible(), true);
  assert.ok((await card.innerText()).includes(row.explanation));
  await card.getByRole("button", { name: `Collapse evidence for ${row.requirement_id}`, exact: true }).click();
}

try {
  await page.goto(`${base}/agents`);
  await page.getByRole("heading", { name: "AI Agents", exact: true }).waitFor();
  assert.equal(await startButton.isDisabled(), true);
  await page.getByRole("region", { name: "Workflow prerequisites", exact: true }).waitFor();
  assert.equal(graphPosts.length, 0);

  await nav("CV Parser");
  await page.locator("#cv-file").setInputFiles({ name: "fictional-langgraph.pdf", mimeType: "application/pdf", buffer: await createPdf() });
  const parsedResponse = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const parsed = await parsedResponse;
  assert.equal(parsed.status(), 200);
  const profile = (await parsed.json()).candidate;
  assert.equal(profile.full_name, "Nora Fictive");
  assert.equal(profile.experience.length, 1);
  assert.equal(profile.projects.length, 1);
  assert.equal(profile.experience[0].description.includes("Airflow"), false);
  assert.ok(profile.projects[0].description.includes("Airflow"));
  await page.getByRole("heading", { name: "Nora Fictive", exact: true }).waitFor();

  // Selection and route navigation never bypass the existing CV human gate.
  await nav("AI Agents");
  const candidate = page.getByLabel("Candidate for workflow", { exact: true });
  await candidate.selectOption("profile-1");
  assert.equal(await candidate.inputValue(), "profile-1");
  assert.equal(await startButton.isDisabled(), true);
  await page.getByRole("region", { name: "Workflow prerequisites", exact: true })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true }).waitFor();
  assert.equal(graphPosts.length, 0);
  await nav("Candidates");
  await page.getByRole("link", { name: /Nora Fictive/ }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Confirm reviewed profile", exact: true }).isDisabled(), true);
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page.getByRole("button", { name: "Confirm reviewed profile", exact: true }).click();
  await page.getByRole("heading", { name: "Profile confirmed", exact: true }).waitFor();
  await page.getByRole("link", { name: "Continue to Job Analysis", exact: true }).click();
  await page.getByLabel("Candidate profile", { exact: true }).selectOption("profile-1");
  await page.getByLabel("Job description", { exact: true }).fill(source);
  const analyzeResponse = responseFor("/api/v1/jobs/analyze");
  await page.getByRole("button", { name: "Analyze requirements", exact: true }).click();
  assert.equal((await analyzeResponse).status(), 200);
  await nav("AI Agents");
  assert.equal(await startButton.isDisabled(), true);
  await page.getByRole("region", { name: "Workflow prerequisites", exact: true })
    .getByText(/Check the job requirement review acknowledgment/).waitFor();
  await nav("Job Analysis");
  await page.getByRole("button", { name: "Reviewed requirements", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed the requirement wording/ }).check();
  await nav("AI Agents");
  assert.equal(await candidate.inputValue(), "profile-1", "Shared selection survives confirmation and route navigation");

  const first = await startWorkflow();
  await inspectSources(first.workflow);
  await screenshot("agents-review-desktop");
  const firstPosts = graphPosts.length;
  const checkpoint = await api(`${first.path}/review`, first.capability);
  assert.equal(checkpoint.status(), 200);
  assertTrace(await checkpoint.json(), false);
  assert.equal((await api(`${first.path}/report`, first.capability)).status(), 409,
    "A genuinely paused graph has no finalized report");
  assert.equal((await api(first.path)).status(), 401);
  assert.equal((await api(first.path, "x".repeat(64))).status(), 404,
    "Workflow IDs do not grant another local session access");
  const premature = await api(`${first.path}/resume`, first.capability, "POST", {
    acknowledged: false, request_revision: first.workflow.request_revision,
    snapshot_hash: first.workflow.snapshot_hash, comparison: first.payload.comparison,
  });
  assert.equal(premature.status(), 422, "Backend requires a literal explicit review acknowledgment");
  assertTrace(await (await api(first.path, first.capability)).json(), false);
  assert.equal(graphPosts.length, firstPosts, "API probes do not simulate UI execution");

  await page.getByRole("button", { name: "Refresh workflow status", exact: true }).click();
  await nav("Candidates");
  await nav("AI Agents");
  await page.getByRole("heading", { name: "Evidence awaiting human review", exact: true }).waitFor();
  assert.equal(graphPosts.length, firstPosts, "Inspection and route navigation do not reexecute nodes");
  assert.equal(await reviewAck.isChecked(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await uniqueIdsAndLayout();
  await screenshot("agents-review-mobile");
  await reviewAck.check();
  assert.equal(await resumeButton.isEnabled(), true);
  const resumedResponse = responseFor(`${first.path}/resume`);
  await resumeButton.click();
  const resumed = await resumedResponse;
  assert.equal(resumed.status(), 200, await resumed.text());
  const final = await resumed.json();
  assertTrace(final, true);
  validateEvidence(final, first.payload.comparison);
  assert.equal(final.workflow_id, first.workflow.workflow_id);
  assert.equal(final.snapshot_hash, first.workflow.snapshot_hash);
  assert.deepEqual(final.comparison, first.workflow.comparison,
    "Acknowledgment resumes the checkpoint without replacing verified evidence");
  await page.getByRole("heading", { name: "Final evidence report", exact: true }).waitFor();
  await uniqueIdsAndLayout();
  await screenshot("agents-final-mobile");
  const report = await api(`${first.path}/report`, first.capability);
  assert.equal(report.status(), 200);
  assert.deepEqual(await report.json(), final);
  assert.equal((await api(`${first.path}/review`, first.capability)).status(), 409);
  const duplicate = await api(`${first.path}/resume`, first.capability, "POST", resumed.request().postDataJSON());
  assert.equal(duplicate.status(), 409, "A repeated resume cannot execute the final node twice");
  const finalPosts = graphPosts.length;
  await page.getByRole("button", { name: "Refresh workflow status", exact: true }).click();
  await nav("Job Analysis");
  await nav("AI Agents");
  await page.getByRole("heading", { name: "Final evidence report", exact: true }).waitFor();
  assert.equal(graphPosts.length, finalPosts);

  // A source edit invalidates an old completed report immediately. A previous
  // acknowledgment cannot be used for this new source/review revision.
  await nav("Job Analysis");
  await page.getByRole("button", { name: "Source description", exact: true }).click();
  await page.getByLabel("Job description", { exact: true }).fill(`${source}\nPython`);
  await nav("AI Agents");
  assert.equal(await page.getByRole("heading", { name: "Final evidence report", exact: true }).count(), 0);
  await page.getByRole("alert").filter({ hasText: /candidate or reviewed job changed/ }).waitFor();
  assert.equal(await startButton.isDisabled(), true);
  assert.equal(graphPosts.length, finalPosts, "Editing source does not silently start a graph");

  // Restore and explicitly review the source, then test real cancellation.
  await nav("Job Analysis");
  const sourceTab = page.getByRole("button", { name: "Source description", exact: true });
  if (await sourceTab.count()) await sourceTab.click();
  await page.getByLabel("Job description", { exact: true }).fill(source);
  const reanalysis = responseFor("/api/v1/jobs/analyze");
  await page.getByRole("button", { name: "Analyze requirements", exact: true }).click();
  assert.equal((await reanalysis).status(), 200);
  await page.getByRole("checkbox", { name: /I reviewed the requirement wording/ }).check();
  await nav("AI Agents");
  const second = await startWorkflow();
  const cancelledResponse = responseFor(`${second.path}/cancel`);
  await page.getByRole("button", { name: "Cancel workflow", exact: true }).click();
  const cancelled = await cancelledResponse;
  assert.equal(cancelled.status(), 200);
  const cancellation = await cancelled.json();
  assert.equal(cancellation.status, "cancelled");
  assert.equal(cancellation.comparison, null);
  await page.getByRole("status").filter({ hasText: /^Workflow cancelled\./ }).waitFor();
  assert.equal((await api(`${second.path}/review`, second.capability)).status(), 410);
  assert.equal((await api(`${second.path}/report`, second.capability)).status(), 410);

  // Editing the candidate revokes its confirmation and cancels a paused graph.
  // The pending acknowledgment and exact source evidence must disappear together.
  const third = await startWorkflow();
  await reviewAck.check();
  await nav("Candidates");
  await page.getByRole("link", { name: /Nora Fictive/ }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  await page.locator('[id="review-profile-1-experience.0.description"]').fill("Built SQL dashboards using Python.\nCreated additional SQL views.");
  const invalidationCancel = responseFor(`${third.path}/cancel`);
  await page.getByRole("button", { name: "Save corrections", exact: true }).click();
  assert.equal((await invalidationCancel).status(), 200);
  await nav("AI Agents");
  assert.equal(await startButton.isDisabled(), true);
  assert.equal(await resumeButton.count(), 0);
  assert.equal(await page.getByRole("region", { name: "Pending evidence review", exact: true }).count(), 0);
  await page.getByRole("alert").filter({ hasText: /candidate or reviewed job changed/ }).waitFor();
  await page.getByRole("region", { name: "Workflow prerequisites", exact: true })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true }).waitFor();
  assert.equal((await api(`${third.path}/review`, third.capability)).status(), 410);
  const obsoleteResume = await api(`${third.path}/resume`, third.capability, "POST", {
    acknowledged: true, request_revision: third.workflow.request_revision,
    snapshot_hash: third.workflow.snapshot_hash, comparison: third.payload.comparison,
  });
  assert.equal(obsoleteResume.status(), 410, "An old acknowledgment cannot finalize an edited profile");

  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [], "No workflow or candidate localStorage persistence");
  assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), [], "Capability stays in React memory");
  assert.deepEqual(externalRequests, [], "No remote model or provider request occurs in the local workflow");
  assert.deepEqual(pageErrors, []);
  console.log("LangGraph Chromium workflow passed: actual PDF/review gates, environment semantics, capability isolation, real pending review, explicit interrupt/resume, final report, repeat safety, cancellation, candidate/source invalidation, desktop and 390px mobile.");
} catch (error) {
  if (pageErrors.length) console.error("Chromium page errors:", pageErrors);
  console.error("Visible error messages:", await page.getByRole("alert").allTextContents());
  throw error;
} finally { await browser.close(); }
