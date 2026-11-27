import assert from "node:assert/strict";
import { chromium } from "playwright";

// Demo mode against the real local API: a fictional CV generated in the
// browser, mandatory human review, the sample job, and the side-by-side
// evidence view whose highlighted spans must match the API offsets exactly.
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(20000);
const pageErrors = [];
const externalRequests = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
page.on("request", (request) => {
  if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== new URL(base).origin) externalRequests.push(request.url());
});
const responseFor = (path) => page.waitForResponse((response) => new URL(response.url()).pathname === path && response.request().method() === "POST");
const codePoints = (text, start, end) => Array.from(text).slice(start, end).join("");

try {
  await page.goto(base);
  await page.getByRole("heading", { name: "A clearer view of talent.", exact: true }).waitFor();
  const parse = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Try with fictional data", exact: true }).click();
  const parsed = await parse;
  assert.equal(parsed.status(), 200);
  // Multipart file bodies are not exposed by Playwright; the unit test checks filename and consent.
  assert.match(await parsed.request().headerValue("content-type"), /^multipart\/form-data/);
  const profile = (await parsed.json()).candidate;
  assert.equal(profile.full_name, "Juno Fictional");
  assert.equal(profile.email, "juno.fictional@example.com");

  // Human review is still required.
  await page.getByRole("heading", { name: "Candidate profile", exact: true }).waitFor();
  await page.getByText(/Fictional CV parsed\. Review and confirm the profile/).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Profile confirmed", exact: true }).count(), 0);
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page.getByRole("region", { name: "Comparison availability", exact: true })
    .getByText("This candidate must be reviewed and confirmed before comparison.", { exact: true }).waitFor();
  const jobText = await page.getByLabel("Job description", { exact: true }).inputValue();
  assert.ok(jobText.startsWith("Fictional Data Analyst"), "The sample job post is prefilled");
  await page.getByRole("link", { name: "Review selected candidate", exact: true }).click();
  await page.getByRole("button", { name: "Review & correct profile", exact: true }).click();
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await page.getByRole("button", { name: "Confirm reviewed profile", exact: true }).click();
  await page.getByRole("heading", { name: "Profile confirmed", exact: true }).waitFor();

  await page.getByRole("link", { name: "Continue to Job Analysis", exact: true }).click();
  const analyze = responseFor("/api/v1/jobs/analyze");
  await page.getByRole("button", { name: "Analyze requirements", exact: true }).click();
  const analysis = await (await analyze).json();
  await page.getByRole("checkbox", { name: /I reviewed the requirement wording/ }).check();
  const compare = responseFor("/api/v1/jobs/compare");
  await page.getByRole("button", { name: "Compare evidence", exact: true }).click();
  const result = await (await compare).json();
  for (const key of ["score", "ranking", "match_percentage", "recommendation"]) assert.equal(key in result, false);

  // Side-by-side evidence: badges and highlighted spans come from exact offsets.
  const documented = result.comparisons.find((row) => row.status === "documented" && row.candidate_evidence.some((item) => item.excerpt));
  assert.ok(documented, "The demo produces at least one documented row with an excerpt");
  const card = page.getByRole("article", { name: `Comparison ${documented.requirement_id}`, exact: true });
  await card.getByRole("button", { name: `Expand evidence for ${documented.requirement_id}`, exact: true }).click();
  const pair = card.locator(".evidence-pair");
  await pair.waitFor();
  const jobSpan = documented.job_evidence[0];
  assert.equal(codePoints(analysis.job.text, jobSpan.start, jobSpan.end), jobSpan.quote);
  const jobDoc = pair.locator(".evidence-column.job .evidence-doc").first();
  assert.equal(await jobDoc.locator(".offset-badge").innerText(), `chars ${jobSpan.start}–${jobSpan.end}`);
  const hit = await jobDoc.locator("blockquote").evaluate((element) => {
    const copy = element.cloneNode(true);
    copy.querySelectorAll("small").forEach((child) => child.remove());
    return copy.textContent;
  });
  assert.equal(hit, jobSpan.quote, "Only the exact job span is highlighted");
  const excerpt = documented.candidate_evidence.find((item) => item.excerpt);
  const cvDoc = pair.locator(".evidence-column.cv .comparison-profile-evidence").filter({ hasText: excerpt.field }).first();
  assert.equal(await cvDoc.locator(".offset-badge").innerText(), `chars ${excerpt.excerpt.start}–${excerpt.excerpt.end}`);
  assert.equal(codePoints(excerpt.quote, excerpt.excerpt.start, excerpt.excerpt.end), excerpt.excerpt.quote);
  assert.ok(await pair.locator(".evidence-bridge-mark.documented").isVisible());

  // Absence stays neutral.
  const absent = result.comparisons.find((row) => row.status === "not_documented");
  if (absent) {
    const absentCard = page.getByRole("article", { name: `Comparison ${absent.requirement_id}`, exact: true });
    await absentCard.getByRole("button", { name: `Expand evidence for ${absent.requirement_id}`, exact: true }).click();
    await absentCard.locator(".evidence-absent").waitFor();
    assert.match(await absentCard.innerText(), /does not establish missing ability/);
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0]);
  assert.deepEqual(externalRequests, []);
  assert.deepEqual(pageErrors, []);
  console.log("PASS: demo mode generated a fictional CV, kept the human review gate, prefilled the sample job and showed exact side-by-side evidence spans, with no storage or external requests.");
} finally {
  await browser.close();
}
