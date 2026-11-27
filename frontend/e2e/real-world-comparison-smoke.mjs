import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium } from "playwright";

// Static expected clauses are frozen independently of parser predictions.
const corpus = JSON.parse(
  await readFile(
    process.env.COMPARISON_FIXTURE_PATH ?? "/fixtures/comparison_accuracy.json",
    "utf8",
  ),
);
const fixture = corpus.cases.find((entry) => entry.id === "data_ba_fr");
assert.ok(fixture);
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(15000);
const errors = [];
const jobPosts = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    request.method() === "POST" &&
    /\/api\/v1\/jobs\/(analyze|compare)$/.test(request.url())
  )
    jobPosts.push(request.url());
});
const responseFor = (path) =>
  page.waitForResponse(
    (response) =>
      response.url().endsWith(path) && response.request().method() === "POST",
  );
const overview = page.getByRole("region", {
  name: "Technical Evidence Overview",
  exact: true,
});
const summary = page.getByRole("region", {
  name: "Comparison summary",
  exact: true,
});
const both = overview.getByRole("region", {
  name: "Mentioned in both documents",
  exact: true,
});
const without = overview.getByRole("region", {
  name: "No supporting mention found in the reviewed CV",
  exact: true,
});
const requirements = page.getByRole("region", {
  name: "Requirement evidence",
  exact: true,
});
const filters = requirements.getByRole("group", {
  name: "Filter comparison results",
  exact: true,
});
const businessDescription = fixture.profile.experience[0].description;
const candidateName = "Rowan Fictional";

function sourceField(candidate, path) {
  return path
    .split(".")
    .reduce(
      (value, key) => (Array.isArray(value) ? value[Number(key)] : value[key]),
      candidate,
    );
}
function exactSpan(text, evidence) {
  assert.equal(
    Array.from(text).slice(evidence.start, evidence.end).join(""),
    evidence.quote,
  );
}
function validateProfileEvidence(evidence, candidate) {
  assert.equal(evidence.unverified, true);
  const full = sourceField(candidate, evidence.field);
  assert.equal(
    evidence.quote,
    full,
    "The full quote remains the exact reviewed qualification field",
  );
  if (evidence.excerpt) exactSpan(full, evidence.excerpt);
}
async function noOverflow() {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
}
async function screenshot(name) {
  if (!process.env.SCREENSHOT_DIR) return;
  await mkdir(process.env.SCREENSHOT_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `${process.env.SCREENSHOT_DIR}/${name}.png`,
    fullPage: true,
  });
}
async function confirmProfile() {
  const confirmation = page.getByRole("button", {
    name: "Confirm reviewed profile",
    exact: true,
  });
  assert.equal(await confirmation.isDisabled(), true);
  await page.getByRole("checkbox", { name: /I reviewed the fields/ }).check();
  await confirmation.click();
  await page
    .getByRole("heading", { name: "Profile confirmed", exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: "Continue to Job Analysis", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Job Analysis", exact: true })
    .waitFor();
}
async function compare() {
  const waiting = responseFor("/api/v1/jobs/compare");
  await page
    .getByRole("button", { name: "Compare evidence", exact: true })
    .click();
  const response = await waiting;
  assert.equal(response.status(), 200);
  const result = await response.json();
  const payload = response.request().postDataJSON();
  assert.equal(result.review_assertion, "unverified_client_assertion");
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
  const submittedProfile = JSON.stringify(payload.candidate);
  for (const privateValue of [
    candidateName,
    "rowan@example.com",
    "+1 202 555 0101",
    "Fictional Platform",
    "Atelier Nacre Fictif",
    "2021",
    "2024",
  ])
    assert.equal(
      submittedProfile.includes(privateValue),
      false,
      `Qualification-only submission excludes ${privateValue}`,
    );
  for (const entry of [
    ...payload.candidate.experience,
    ...payload.candidate.projects,
  ]) {
    for (const key of [
      "company",
      "location",
      "start_date",
      "end_date",
      "github_url",
    ])
      assert.equal(key in entry, false);
  }
  await page
    .getByRole("heading", {
      name: "Requirement evidence checklist",
      exact: true,
    })
    .waitFor();
  await overview.waitFor();
  return { result, payload };
}
async function metricCounts(result) {
  for (const status of ["documented", "not_documented", "needs_review"])
    assert.equal(
      Number(
        await summary
          .locator(`.comparison-summary-item.${status} strong`)
          .innerText(),
      ),
      result.comparisons.filter((item) => item.status === status).length,
    );
}
async function excerptBlock(container, evidence) {
  for (const block of await container
    .locator(".comparison-profile-evidence")
    .all()) {
    const quote = await block.locator("blockquote").evaluate((element) => {
      const copy = element.cloneNode(true);
      copy.querySelectorAll("small").forEach((child) => child.remove());
      return copy.textContent.trim();
    });
    if (
      quote === (evidence.excerpt?.quote ?? evidence.quote).trim() &&
      (await block.innerText()).includes(evidence.field)
    )
      return block;
  }
  assert.fail(`No concise UI evidence block found for ${evidence.field}`);
}
async function inspectFullField(container, evidence) {
  const block = await excerptBlock(container, evidence);
  assert.ok((await block.innerText()).includes(evidence.field));
  if (evidence.excerpt && evidence.excerpt.quote !== evidence.quote) {
    const full = block.locator("[data-full-source]");
    assert.equal(await full.isVisible(), false);
    await block.getByText("View full reviewed field", { exact: true }).click();
    assert.equal(await full.isVisible(), true);
    assert.equal(await full.textContent(), evidence.quote);
    await block.getByText("View full reviewed field", { exact: true }).click();
    assert.equal(await full.isVisible(), false);
  }
  return block;
}

try {
  // Two distinct professional entries followed by academic work. Nothing here
  // comes from a real candidate; PDF bytes remain in memory throughout the run.
  const cvLines = [
    `Name: ${candidateName}`,
    "Email: rowan@example.com",
    "Phone: +1 202 555 0101",
    "Professional Experience",
    "Developer | Fictional Platform",
    "2021 - 2022",
    "- Built a fictional Python catalogue service.",
    "- Maintained fictional training documentation.",
    "Business Analyst | Atelier Nacre Fictif",
    "2022 - 2024",
    ...businessDescription.split("\n").map((line) => `- ${line}`),
    "Academic Projects",
    "Assistant de démonstration : Prototype RAG sur données fictives.",
    "Technologies: Python, RAG",
    "Technical Skills",
    "SQL, Python",
  ];
  await page.setContent(
    '<html><body style="font-family:Arial;font-size:11px;line-height:1.7"><div style="white-space:pre-line" id="cv-source"></div></body></html>',
  );
  await page.locator("#cv-source").evaluate((element, text) => {
    element.textContent = text;
  }, cvLines.join("\n"));
  const pdf = await page.pdf({ format: "A4" });
  await page.goto(`${base}/parser`);
  await page
    .locator("#cv-file")
    .setInputFiles({
      name: "fictional-phase43-data-ba.pdf",
      mimeType: "application/pdf",
      buffer: pdf,
    });
  const parsing = responseFor("/api/v1/candidates/parse");
  await page.getByRole("button", { name: "Parse CV", exact: true }).click();
  const parseResponse = await parsing;
  assert.equal(parseResponse.status(), 200);
  const parsed = await parseResponse.json();
  assert.equal(
    parsed.candidate.experience.length,
    2,
    "Business Analyst starts its own professional entry",
  );
  assert.equal(
    parsed.candidate.projects.length,
    1,
    "Academic Projects ends professional experience",
  );
  const [developer, business] = parsed.candidate.experience;
  assert.equal(developer.job_title, "Developer");
  assert.equal(business.job_title, "Business Analyst");
  assert.deepEqual(
    [
      developer.start_date,
      developer.end_date,
      business.start_date,
      business.end_date,
    ],
    ["2021", "2022", "2022", "2024"],
  );
  assert.equal(developer.company, "Fictional Platform");
  assert.equal(business.company, "Atelier Nacre Fictif");
  assert.equal(developer.description.includes("SQL"), false);
  assert.equal(business.description.includes("Python"), false);
  assert.ok(business.description.includes("Airflow"));
  for (const experience of parsed.candidate.experience)
    assert.equal(experience.description.includes("Prototype RAG"), false);
  assert.equal(parsed.candidate.projects[0].name, "Assistant de démonstration");
  assert.equal(
    parsed.candidate.projects[0].description.includes("Recueil"),
    false,
  );
  const professionalSources = parsed.parsing_metadata.evidence.filter((item) =>
    item.field.startsWith("experience."),
  );
  assert.ok(professionalSources.length);
  assert.ok(
    professionalSources.every((item) => !item.quote.includes("Prototype RAG")),
  );
  assert.ok(
    parsed.parsing_metadata.warnings.length,
    "Partial extraction and review warnings remain available",
  );

  await page
    .getByRole("heading", { name: candidateName, exact: true })
    .waitFor();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  const picker = page.getByLabel("Candidate profile", { exact: true });
  assert.equal(
    await picker
      .getByRole("option", { name: /Rowan Fictional.*Awaiting review/ })
      .isEnabled(),
    true,
  );
  await picker.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await picker.inputValue(), "profile-1");
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .count(),
    0,
    "Comparison action appears after job analysis; missing review remains explained",
  );
  await page
    .getByRole("region", { name: "Comparison availability", exact: true })
    .getByText(
      "This candidate must be reviewed and confirmed before comparison.",
      { exact: true },
    )
    .waitFor();
  assert.equal(jobPosts.length, 0);
  await page
    .getByRole("link", { name: "Review selected candidate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  assert.equal(await page.getByLabel("Position", { exact: true }).count(), 2);
  assert.ok(
    (
      await page.getByLabel("Description", { exact: true }).nth(1).inputValue()
    ).includes("Extraction SQL"),
  );
  await confirmProfile();
  assert.equal(
    await picker.inputValue(),
    "profile-1",
    "Selection and confirmation survive route navigation without refresh",
  );
  assert.equal(
    await picker
      .getByRole("option", { name: /Rowan Fictional.*Confirmed review/ })
      .isEnabled(),
    true,
  );
  await page
    .getByLabel("Job description", { exact: true })
    .fill(fixture.job_text);
  const analyzing = responseFor("/api/v1/jobs/analyze");
  await page
    .getByRole("button", { name: "Analyze requirements", exact: true })
    .click();
  const analysisResponse = await analyzing;
  assert.equal(analysisResponse.status(), 200);
  const analysis = await analysisResponse.json();
  assert.equal(analysis.requirements.length, fixture.requirements.length);
  assert.deepEqual(
    [
      ...new Set(
        analysis.requirements.flatMap((item) =>
          item.technical_skills.map((skill) => skill.name),
        ),
      ),
    ].sort(),
    ["Airflow", "GCP", "SQL", "Teradata"],
  );
  for (const expected of fixture.requirements) {
    const requirement = analysis.requirements.find(
      (item) => item.text === expected.quote,
    );
    assert.ok(requirement, `Frozen source clause ${expected.key} is retained`);
    // Phase 4.3.1 recognizes the explicit minimum threshold. The immutable
    // Phase 4.3 evaluation annotation remains unchanged and records this delta.
    assert.equal(requirement.classification, expected.key === "duration" ? "required" : expected.classification);
    assert.equal(requirement.origin, expected.origin);
    for (const evidence of requirement.evidence)
      exactSpan(fixture.job_text, evidence);
  }
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    true,
  );
  const acknowledgment = page.getByRole("checkbox", {
    name: /I reviewed the requirement wording/,
  });
  assert.equal(await acknowledgment.isChecked(), false);
  await acknowledgment.check();
  assert.equal(await acknowledgment.isChecked(), true);
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isEnabled(),
    true,
  );

  const { result, payload } = await compare();
  await metricCounts(result);
  const byKey = Object.fromEntries(
    fixture.requirements.map((expected) => [
      expected.key,
      result.comparisons.find(
        (item) => item.original_requirement_text === expected.quote,
      ),
    ]),
  );
  for (const expected of fixture.requirements) {
    const row = byKey[expected.key];
    assert.ok(row);
    // The frozen corpus deliberately retains its sector needs_review label.
    // Product policy keeps unsupported sector evidence not_documented; the
    // independent evaluator reports that disagreement without relabeling it.
    assert.equal(
      row.status,
      expected.key === "sector" ? "not_documented" : expected.status,
    );
    assert.equal(row.classification, expected.key === "duration" ? "required" : expected.classification);
    assert.equal(row.origin, expected.origin);
  }
  assert.equal(
    byKey.sql.status,
    "needs_review",
    "A SQL mention cannot verify advanced mastery",
  );
  assert.equal(
    byKey.duration.status,
    "needs_review",
    "No five-year professional total is invented",
  );
  assert.ok(
    byKey.duration.candidate_evidence.every((item) =>
      item.field.startsWith("experience."),
    ),
    "Academic projects are not professional-duration evidence",
  );
  assert.deepEqual(
    byKey.sector.candidate_evidence,
    [],
    "VoIP networking does not establish telecommunications-sector employment",
  );
  const technologies = result.technical_evidence;
  assert.deepEqual(technologies.map((item) => item.name).sort(), [
    "Airflow",
    "GCP",
    "SQL",
    "Teradata",
  ]);
  assert.equal(
    technologies.length,
    new Set(technologies.map((item) => item.name)).size,
  );
  assert.deepEqual(
    technologies
      .filter((item) => item.candidate_evidence.length)
      .map((item) => item.name)
      .sort(),
    ["Airflow", "SQL"],
  );
  assert.deepEqual(
    (
      await both.locator(".comparison-technology-name").allTextContents()
    ).sort(),
    ["Airflow", "SQL"],
  );
  assert.deepEqual(
    (
      await without.locator(".comparison-technology-name").allTextContents()
    ).sort(),
    ["GCP", "Teradata"],
  );
  for (const item of [...result.comparisons, ...technologies])
    for (const evidence of item.candidate_evidence)
      validateProfileEvidence(evidence, payload.candidate);
  for (const item of technologies)
    for (const reference of item.job_references)
      for (const evidence of reference.evidence)
        exactSpan(analysis.job.text, evidence);

  const sqlEvidence = byKey.sql.candidate_evidence.find(
    (item) => item.field === "experience.1.description",
  );
  assert.ok(sqlEvidence?.excerpt);
  assert.ok(sqlEvidence.excerpt.quote.includes("Extraction SQL"));
  assert.ok(sqlEvidence.excerpt.quote.length < sqlEvidence.quote.length);
  assert.equal(sqlEvidence.excerpt.quote.includes("VoIP"), false);
  const airflowEvidence = technologies
    .find((item) => item.name === "Airflow")
    .candidate_evidence.find(
      (item) => item.field === "experience.1.description",
    );
  assert.ok(airflowEvidence?.excerpt?.quote.includes("Airflow"));
  assert.equal(airflowEvidence.excerpt.quote.includes("Extraction SQL"), false);
  assert.ok(
    byKey.business.candidate_evidence.some((item) =>
      (item.excerpt?.quote ?? item.quote).includes("Recueil des besoins"),
    ),
  );
  assert.ok(
    byKey.business.candidate_evidence.every(
      (item) => !(item.excerpt?.quote ?? item.quote).includes("VoIP"),
    ),
  );

  const postsBeforeInspection = jobPosts.length;
  assert.equal(
    await requirements.locator(".comparison-expanded-evidence").count(),
    0,
  );
  await noOverflow();
  await screenshot("real-world-comparison-desktop");
  const sqlCard = requirements.getByRole("article", {
    name: `Comparison ${byKey.sql.requirement_id}`,
    exact: true,
  });
  await sqlCard
    .getByRole("button", {
      name: `Expand evidence for ${byKey.sql.requirement_id}`,
      exact: true,
    })
    .click();
  await inspectFullField(sqlCard, sqlEvidence);
  await sqlCard.getByText(byKey.sql.explanation, { exact: true }).waitFor();
  const airflowDetails = overview.locator(
    'details[aria-label="Technical evidence for Airflow"]',
  );
  await airflowDetails.locator("summary").first().click();
  await inspectFullField(airflowDetails, airflowEvidence);
  await airflowDetails.locator("summary").first().click();
  await screenshot("real-world-comparison-expanded");
  await requirements
    .getByRole("button", { name: "Expand all", exact: true })
    .click();
  assert.equal(
    await requirements.locator(".comparison-expanded-evidence").count(),
    result.comparisons.length,
  );
  await requirements
    .getByRole("button", { name: "Collapse all", exact: true })
    .click();
  for (const [label, status] of [
    ["Documented", "documented"],
    ["Not documented", "not_documented"],
    ["Needs review", "needs_review"],
    ["All", null],
  ]) {
    await filters.getByRole("button", { name: label, exact: true }).click();
    assert.equal(
      await requirements.getByRole("article").count(),
      status
        ? result.comparisons.filter((item) => item.status === status).length
        : result.comparisons.length,
    );
  }
  assert.equal(
    jobPosts.length,
    postsBeforeInspection,
    "Evidence disclosures and filters send no backend requests",
  );

  await page
    .getByRole("button", { name: "Source description", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Job description", { exact: true }).inputValue(),
    fixture.job_text,
  );
  await page
    .getByRole("button", { name: "Reviewed requirements", exact: true })
    .click();
  assert.equal(await acknowledgment.isChecked(), true);
  await page
    .getByRole("button", { name: "Comparison results", exact: true })
    .click();
  await page.getByRole("link", { name: "Candidates", exact: true }).click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await overview.waitFor();
  assert.equal(await picker.inputValue(), "profile-1");
  await metricCounts(result);
  assert.equal(jobPosts.length, postsBeforeInspection);

  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow();
  await requirements
    .getByRole("button", { name: "Expand all", exact: true })
    .click();
  await noOverflow();
  await inspectFullField(
    requirements.getByRole("article", {
      name: `Comparison ${byKey.sql.requirement_id}`,
      exact: true,
    }),
    sqlEvidence,
  );
  await requirements
    .getByRole("button", { name: "Collapse all", exact: true })
    .click();
  await filters
    .getByRole("button", { name: "Needs review", exact: true })
    .click();
  await screenshot("real-world-comparison-mobile");
  await noOverflow();
  assert.equal(jobPosts.length, postsBeforeInspection);

  // Editing a reviewed field revokes confirmation and invalidates the overview.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .getByRole("link", { name: "Revisit candidate profile", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  await page
    .getByLabel("Description", { exact: true })
    .nth(1)
    .fill(`${business.description}\n- Maintained fictional workshop notes.`);
  await page
    .getByRole("button", { name: "Save corrections", exact: true })
    .click();
  await page.getByRole("link", { name: "Job Analysis", exact: true }).click();
  await page
    .getByRole("heading", { name: "Job Analysis", exact: true })
    .waitFor();
  assert.equal(await picker.inputValue(), "profile-1");
  assert.equal(await overview.count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Comparison results", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .isDisabled(),
    true,
  );
  await page
    .getByRole("region", { name: "Comparison availability", exact: true })
    .getByText(
      "This candidate must be reviewed and confirmed before comparison.",
      { exact: true },
    )
    .waitFor();
  assert.equal(jobPosts.length, postsBeforeInspection);
  await page
    .getByRole("link", { name: "Review selected candidate", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review & correct profile", exact: true })
    .click();
  await confirmProfile();
  assert.equal(await picker.inputValue(), "profile-1");
  await acknowledgment.check();
  const corrected = await compare();
  await metricCounts(corrected.result);
  assert.deepEqual(
    corrected.result.technical_evidence
      .filter((item) => item.candidate_evidence.length)
      .map((item) => item.name)
      .sort(),
    ["Airflow", "SQL"],
  );
  await page
    .getByRole("button", { name: "Source description", exact: true })
    .click();
  await page
    .getByLabel("Job description", { exact: true })
    .fill(`${fixture.job_text}\nCompétences requises\nPython`);
  assert.equal(await overview.count(), 0);
  assert.equal(
    await page
      .getByRole("button", { name: "Comparison results", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Compare evidence", exact: true })
      .count(),
    0,
  );
  assert.equal(jobPosts.length, postsBeforeInspection + 1);
  assert.equal(
    await page.evaluate(() => localStorage.length + sessionStorage.length),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real fictional two-job/academic-project CV boundaries, shared session selection/review/confirmation, frozen French Data BA analysis, SQL+Airflow evidence vs neutral GCP/Teradata absence, conservative mastery/duration/industry semantics, exact concise spans and expandable original fields, local filters, route/tab retention, profile/source invalidation, privacy/no storage, desktop and 390px mobile.",
  );
} finally {
  await browser.close();
}
