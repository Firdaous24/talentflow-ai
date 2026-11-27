import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobAnalysis } from "../pages/JobAnalysis";
import { JobSessionProvider } from "../jobSession";
import { jobApi } from "../jobApi";
import { useSession } from "../session";
import { qualificationSnapshot } from "../jobTypes";
import type { JobAnalysisResponse, JobComparisonResponse } from "../jobTypes";
import type { SessionCandidate } from "../types";
import { syntheticProfile } from "./fixtures";
import { realisticJobAnalysis, realisticJobText } from "./jobFixtures";

vi.mock("../session", () => ({ useSession: vi.fn() }));
vi.mock("../jobApi", () => ({
  jobApi: { analyze: vi.fn(), compare: vi.fn() },
}));

const description =
  "Job title: Python Developer\nRequired Skills\nPython required\nSQL required\nExperience\n3 years of experience required";
const analysis: JobAnalysisResponse = {
  job: {
    title: "Python Developer",
    company: null,
    location: null,
    employment_type: null,
    work_mode: null,
    metadata_evidence: {},
    text: description,
    responsibilities: [],
  },
  requirements: [
    {
      id: "req-001",
      text: "Python required",
      category: "technical_skill",
      classification: "required",
      origin: "qualification",
      technical_skills: [{ name: "Python", category: "programming_language" }],
      evidence: [
        {
          quote: "Python required",
          start: description.indexOf("Python required"),
          end: description.indexOf("Python required") + 15,
        },
      ],
      warnings: [],
    },
    {
      id: "req-002",
      text: "SQL required",
      category: "technical_skill",
      classification: "required",
      origin: "qualification",
      technical_skills: [{ name: "SQL", category: "database" }],
      evidence: [
        {
          quote: "SQL required",
          start: description.indexOf("SQL required"),
          end: description.indexOf("SQL required") + 12,
        },
      ],
      warnings: [],
    },
    {
      id: "req-003",
      text: "3 years of experience required",
      category: "experience",
      classification: "required",
      origin: "qualification",
      technical_skills: [],
      evidence: [
        {
          quote: "3 years of experience required",
          start: description.indexOf("3 years"),
          end: description.length,
        },
      ],
      warnings: ["Review duration against explicit candidate evidence."],
    },
  ],
  warnings: ["Only explicit qualifications are extracted."],
  method: "deterministic-v1",
};
const comparison: JobComparisonResponse = {
  comparisons: analysis.requirements.map((requirement, index) => ({
    requirement_id: requirement.id,
    requirement_text: requirement.text,
    original_requirement_text: requirement.text,
    category: requirement.category,
    classification: requirement.classification,
    origin: requirement.origin,
    status: ["documented", "not_documented", "needs_review"][index] as
      | "documented"
      | "not_documented"
      | "needs_review",
    candidate_evidence:
      index === 0
        ? [
            {
              field: "technical_skills[0].name",
              quote: "Python",
              unverified: true,
            },
          ]
        : [],
    job_evidence: requirement.evidence,
    explanation: [
      "Python appears in the reviewed technical skills.",
      "No SQL evidence appears in the reviewed qualification fields.",
      "Duration cannot be established from a skill mention.",
    ][index],
    review_notes: index === 2 ? ["Review experience duration manually."] : [],
  })),
  warnings: ["This checklist does not verify qualifications."],
  review_assertion: "unverified_client_assertion",
  method: "qualification-document-checklist-v1",
};
function candidate(id = "profile-1", confirmed = true): SessionCandidate {
  return {
    ...structuredClone(syntheticProfile),
    id,
    filename: `${id}.pdf`,
    parsedAt: "2026-01-01T00:00:00Z",
    confirmed,
    reviewedCandidate: confirmed
      ? structuredClone(syntheticProfile.candidate)
      : undefined,
  };
}
function mockSession(candidates: SessionCandidate[]) {
  vi.mocked(useSession).mockReturnValue({
    candidates,
    addCandidate: vi.fn(),
    reviewCandidate: vi.fn(),
    clearCandidates: vi.fn(),
    connection: "online",
    healthError: null,
    checkHealth: vi.fn(),
  });
}
function content() {
  return (
    <MemoryRouter>
      <JobSessionProvider>
        <JobAnalysis />
      </JobSessionProvider>
    </MemoryRouter>
  );
}
async function analyzeJob(
  user: ReturnType<typeof userEvent.setup>,
  jobText = description,
) {
  await user.selectOptions(
    screen.getByLabelText("Candidate profile"),
    "profile-1",
  );
  fireEvent.change(screen.getByLabelText("Job description"), {
    target: { value: jobText },
  });
  await user.click(
    screen.getByRole("button", { name: "Analyze requirements" }),
  );
  await screen.findByLabelText("Requirement text req-001");
}
function expectUniqueJobControls(availabilityCount: number) {
  const ids = Array.from(document.querySelectorAll("[id]"), (element) => element.id);
  expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  expect(
    screen.queryAllByRole("region", { name: "Comparison availability" }),
  ).toHaveLength(availabilityCount);
  expect(document.querySelectorAll("#comparison-availability")).toHaveLength(
    availabilityCount,
  );
  for (const attribute of ["aria-describedby", "aria-controls"])
    for (const element of document.querySelectorAll(`[${attribute}]`))
      for (const id of element.getAttribute(attribute)!.split(/\s+/))
        expect(ids.filter((existing) => existing === id)).toHaveLength(1);
}
beforeEach(() => {
  vi.mocked(jobApi.analyze)
    .mockReset()
    .mockResolvedValue(structuredClone(analysis));
  vi.mocked(jobApi.compare)
    .mockReset()
    .mockResolvedValue(structuredClone(comparison));
  mockSession([candidate()]);
});

describe("Job analysis workflow", () => {
  it("shows empty state and navigation to parse a candidate", () => {
    mockSession([]);
    render(content());
    expect(
      screen.getByText("No candidates available"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open CV Parser" }),
    ).toHaveAttribute("href", "/parser");
    expect(
      screen.getByRole("button", { name: "Analyze requirements" }),
    ).toBeDisabled();
  });
  it("offers every session profile and selects an awaiting profile without confirming it", async () => {
    const unreviewed = candidate("profile-2", false);
    unreviewed.candidate.full_name = "Taylor Awaiting";
    mockSession([candidate(), unreviewed]);
    render(content());
    const dropdown = screen.getByLabelText("Candidate profile");
    expect(
      within(dropdown).getByRole("option", {
        name: /Alex Example.*Confirmed review/,
      }),
    ).toBeEnabled();
    const awaitingOption = within(dropdown).getByRole("option", {
      name: /Taylor Awaiting.*Awaiting review/,
    });
    expect(awaitingOption).toBeEnabled();
    expect(within(dropdown).getAllByRole("option")).toHaveLength(3);
    const awaiting = screen.getByRole("region", { name: "Awaiting review" });
    expect(
      within(awaiting).getByRole("heading", { name: /^Awaiting review/ }),
    ).toBeInTheDocument();
    const profile = within(awaiting).getByRole("article", {
      name: "Awaiting review profile-2",
    });
    expect(profile).toHaveTextContent("Taylor Awaiting");
    expect(profile).toHaveTextContent("profile-2.pdf");
    const review = within(profile).getByRole("link", {
      name: "Review profile: Taylor Awaiting",
    });
    expect(review).toHaveTextContent("Review profile");
    expect(review).toHaveAttribute("href", "/candidates/profile-2");
    expect(within(awaiting).queryByText("Alex Example")).not.toBeInTheDocument();
    expect(dropdown).toBeEnabled();
    expect(dropdown).toHaveValue("");
    const user = userEvent.setup();
    await user.selectOptions(dropdown, awaitingOption);
    expect(dropdown).toHaveValue("profile-2");
    expect(awaitingOption).toHaveProperty("selected", true);
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent("This candidate must be reviewed and confirmed before comparison.");
    expect(
      screen.getByRole("link", { name: "Review selected candidate" }),
    ).toHaveAttribute("href", "/candidates/profile-2");
    expect(unreviewed.confirmed).toBe(false);
    expect(vi.mocked(useSession)().reviewCandidate).not.toHaveBeenCalled();
    expect(jobApi.compare).not.toHaveBeenCalled();
  });
  it("keeps the picker enabled when all profiles await review and permits each selection", async () => {
    const first = candidate("profile-1", false);
    const second = candidate("profile-2", false);
    second.candidate.full_name = "Taylor Awaiting";
    mockSession([first, second]);
    render(content());
    const dropdown = screen.getByLabelText("Candidate profile");
    expect(dropdown).toBeEnabled();
    expect(within(dropdown).getAllByRole("option")).toHaveLength(3);
    expect(
      within(dropdown).getByRole("option", { name: "Choose a candidate" }),
    ).toBeInTheDocument();
    const awaiting = screen.getByRole("region", { name: "Awaiting review" });
    expect(within(awaiting).getAllByRole("article")).toHaveLength(2);
    expect(
      within(awaiting).getByRole("link", {
        name: "Review profile: Alex Example",
      }),
    ).toHaveAttribute("href", "/candidates/profile-1");
    expect(
      within(awaiting).getByRole("link", {
        name: "Review profile: Taylor Awaiting",
      }),
    ).toHaveAttribute("href", "/candidates/profile-2");
    const user = userEvent.setup();
    for (const [id, name] of [
      ["profile-1", "Alex Example"],
      ["profile-2", "Taylor Awaiting"],
    ]) {
      const option = within(dropdown).getByRole("option", {
        name: new RegExp(`${name}.*Awaiting review`),
      });
      expect(option).toBeEnabled();
      await user.selectOptions(dropdown, option);
      expect(dropdown).toHaveValue(id);
      expect(option).toHaveProperty("selected", true);
      expect(
        screen.getByRole("link", { name: "Review selected candidate" }),
      ).toHaveAttribute("href", `/candidates/${id}`);
      expect(
        screen.getByRole("region", { name: "Comparison availability" }),
      ).toHaveTextContent("This candidate must be reviewed and confirmed before comparison.");
    }
    expect(first.confirmed).toBe(false);
    expect(second.confirmed).toBe(false);
    expect(jobApi.compare).not.toHaveBeenCalled();
  });
  it("allows selecting a confirmed flag without a reviewed snapshot while blocking comparison", async () => {
    const incomplete = candidate();
    incomplete.reviewedCandidate = undefined;
    mockSession([incomplete]);
    render(content());
    const dropdown = screen.getByLabelText("Candidate profile");
    expect(dropdown).toBeEnabled();
    expect(
      within(dropdown).getByRole("option", { name: /Alex Example.*Awaiting review/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("link", { name: "Review profile: Alex Example" }),
    ).toHaveAttribute("href", "/candidates/profile-1");
    const user = userEvent.setup();
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", { name: /I reviewed the requirement wording/ }),
    );
    expect(dropdown).toHaveValue("profile-1");
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent("This candidate must be reviewed and confirmed before comparison.");
    expect(screen.getByRole("button", { name: "Compare evidence" })).toBeDisabled();
    expect(jobApi.compare).not.toHaveBeenCalled();
  });
  it("labels awaiting review actions with the corrected name or filename fallback", () => {
    const corrected = candidate("profile-2", false);
    corrected.reviewedCandidate = structuredClone(syntheticProfile.candidate);
    corrected.reviewedCandidate.full_name = "Taylor Corrected";
    const unnamed = candidate("profile-3", false);
    unnamed.candidate.full_name = null;
    mockSession([candidate(), corrected, unnamed]);
    render(content());
    const awaiting = screen.getByRole("region", { name: "Awaiting review" });
    expect(
      within(awaiting).getByRole("link", {
        name: "Review profile: Taylor Corrected",
      }),
    ).toHaveAttribute("href", "/candidates/profile-2");
    expect(
      within(awaiting).getByRole("link", {
        name: "Review profile: profile-3.pdf",
      }),
    ).toHaveAttribute("href", "/candidates/profile-3");
    expect(
      within(screen.getByLabelText("Candidate profile")).getAllByRole("option"),
    ).toHaveLength(4);
  });
  it("validates meaningful input and character count before calling analysis", () => {
    render(content());
    const input = screen.getByLabelText("Job description");
    fireEvent.change(input, { target: { value: "1234567890".repeat(4) } });
    expect(
      screen.getByRole("button", { name: "Analyze requirements" }),
    ).toBeDisabled();
    fireEvent.change(input, { target: { value: "a".repeat(30001) } });
    expect(screen.getByRole("alert")).toHaveTextContent("exceeds 30,000");
    expect(
      screen.getByRole("button", { name: "Analyze requirements" }),
    ).toBeDisabled();
    expect(jobApi.analyze).not.toHaveBeenCalled();
  });
  it("analyzes real input, preserves source evidence, and enforces requirement review", async () => {
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user);
    expect(jobApi.analyze).toHaveBeenCalledWith(description);
    expect(screen.getByText("Python Developer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    const reviewControls = screen.getByRole("group", {
      name: "Job review and comparison",
    });
    expect(
      within(reviewControls).getByRole("region", {
        name: "Comparison availability",
      }),
    ).toHaveTextContent(/Check the job requirement review acknowledgment/);
    expect(
      within(reviewControls).getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    expect(
      within(reviewControls).getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).toHaveAccessibleDescription(
      /Confirming a candidate profile does not complete this job requirement review/,
    );
    const requirement = screen.getByRole("article", {
      name: "Requirement req-001",
    });
    await user.click(within(requirement).getByText("Job source evidence"));
    expect(
      within(requirement).getByText(/Source characters/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
  });
  it("records the requirement acknowledgment in the production StrictMode wrapper", async () => {
    const user = userEvent.setup();
    render(<StrictMode>{content()}</StrictMode>);
    await analyzeJob(user);
    const acknowledgment = screen.getByRole("checkbox", {
      name: /I reviewed the requirement wording/,
    });
    await user.click(acknowledgment);
    expect(acknowledgment).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    await user.click(acknowledgment);
    expect(acknowledgment).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    await user.click(acknowledgment);
    expect(acknowledgment).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
  });
  it("enables comparison when a confirmed candidate is selected after the job review", async () => {
    const user = userEvent.setup();
    render(content());
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: description },
    });
    await user.click(
      screen.getByRole("button", { name: "Analyze requirements" }),
    );
    await screen.findByLabelText("Requirement text req-001");
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent("Select a candidate from Candidate profile.");
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expect(jobApi.compare).toHaveBeenCalledTimes(1);
  });
  it("keeps the job review and refreshes comparison when switching confirmed profiles", async () => {
    const first = candidate();
    const second = candidate("profile-2");
    second.reviewedCandidate!.full_name = "Taylor Confirmed";
    second.reviewedCandidate!.experience[0].job_title = "Reviewed analyst";
    mockSession([first, second]);
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-2",
    );
    expect(
      screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expect(
      vi.mocked(jobApi.compare).mock.calls[1][0].candidate.experience[0].job_title,
    ).toBe("Reviewed analyst");
    expect(vi.mocked(jobApi.compare).mock.calls[1][0].candidate).toEqual(
      vi.mocked(jobApi.compare).mock.calls[1][0].review.candidate_snapshot,
    );
    expect(screen.getByText("Reviewed profile: Taylor Confirmed")).toBeInTheDocument();
  });
  it("keeps original labels beside edits and clears review confirmation", async () => {
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.selectOptions(
      screen.getByLabelText("Classification req-001"),
      "preferred",
    );
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    const requirement = screen.getByRole("article", {
      name: "Requirement req-001",
    });
    expect(
      within(requirement).getByText("Human correction"),
    ).toBeInTheDocument();
    expect(
      within(requirement).getByText("Original: Required · Technical skill"),
    ).toBeInTheDocument();
    expect(analysis.requirements[0].classification).toBe("required");
  });
  it("sends purpose-limited reviewed snapshots and renders status counts with expandable evidence", async () => {
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    const payload = vi.mocked(jobApi.compare).mock.calls[0][0];
    expect(payload.candidate).toEqual(payload.review.candidate_snapshot);
    expect(payload.requirements).toEqual(payload.review.requirement_snapshot);
    expect(payload.review.candidate_confirmed).toBe(true);
    expect(payload.candidate).not.toHaveProperty("full_name");
    expect(payload.candidate).not.toHaveProperty("email");
    expect(payload.candidate.experience[0]).not.toHaveProperty("company");
    expect(payload.candidate.experience[0]).not.toHaveProperty("location");
    expect(payload.candidate.education[0]).not.toHaveProperty("institution");
    expect(payload.candidate.projects[0]).not.toHaveProperty("github_url");
    const summary = screen.getByRole("region", { name: "Comparison summary" });
    for (const label of [
      "Documented in profile",
      "Not documented in profile",
      "Needs human review",
    ])
      expect(
        within(summary).getByText(label),
      ).toBeInTheDocument();
    const card = screen.getByRole("article", { name: "Comparison req-001" });
    expect(within(card).queryByRole("region", { name: "Evidence for req-001" })).not.toBeInTheDocument();
    await user.click(
      within(card).getByRole("button", { name: "Expand evidence for req-001" }),
    );
    const evidence = within(card).getByRole("region", { name: "Evidence for req-001" });
    expect(evidence).toBeVisible();
    expect(
      evidence,
    ).toHaveTextContent("Python appears in the reviewed technical skills.");
    expect(
      within(summary).getByText("Absence of documentation does not establish missing ability."),
    ).toBeVisible();
    await user.click(
      within(summary).getByText("Document evidence, interpreted by people"),
    );
    expect(
      within(summary).getByText(/not an authenticated approval/),
    ).toBeVisible();
  });
  it("invalidates results when edited source changes and allows a new analysis", async () => {
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    await user.click(
      screen.getByRole("button", { name: "Source description" }),
    );
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: description + "\nPreferred Skills\nDocker" },
    });
    expect(
      screen.queryByRole("button", { name: "Comparison results" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Analyze requirements" }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", { name: "Start new analysis" }),
    );
    expect(screen.getByLabelText("Job description")).toHaveValue("");
    expect(screen.getByLabelText("Candidate profile")).toHaveValue("profile-1");
  });
  it("keeps control IDs and comparison availability unique across the complete job-view lifecycle", async () => {
    const user = userEvent.setup();
    render(content());
    expectUniqueJobControls(1);
    await analyzeJob(user);
    expectUniqueJobControls(1);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expectUniqueJobControls(0);
    await user.click(screen.getByRole("button", { name: "Source description" }));
    expect(screen.getByLabelText("Job description")).toHaveValue(description);
    expectUniqueJobControls(1);
    await user.click(
      screen.getByRole("button", { name: "Reviewed requirements" }),
    );
    expectUniqueJobControls(1);
    await user.click(screen.getByRole("button", { name: "Start new analysis" }));
    expect(screen.getByLabelText("Job description")).toHaveValue("");
    expect(screen.getByLabelText("Candidate profile")).toHaveValue("profile-1");
    expectUniqueJobControls(1);
    const empty = structuredClone(analysis);
    empty.requirements = [];
    vi.mocked(jobApi.analyze).mockResolvedValueOnce(empty);
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: description },
    });
    await user.click(
      screen.getByRole("button", { name: "Analyze requirements" }),
    );
    await screen.findByRole("heading", {
      name: "No job-related qualifications or technical information detected",
    });
    expectUniqueJobControls(1);
    expect(
      screen.queryByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Return to source description" }),
    );
    expect(screen.getByLabelText("Job description")).toHaveValue(description);
    expectUniqueJobControls(1);
  });
  it("shows API errors and allows analysis and comparison retries", async () => {
    vi.mocked(jobApi.analyze).mockRejectedValueOnce(
      new Error("Analysis temporarily unavailable."),
    );
    vi.mocked(jobApi.compare).mockRejectedValueOnce(
      new Error("Review snapshot is stale."),
    );
    const user = userEvent.setup();
    render(content());
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: description },
    });
    await user.click(
      screen.getByRole("button", { name: "Analyze requirements" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Analysis temporarily unavailable.",
    );
    await user.click(
      screen.getByRole("button", { name: "Analyze requirements" }),
    );
    await screen.findByLabelText("Requirement text req-001");
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Review snapshot is stale.",
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(
      await screen.findByRole("heading", {
        name: "Requirement evidence checklist",
      }),
    ).toBeInTheDocument();
  });
  it("explains pending comparison and restores review controls after completion", async () => {
    let resolveComparison: (value: JobComparisonResponse) => void = () =>
      undefined;
    vi.mocked(jobApi.compare).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveComparison = resolve;
        }),
    );
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    const pending = screen.getByRole("button", {
      name: /Comparing source evidence/,
    });
    expect(pending).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent(
      "The comparison is in progress. Wait for the evidence results.",
    );
    expect(screen.getByLabelText("Candidate profile")).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).toBeDisabled();
    await user.click(pending);
    expect(jobApi.compare).toHaveBeenCalledTimes(1);
    resolveComparison(structuredClone(comparison));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    await user.click(
      screen.getByRole("button", { name: "Reviewed requirements" }),
    );
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Candidate profile")).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent("Ready to compare evidence");
  });
  it("invalidates comparisons and disables comparison after candidate review changes", async () => {
    const user = userEvent.setup();
    const rendered = render(content());
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    const changed = candidate();
    changed.confirmed = false;
    changed.reviewedCandidate!.technical_skills = [];
    mockSession([changed]);
    rendered.rerender(content());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Compare evidence" }),
      ).toBeDisabled(),
    );
    expect(
      screen.getByRole("button", { name: "Comparison results" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
    ).not.toBeInTheDocument();
  });
  it("clears analysis when session profiles are cleared", async () => {
    const user = userEvent.setup();
    const rendered = render(content());
    await analyzeJob(user);
    mockSession([]);
    rendered.rerender(content());
    await waitFor(() =>
      expect(screen.getByLabelText("Job description")).toHaveValue(""),
    );
    expect(
      screen.getByText("No candidates available"),
    ).toBeInTheDocument();
  });
  it("does not publish a late comparison after the selected profile loses confirmation", async () => {
    let resolveComparison: (value: JobComparisonResponse) => void = () =>
      undefined;
    vi.mocked(jobApi.compare).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveComparison = resolve;
        }),
    );
    const user = userEvent.setup();
    const rendered = render(content());
    await analyzeJob(user);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(
      screen.getByRole("button", { name: /Comparing source evidence/ }),
    ).toBeDisabled();
    const changed = candidate();
    changed.confirmed = false;
    mockSession([changed]);
    rendered.rerender(content());
    resolveComparison(comparison);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Compare evidence" }),
      ).toBeDisabled(),
    );
    expect(
      screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
    ).not.toBeInTheDocument();
  });
});

describe("Comparison privacy projection", () => {
  it("copies only qualification fields without mutating or sharing candidate arrays", () => {
    const profile = structuredClone(syntheticProfile.candidate);
    const snapshot = qualificationSnapshot(profile);
    expect(Object.keys(snapshot).sort()).toEqual([
      "certifications",
      "education",
      "experience",
      "languages",
      "projects",
      "technical_skills",
    ]);
    snapshot.experience[0].technologies.push("SQL");
    snapshot.technical_skills[0].name = "Edited";
    expect(profile.experience[0].technologies).toEqual(["Python"]);
    expect(profile.technical_skills[0].name).toBe("Python");
  });
});

describe("Realistic job analysis review", () => {
  beforeEach(() => {
    vi.mocked(jobApi.analyze).mockResolvedValue(
      structuredClone(realisticJobAnalysis),
    );
  });

  it("keeps environment mentions separate from required, preferred and unspecified qualifications", async () => {
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user, realisticJobText);
    const required = screen.getByRole("region", { name: "Required criteria" });
    const preferred = screen.getByRole("region", {
      name: "Preferred criteria",
    });
    const unspecified = screen.getByRole("region", {
      name: "Unspecified criteria",
    });
    const environment = screen.getByRole("region", {
      name: "Technical environment mentions",
    });
    expect(
      within(required).getByLabelText("Requirement text req-001"),
    ).toHaveValue("Python");
    expect(
      within(preferred).getByLabelText("Requirement text req-002"),
    ).toHaveValue("Docker");
    expect(
      within(unspecified).getByLabelText("Requirement text req-003"),
    ).toHaveValue("SQL");
    expect(
      within(unspecified).queryByLabelText("Requirement text req-004"),
    ).not.toBeInTheDocument();
    expect(
      within(environment).getByLabelText("Requirement text req-004"),
    ).toHaveValue("Azure AI / Azure OpenAI");
    expect(
      within(environment).getByText(
        /mention alone does not establish a mandatory/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Some qualification classifications are unspecified/),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Analysis completed with notes",
    );
    await user.click(within(environment).getByText("Job source evidence"));
    const evidence = within(environment).getByRole("blockquote");
    expect(evidence).toHaveTextContent("Azure AI / Azure OpenAI");
    expect(evidence).toHaveTextContent(
      `Source characters ${realisticJobAnalysis.requirements[3].evidence[0].start}`,
    );
  });

  it("renders independent metadata and retains the full work schedule as source evidence", async () => {
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user, realisticJobText);
    const location = screen.getByText("Location", {
      selector: "dt",
    }).parentElement!;
    expect(
      within(location).getByText("Rabat/Technopolis", { selector: "dd" }),
    ).toBeInTheDocument();
    expect(location).not.toHaveTextContent("Contrat:");
    expect(screen.getByText("CDI", { selector: "dd" })).toBeInTheDocument();
    expect(screen.getByText("Hybrid")).toBeInTheDocument();
    const source = screen.getByText("Work mode source and schedule");
    await user.click(source);
    expect(source.parentElement).toHaveAttribute("open");
    expect(source.parentElement).toHaveTextContent(
      "Le premier mois sera principalement réalisé en présentiel.",
    );
    expect(source.parentElement).toHaveTextContent(
      "À partir du deuxième mois, fonctionnement hybride.",
    );
    expect(source.parentElement).toHaveTextContent("Source characters");
    expect(
      screen.queryByText("recrutement@example.com"),
    ).not.toBeInTheDocument();
  });

  it("explains an environment-only extraction without claiming there are no technical mentions", async () => {
    const environmentOnly = structuredClone(realisticJobAnalysis);
    environmentOnly.requirements = [
      {
        ...environmentOnly.requirements[3],
        id: "req-001",
      },
    ];
    vi.mocked(jobApi.analyze).mockResolvedValueOnce(environmentOnly);
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user, realisticJobText);
    expect(
      screen.getByText("Technical environment extracted"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No mandatory qualifications are explicitly stated/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        /No job-related qualifications or technical information detected/,
      ),
    ).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Required criteria" }),
      ).queryByRole("article"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
  });

  it("provides a source-review action when no qualifications or technical information was detected", async () => {
    const empty = structuredClone(realisticJobAnalysis);
    empty.requirements = [];
    empty.job.work_mode = null;
    empty.job.metadata_evidence = {};
    vi.mocked(jobApi.analyze).mockResolvedValueOnce(empty);
    const user = userEvent.setup();
    render(content());
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    fireEvent.change(screen.getByLabelText("Job description"), {
      target: { value: realisticJobText },
    });
    await user.click(
      screen.getByRole("button", { name: "Analyze requirements" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "No job-related qualifications or technical information detected",
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Compare evidence" }),
    ).not.toBeInTheDocument();
    const mode = screen.getByText("Work mode", {
      selector: "dt",
    }).parentElement!;
    expect(mode).toHaveTextContent("Not provided explicitly");
    await user.click(
      screen.getByRole("button", { name: "Return to source description" }),
    );
    expect(screen.getByLabelText("Job description")).toHaveValue(
      realisticJobText,
    );
  });

  it("keeps an edited environment classification distinct from the immutable original origin", async () => {
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user, realisticJobText);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.selectOptions(
      screen.getByLabelText("Classification req-004"),
      "required",
    );
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeChecked();
    const environment = screen.getByRole("region", {
      name: "Technical environment mentions",
    });
    expect(
      within(environment).getByLabelText("Classification req-004"),
    ).toHaveValue("required");
    expect(
      within(environment).getByText(/Original: Unspecified/),
    ).toBeInTheDocument();
    expect(
      within(environment).getByText(
        /edited classification is your reviewed interpretation/,
      ),
    ).toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Required criteria" }),
      ).queryByLabelText("Classification req-004"),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    const payload = vi.mocked(jobApi.compare).mock.calls[0][0];
    expect(payload.requirements[3].classification).toBe("required");
    expect(payload.job_analysis.requirements[3].classification).toBe(
      "unspecified",
    );
    expect(payload.job_analysis.requirements[3].origin).toBe(
      "technical_environment",
    );
    expect(payload.requirements[3]).not.toHaveProperty("origin");
  });

  it("surfaces rejected unsupported corrections and preserves original excerpts until corrected", async () => {
    vi.mocked(jobApi.compare).mockRejectedValueOnce(
      new Error(
        "Requirement correction contains a technology not present in the original source.",
      ),
    );
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user, realisticJobText);
    fireEvent.change(screen.getByLabelText("Requirement text req-004"), {
      target: { value: "Terraform" },
    });
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not present in the original source",
    );
    expect(
      screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Requirement text req-004")).toHaveValue(
      "Terraform",
    );
    const environment = screen.getByRole("region", {
      name: "Technical environment mentions",
    });
    expect(
      within(environment).getByRole("heading", {
        name: "Azure AI / Azure OpenAI",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Comparison results" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Requirement text req-004"), {
      target: { value: "Azure AI / Azure OpenAI" },
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
  });

  it("preserves environment comparison results across review views and invalidates them after edits", async () => {
    const environment = realisticJobAnalysis.requirements[3];
    const environmentComparison: JobComparisonResponse = {
      ...comparison,
      comparisons: [
        {
          requirement_id: environment.id,
          requirement_text: environment.text,
          original_requirement_text: environment.text,
          category: environment.category,
          classification: environment.classification,
          origin: environment.origin,
          status: "needs_review",
          candidate_evidence: [],
          job_evidence: environment.evidence,
          explanation:
            "The environment list does not specify a candidate qualification.",
          review_notes: [],
        },
      ],
    };
    vi.mocked(jobApi.compare).mockResolvedValueOnce(environmentComparison);
    const user = userEvent.setup();
    render(content());
    await analyzeJob(user, realisticJobText);
    await user.click(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expect(
      screen.getByRole("article", { name: "Comparison req-004" }),
    ).toHaveTextContent(/Technical environment mention.*not an explicit candidate requirement/);
    await user.click(
      screen.getByRole("button", { name: "Reviewed requirements" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Comparison results" }),
    );
    expect(
      screen.getByRole("article", { name: "Comparison req-004" }),
    ).toBeInTheDocument();
    expect(jobApi.compare).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("button", { name: "Reviewed requirements" }),
    );
    await user.selectOptions(
      screen.getByLabelText("Classification req-004"),
      "preferred",
    );
    expect(
      screen.getByRole("button", { name: "Comparison results" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeChecked();
  });
});
