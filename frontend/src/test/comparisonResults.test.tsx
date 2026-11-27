import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComparisonResults } from "../components/ComparisonResults";
import { jobApi } from "../jobApi";
import type {
  JobAnalysisResponse,
  JobComparisonResponse,
  JobRequirement,
} from "../jobTypes";

vi.mock("../jobApi", () => ({
  jobApi: { analyze: vi.fn(), compare: vi.fn() },
}));

// Fictional response fixtures exercise rendering, not the backend's parser or
// canonical matcher. The server explicitly distinguishes every overlapping name.
function fixture() {
  const clauses = [
    "Python required",
    "Docker preferred",
    "Azure / Azure AI / Azure OpenAI / OpenAI / RAG / GraphRAG",
    "AI / AI Agents / API / REST APIs / Machine Learning / MLOps",
    "Python / Docker",
  ];
  const text = `Job title: Fictional Engineer\n${clauses.join("\n")}`;
  const skillNames = [
    ["Python"],
    ["Docker"],
    ["Azure", "Azure AI", "Azure OpenAI", "OpenAI", "RAG", "GraphRAG"],
    ["AI", "AI Agents", "API", "REST APIs", "Machine Learning", "MLOps"],
    ["Python", "Docker"],
  ];
  const requirements: JobRequirement[] = clauses.map((clause, index) => ({
    id: `req-00${index + 1}`,
    text: clause,
    category: "technical_skill",
    classification: index === 0 ? "required" : index === 1 ? "preferred" : "unspecified",
    origin: index < 2 ? "qualification" : "technical_environment",
    technical_skills: skillNames[index].map((name) => ({ name, category: "tool" })),
    evidence: [{ quote: clause, start: text.indexOf(clause), end: text.indexOf(clause) + clause.length }],
    warnings: index < 2 ? [] : ["An environment mention is not an explicit qualification."],
  }));
  const analysis: JobAnalysisResponse = {
    job: {
      title: "Fictional Engineer",
      company: null,
      location: null,
      employment_type: null,
      work_mode: null,
      metadata_evidence: {},
      text,
      responsibilities: [],
    },
    requirements,
    warnings: [],
    method: "deterministic-v1",
  };
  const documented = new Set(["Python", "Azure", "OpenAI", "GraphRAG", "AI Agents", "REST APIs", "Machine Learning"]);
  const candidateQuote = "Built GraphRAG using Azure and OpenAI with AI Agents, REST APIs and Machine Learning.";
  const result: JobComparisonResponse = {
    comparisons: requirements.map((requirement, index) => ({
      requirement_id: requirement.id,
      requirement_text: requirement.text,
      original_requirement_text: requirement.text,
      category: requirement.category,
      classification: requirement.classification,
      origin: requirement.origin,
      status: index === 0 ? "documented" : index === 1 ? "not_documented" : "needs_review",
      candidate_evidence: index === 0
        ? [{ field: "technical_skills[0].name", quote: "Python", unverified: true }]
        : index === 2 || index === 3
          ? [{ field: "projects[0].description", quote: candidateQuote, unverified: true }]
          : [],
      job_evidence: requirement.evidence,
      explanation: index === 0
        ? "Python appears in the reviewed technical skills; proficiency is unverified."
        : index === 1
          ? "No Docker mention was found in the submitted qualification fields."
          : "The source lists a technical environment and does not establish a candidate qualification.",
      review_notes: index < 2 ? [] : ["Review the original environment clause before interpreting its relevance.", ...requirement.warnings],
    })),
    technical_evidence: [...new Set(skillNames.flat())].map((name) => {
      const references = requirements.filter((requirement) =>
        requirement.technical_skills.some((skill) => skill.name === name),
      );
      return {
        name,
        category: "tool",
        job_references: references.map((requirement) => ({
          requirement_id: requirement.id,
          origin: requirement.origin,
          classification: requirement.classification,
          evidence: requirement.evidence,
        })),
        candidate_evidence: documented.has(name)
          ? [{ field: name === "Python" ? "technical_skills[0].name" : "projects[0].description", quote: name === "Python" ? "Python" : candidateQuote, unverified: true }]
          : [],
        requires_interpretation: references.some((requirement) => requirement.origin === "technical_environment"),
      };
    }),
    warnings: ["Source mentions do not establish proficiency."],
    review_assertion: "unverified_client_assertion",
    method: "qualification-document-checklist-v1",
  };
  return { analysis, result, candidateQuote };
}

afterEach(() => vi.clearAllMocks());

function expectMetric(summary: HTMLElement, label: string, count: number) {
  const metric = within(summary).getByRole("heading", { name: label }).parentElement!;
  expect(within(metric).getByText(String(count), { selector: "strong" })).toBeVisible();
}

describe("Comparison results evidence interface", () => {
  it("keeps an explicit required experience threshold separate from evidence satisfaction", async () => {
    const { analysis, result } = fixture();
    const text = "Minimum 5 ans d'expérience sur un poste similaire de Business Analyst.";
    analysis.job.text = `Poste : Analyste fictif\nPROFIL RECHERCHÉ\n${text}\\\n\\`;
    const start = analysis.job.text.indexOf(text);
    const source = [{ quote: `${text}\\`, start, end: start + Array.from(text).length + 1 }];
    analysis.requirements = [{
      ...analysis.requirements[0], text: `${text}\\`, category: "experience",
      classification: "required", technical_skills: [], evidence: source,
    }];
    result.comparisons = [{
      ...result.comparisons[0], requirement_text: `${text}\\`, original_requirement_text: `${text}\\`,
      category: "experience", classification: "required", status: "needs_review",
      job_evidence: source,
      candidate_evidence: [{ field: "experience.0.job_title", quote: "Business Analyst", unverified: true }],
      explanation: "Duration, scope and role equivalence require human review. No years are computed.",
    }];
    result.technical_evidence = [];
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const card = screen.getByRole("article", { name: "Comparison req-001" });
    expect(card).toHaveTextContent("Required");
    expect(card).toHaveTextContent("Needs human review");
    expect(screen.getAllByRole("article", { name: /^Comparison req-/ })).toHaveLength(1);
    expectMetric(screen.getByRole("region", { name: "Comparison summary" }), "Documented in profile", 0);
    await user.click(within(card).getByRole("button", { name: "Expand evidence for req-001" }));
    const evidence = within(card).getByRole("region", { name: "Evidence for req-001" });
    expect(evidence).toHaveTextContent(result.comparisons[0].explanation);
    expect(evidence).toHaveTextContent("Business Analyst");
    expect(within(evidence).getByText(`${text}\\`, { selector: "blockquote" })).toBeVisible();
    await user.click(within(evidence).getByText("Source and reviewed classification"));
    expect(within(evidence).getAllByText("Required", { selector: "dd" })).toHaveLength(2);
  });

  it("shows exact compact excerpts first and reveals the full reviewed field on demand", async () => {
    const { analysis, result } = fixture();
    const quote = "Built a fictional service.\nUsed SQL to validate data quality.\nPrepared unrelated release notes.";
    const excerpt = "Used SQL to validate data quality.";
    result.comparisons[0].candidate_evidence = [{
      field: "experience.0.description", quote, unverified: true,
      excerpt: { quote: excerpt, start: quote.indexOf(excerpt), end: quote.indexOf(excerpt) + excerpt.length },
    }];
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    await user.click(screen.getByRole("button", { name: "Expand evidence for req-001" }));
    const evidence = screen.getByRole("region", { name: "Evidence for req-001" });
    const profile = evidence.querySelector(".comparison-profile-evidence")! as HTMLElement;
    expect(within(profile).getByText(excerpt, { exact: true })).toBeVisible();
    expect(profile.querySelector("blockquote")).not.toHaveTextContent("release notes");
    expect(profile).toHaveTextContent("Profile field: experience.0.description");
    expect(profile).toHaveTextContent(`Field characters ${quote.indexOf(excerpt)}–${quote.indexOf(excerpt) + excerpt.length}`);
    const full = profile.querySelector("[data-full-source]")!;
    expect(full).not.toBeVisible();
    await user.click(within(profile).getByText("View full reviewed field"));
    expect(full).toBeVisible();
    expect(full.textContent).toBe(quote);
    expect(evidence).toHaveTextContent("Supporting CV mention found");
    const classification = within(evidence).getByText("Source and reviewed classification").parentElement!;
    expect(classification).not.toHaveAttribute("open");
  });

  it("uses Unicode source offsets and keeps negation intact rather than slicing a keyword", async () => {
    const { analysis, result } = fixture();
    const quote = "🧪 Projet fictif.\nSQL utilisé sans revendiquer une maîtrise avancée.\nAutre contexte.";
    const excerpt = "SQL utilisé sans revendiquer une maîtrise avancée.";
    const start = Array.from(quote.slice(0, quote.indexOf(excerpt))).length;
    result.technical_evidence![0].candidate_evidence = [{
      field: "projects.0.description", quote, unverified: true,
      excerpt: { quote: excerpt, start, end: start + Array.from(excerpt).length },
    }];
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const technology = screen.getByLabelText("Technical evidence for Python");
    await user.click(technology.querySelector("summary")!);
    const profile = technology.querySelector(".comparison-profile-evidence")! as HTMLElement;
    expect(within(profile).getByText(excerpt, { exact: true })).toBeVisible();
    expect(profile.querySelector("blockquote")).not.toHaveTextContent("Autre contexte");
    expect(profile.querySelector("mark")).toBeNull();
    await user.click(within(profile).getByText("View full reviewed field"));
    expect(profile.querySelector("[data-full-source]")!.textContent).toBe(quote);
  });

  it("falls back to original evidence when an additive excerpt is not source-consistent", async () => {
    const { analysis, result } = fixture();
    result.comparisons[0].candidate_evidence = [{
      field: "technical_skills.0.name", quote: "Python", unverified: true,
      excerpt: { quote: "Advanced SQL mastery", start: 0, end: 6 },
    }];
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    await user.click(screen.getByRole("button", { name: "Expand evidence for req-001" }));
    const evidence = screen.getByRole("region", { name: "Evidence for req-001" });
    expect(evidence.querySelector(".comparison-profile-evidence blockquote")).toHaveTextContent("Python");
    expect(evidence).not.toHaveTextContent("Advanced SQL mastery");
    expect(evidence.querySelector(".comparison-full-field")).toBeNull();
  });

  it("shows a composite cloud stack without converting overlap into qualification satisfaction", async () => {
    const { analysis, result } = fixture();
    result.comparisons = [{ ...result.comparisons[2], status: "needs_review" }];
    result.technical_evidence = ["SQL", "GCP", "Teradata", "Airflow"].map((name) => ({
      name, category: "tool", requires_interpretation: true,
      job_references: [{ requirement_id: "req-003", origin: "qualification", classification: "required", evidence: analysis.requirements[2].evidence }],
      candidate_evidence: ["SQL", "Airflow"].includes(name)
        ? [{ field: "experience.0.description", quote: `Used ${name} in a fictional project.`, unverified: true }]
        : [],
    }));
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const both = screen.getByRole("region", { name: "Mentioned in both documents" });
    const absent = screen.getByRole("region", { name: "No supporting mention found in the reviewed CV" });
    for (const name of ["SQL", "Airflow"])
      expect(within(both).getByLabelText(`Technical evidence for ${name}`)).toBeInTheDocument();
    for (const name of ["GCP", "Teradata"]) {
      const source = within(absent).getByLabelText(`Technical evidence for ${name}`);
      await user.click(source.querySelector("summary")!);
      expect(source).toHaveTextContent("This does not establish missing ability.");
      expect(source.querySelector(".comparison-technology-sources")).toHaveClass("comparison-evidence-stack");
    }
    expectMetric(screen.getByRole("region", { name: "Comparison summary" }), "Needs human review", 1);
    expectMetric(screen.getByRole("region", { name: "Comparison summary" }), "Documented in profile", 0);
  });

  it("uses actual response counts and keeps technical-environment rows under human review", () => {
    const { analysis, result } = fixture();
    const rendered = render(<ComparisonResults analysis={analysis} result={result} />);
    const summary = screen.getByRole("region", { name: "Comparison summary" });
    expect(summary).toHaveTextContent("Documented in profile");
    expect(summary).toHaveTextContent("Not documented in profile");
    expect(summary).toHaveTextContent("Needs human review");
    expectMetric(summary, "Documented in profile", 1);
    expectMetric(summary, "Not documented in profile", 1);
    expectMetric(summary, "Needs human review", 3);
    for (const item of result.comparisons.filter((comparison) => comparison.origin === "technical_environment")) {
      const card = screen.getByRole("article", { name: `Comparison ${item.requirement_id}` });
      expect(card).toHaveTextContent(/Needs human review|Needs review/);
      expect(card).toHaveTextContent("Unspecified");
      expect(card).not.toHaveTextContent(/Required qualification/);
    }
    const smaller = structuredClone(result);
    smaller.comparisons = result.comparisons.slice(2);
    rendered.rerender(<ComparisonResults analysis={analysis} result={smaller} />);
    expect(screen.queryByRole("article", { name: "Comparison req-001" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: /^Comparison req-/ })).toHaveLength(3);
    const updated = screen.getByRole("region", { name: "Comparison summary" });
    expectMetric(updated, "Documented in profile", 0);
    expectMetric(updated, "Not documented in profile", 0);
    expectMetric(updated, "Needs human review", 3);
    expect(updated).toHaveTextContent(
      "These technologies describe the job's technical environment. Their presence does not establish mandatory candidate qualifications.",
    );
  });

  it("renders only the server's canonical mentions in the proper neutral evidence groups", () => {
    const { analysis, result } = fixture();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const both = screen.getByRole("region", { name: "Mentioned in both documents" });
    const unsupported = screen.getByRole("region", { name: "No supporting mention found in the reviewed CV" });
    for (const name of ["Python", "Azure", "OpenAI", "GraphRAG", "AI Agents", "REST APIs", "Machine Learning"])
      expect(within(both).getByLabelText(`Technical evidence for ${name}`)).toBeInTheDocument();
    for (const name of ["Docker", "Azure AI", "Azure OpenAI", "RAG", "AI", "API", "MLOps"]) {
      expect(within(unsupported).getByLabelText(`Technical evidence for ${name}`)).toBeInTheDocument();
      expect(within(both).queryByLabelText(`Technical evidence for ${name}`)).not.toBeInTheDocument();
    }
    expect(unsupported).not.toHaveTextContent(/missing skills|not qualified/i);
    expect(screen.getByRole("region", { name: "Technical Evidence Overview" })).toHaveTextContent(/unverified/);
  });

  it("shows a technology once while retaining every source reference and profile field", async () => {
    const { analysis, result } = fixture();
    const python = result.technical_evidence!.find((technology) => technology.name === "Python")!;
    const environmentReference = python.job_references[1];
    python.job_references = python.job_references.slice(0, 1);
    python.requires_interpretation = false;
    result.technical_evidence!.push({
      ...structuredClone(python),
      job_references: [environmentReference],
      requires_interpretation: true,
    });
    const unchanged = structuredClone(result);
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const both = screen.getByRole("region", { name: "Mentioned in both documents" });
    expect(within(both).getAllByLabelText("Technical evidence for Python")).toHaveLength(1);
    const technology = within(both).getByLabelText("Technical evidence for Python");
    expect(technology).not.toHaveAttribute("open");
    await user.click(technology.querySelector("summary")!);
    expect(technology).toHaveAttribute("open");
    expect(technology).toHaveTextContent("Python required");
    expect(technology).toHaveTextContent("Python / Docker");
    expect(technology).toHaveTextContent("req-001");
    expect(technology).toHaveTextContent("req-005");
    expect(technology).toHaveTextContent("technical_skills[0].name");
    expect(technology).toHaveTextContent(/unverified/);
    expect(within(technology).getByText("Python", { selector: "mark" })).toBeVisible();
    expect(within(technology).getAllByText("Profile field: technical_skills[0].name")).toHaveLength(1);
    expect(technology).toHaveTextContent(String(analysis.requirements[4].evidence[0].start));
    const interpretation = screen.getByRole("region", { name: "Requires interpretation" });
    for (const id of ["req-003", "req-004", "req-005"])
      expect(interpretation).toHaveTextContent(id);
    expect(within(interpretation).queryByRole("link", { name: /^req-001\b/ })).not.toBeInTheDocument();
    expect(within(interpretation).queryByRole("link", { name: /^req-002\b/ })).not.toBeInTheDocument();
    await user.click(technology.querySelector("summary")!);
    expect(technology).not.toHaveAttribute("open");
    expect(result).toEqual(unchanged);
  });

  it("does not infer overlapping matches when an older response lacks structured technical evidence", () => {
    const { analysis, result } = fixture();
    delete result.technical_evidence;
    render(<ComparisonResults analysis={analysis} result={result} />);
    const overview = screen.getByRole("region", { name: "Technical Evidence Overview" });
    expect(within(overview).queryByLabelText(/^Technical evidence for/)).not.toBeInTheDocument();
    expect(overview).toHaveTextContent(/not available|not returned|unavailable/i);
    expect(screen.getAllByRole("article", { name: /^Comparison req-/ })).toHaveLength(5);
  });

  it("collapses long evidence initially and expands original excerpts, notes and provenance on demand", async () => {
    const { analysis, result, candidateQuote } = fixture();
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const card = screen.getByRole("article", { name: "Comparison req-003" });
    expect(within(card).queryByRole("region", { name: "Evidence for req-003" })).not.toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Expand evidence for req-003" }));
    const evidence = within(card).getByRole("region", { name: "Evidence for req-003" });
    expect(evidence).toBeVisible();
    expect(evidence).toHaveTextContent(analysis.requirements[2].evidence[0].quote);
    expect(evidence).toHaveTextContent(candidateQuote);
    expect(evidence).toHaveTextContent("projects[0].description");
    expect(evidence).toHaveTextContent(result.comparisons[2].explanation);
    expect(evidence).toHaveTextContent(result.comparisons[2].review_notes[0]);
    expect(evidence).toHaveTextContent(analysis.requirements[2].warnings[0]);
    expect(within(evidence).getAllByText(analysis.requirements[2].warnings[0])).toHaveLength(1);
    expect(evidence).toHaveTextContent(/Unspecified/);
    expect(evidence).toHaveTextContent(/environment/i);
    await user.click(within(card).getByRole("button", { name: "Collapse evidence for req-003" }));
    expect(within(card).queryByRole("region", { name: "Evidence for req-003" })).not.toBeInTheDocument();
  });

  it("filters existing statuses and expands or collapses cards without requesting another comparison", async () => {
    const { analysis, result } = fixture();
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const filters = screen.getByRole("group", { name: "Filter comparison results" });
    for (const [label, ids] of [
      ["Documented", ["req-001"]],
      ["Not documented", ["req-002"]],
      ["Needs review", ["req-003", "req-004", "req-005"]],
      ["All", ["req-001", "req-002", "req-003", "req-004", "req-005"]],
    ] as const) {
      const button = within(filters).getByRole("button", { name: label });
      await user.click(button);
      expect(button).toHaveAttribute("aria-pressed", "true");
      expect(screen.getAllByRole("article", { name: /^Comparison req-/ })).toHaveLength(ids.length);
      for (const id of ids)
        expect(screen.getByRole("article", { name: `Comparison ${id}` })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("button", { name: "Expand all" }));
    for (const id of ["req-001", "req-002", "req-003", "req-004", "req-005"])
      expect(screen.getByRole("region", { name: `Evidence for ${id}` })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.queryAllByRole("region", { name: /^Evidence for req-/ })).toHaveLength(0);
    expect(jobApi.analyze).not.toHaveBeenCalled();
    expect(jobApi.compare).not.toHaveBeenCalled();
    expect(result.comparisons).toHaveLength(5);
  });

  it("shows an empty filtered status without losing the environment results or changing global counts", async () => {
    const { analysis, result } = fixture();
    result.comparisons = result.comparisons.slice(2);
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const filters = screen.getByRole("group", { name: "Filter comparison results" });
    await user.click(within(filters).getByRole("button", { name: "Documented" }));
    expect(screen.queryAllByRole("article", { name: /^Comparison req-/ })).toHaveLength(0);
    expect(screen.getByText(/No clauses have this evidence status/)).toBeVisible();
    expectMetric(screen.getByRole("region", { name: "Comparison summary" }), "Needs human review", 3);
    await user.click(within(filters).getByRole("button", { name: "All" }));
    expect(screen.getAllByRole("article", { name: /^Comparison req-/ })).toHaveLength(3);
    expect(jobApi.compare).not.toHaveBeenCalled();
  });

  it("reveals and focuses a source clause from the interpretation list even when its status is filtered out", async () => {
    const { analysis, result } = fixture();
    const user = userEvent.setup();
    render(<ComparisonResults analysis={analysis} result={result} />);
    const filters = screen.getByRole("group", { name: "Filter comparison results" });
    await user.click(within(filters).getByRole("button", { name: "Documented" }));
    expect(screen.queryByRole("article", { name: "Comparison req-003" })).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole("region", { name: "Requires interpretation" })).getByRole(
        "link",
        { name: /^req-003\b/ },
      ),
    );
    expect(within(filters).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    const card = screen.getByRole("article", { name: "Comparison req-003" });
    expect(within(card).getByRole("region", { name: "Evidence for req-003" })).toBeVisible();
    await waitFor(() => expect(card).toHaveFocus());
    expect(jobApi.compare).not.toHaveBeenCalled();
  });

  it("handles empty comparisons and an empty structured overview without fabricating evidence", () => {
    const { analysis, result } = fixture();
    result.comparisons = [];
    result.technical_evidence = [];
    render(<ComparisonResults analysis={analysis} result={result} />);
    expect(screen.queryAllByRole("article", { name: /^Comparison req-/ })).toHaveLength(0);
    const summary = screen.getByRole("region", { name: "Comparison summary" });
    for (const label of ["Documented in profile", "Not documented in profile", "Needs human review"])
      expectMetric(summary, label, 0);
    const overview = screen.getByRole("region", { name: "Technical Evidence Overview" });
    expect(overview).toHaveTextContent("No supported technical mentions were returned for this comparison.");
    expect(overview).not.toHaveTextContent(/unavailable/);
    expect(screen.getByText(/No comparison|No requirements|No evidence rows/i)).toBeInTheDocument();
    expect(jobApi.compare).not.toHaveBeenCalled();
  });
});
