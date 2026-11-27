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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { api } from "../api";
import { jobApi } from "../jobApi";
import type { JobAnalysisResponse, JobComparisonResponse } from "../jobTypes";
import { pdfFile, syntheticProfile } from "./fixtures";
import { realisticJobAnalysis } from "./jobFixtures";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { health: vi.fn(), parse: vi.fn(), extractionConfig: vi.fn() },
}));

// Environment-only source with exact offsets; its unspecified origin must survive
// the real session, route navigation and privacy projection into the API payload.
const environmentText =
  "Poste : Architecte IA\nEnvironnement technique :\nAzure AI / Azure OpenAI";
const environmentRequirement = {
  ...structuredClone(realisticJobAnalysis.requirements[3]),
  id: "req-001",
  evidence: [
    {
      quote: "Azure AI / Azure OpenAI",
      start: environmentText.indexOf("Azure AI / Azure OpenAI"),
      end: environmentText.length,
    },
  ],
};
const environmentAnalysis: JobAnalysisResponse = {
  ...structuredClone(realisticJobAnalysis),
  job: {
    ...structuredClone(realisticJobAnalysis.job),
    text: environmentText,
    company: null,
    location: null,
    employment_type: null,
    work_mode: null,
    metadata_evidence: {},
  },
  requirements: [environmentRequirement],
};
const environmentComparison: JobComparisonResponse = {
  comparisons: [
    {
      requirement_id: environmentRequirement.id,
      requirement_text: environmentRequirement.text,
      original_requirement_text: environmentRequirement.text,
      category: environmentRequirement.category,
      classification: "unspecified",
      origin: "technical_environment",
      status: "needs_review",
      candidate_evidence: [],
      job_evidence: environmentRequirement.evidence,
      explanation:
        "The environment list does not establish a candidate qualification.",
      review_notes: [],
    },
  ],
  warnings: [],
  review_assertion: "unverified_client_assertion",
  method: "qualification-document-checklist-v1",
};

beforeEach(() => {
  vi.mocked(api.health).mockResolvedValue({ status: "ok" });
  vi.mocked(api.extractionConfig).mockResolvedValue({
    available: false,
    provider: null,
    destination: null,
    model: null,
    connectivity: "not_checked",
  });
  vi.mocked(api.parse)
    .mockReset()
    .mockResolvedValue(structuredClone(syntheticProfile));
  vi.spyOn(jobApi, "analyze").mockResolvedValue(
    structuredClone(environmentAnalysis),
  );
  vi.spyOn(jobApi, "compare").mockResolvedValue(
    structuredClone(environmentComparison),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function open(strict = false) {
  const application = (
    <MemoryRouter initialEntries={["/parser"]}>
      <App />
    </MemoryRouter>
  );
  return render(strict ? <StrictMode>{application}</StrictMode> : application);
}
async function upload(
  user: ReturnType<typeof userEvent.setup>,
  name = "Alex Example",
) {
  await user.upload(
    document.querySelector<HTMLInputElement>("#cv-file")!,
    pdfFile(),
  );
  await user.click(await screen.findByRole("button", { name: "Parse CV" }));
  await screen.findByRole("heading", { name });
}
async function confirm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("button", { name: "Review & correct profile" }),
  );
  expect(
    screen.getByRole("button", { name: "Confirm reviewed profile" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("checkbox", { name: /I reviewed the fields/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Confirm reviewed profile" }),
  );
  await screen.findByRole("heading", { name: "Profile confirmed" });
}
async function navigateToJobs(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("link", { name: "Job Analysis" }),
  );
  await screen.findByRole("heading", { name: "Job Analysis" });
}
async function analyze(user: ReturnType<typeof userEvent.setup>) {
  fireEvent.change(screen.getByLabelText("Job description"), {
    target: { value: environmentText },
  });
  await user.click(
    screen.getByRole("button", { name: "Analyze requirements" }),
  );
  await screen.findByLabelText("Requirement text req-001");
}
async function reviewRequirements(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    screen.getByRole("checkbox", {
      name: /I reviewed the requirement wording/,
    }),
  );
}

describe("Comparison workflow through real session providers and routes", () => {
  it("uploads, confirms, selects and compares an environment-only job in StrictMode without a refresh", async () => {
    const user = userEvent.setup();
    const storage = vi.spyOn(Storage.prototype, "setItem");
    open(true);
    await upload(user);
    await confirm(user);
    await navigateToJobs(user);
    expect(
      screen.getByRole("option", { name: /Alex Example.*Confirmed review/ }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("region", { name: "Awaiting review" }),
    ).not.toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    await analyze(user);
    expect(screen.getByLabelText("Classification req-001")).toHaveValue(
      "unspecified",
    );
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent(/Check the job requirement review acknowledgment/);
    await reviewRequirements(user);
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    const card = screen.getByRole("article", { name: "Comparison req-001" });
    expect(within(card).queryByRole("region", { name: "Evidence for req-001" })).not.toBeInTheDocument();
    await user.click(
      within(card).getByRole("button", { name: "Expand evidence for req-001" }),
    );
    const evidence = within(card).getByRole("region", { name: "Evidence for req-001" });
    expect(evidence).toBeVisible();
    expect(
      evidence,
    ).toHaveTextContent(
      "The environment list does not establish a candidate qualification.",
    );
    const payload = vi.mocked(jobApi.compare).mock.calls[0][0];
    expect(payload.review.candidate_confirmed).toBe(true);
    expect(payload.review.requirements_reviewed).toBe(true);
    expect(payload.candidate).toEqual(payload.review.candidate_snapshot);
    expect(payload.requirements).toEqual(payload.review.requirement_snapshot);
    expect(payload.job_analysis.requirements[0].origin).toBe(
      "technical_environment",
    );
    expect(payload.requirements[0].classification).toBe("unspecified");
    expect(payload.candidate).not.toHaveProperty("full_name");
    expect(payload.candidate).not.toHaveProperty("email");
    expect(payload.candidate.experience[0]).not.toHaveProperty("company");
    expect(payload.candidate.experience[0]).not.toHaveProperty("location");
    expect(payload.candidate.education[0]).not.toHaveProperty("institution");
    expect(storage).not.toHaveBeenCalled();
  });

  it("selects every awaiting profile and preserves selection through its confirmation and comparison", async () => {
    const blair = structuredClone(syntheticProfile);
    blair.candidate.full_name = "Blair Fictional";
    blair.candidate.email = "blair@example.com";
    blair.candidate.experience[0].job_title = "Blair reviewed developer";
    const casey = structuredClone(syntheticProfile);
    casey.candidate.full_name = "Casey Fictional";
    casey.candidate.email = "casey@example.com";
    casey.candidate.experience[0].job_title = "Casey reviewed analyst";
    vi.mocked(api.parse)
      .mockResolvedValueOnce(structuredClone(syntheticProfile))
      .mockResolvedValueOnce(blair)
      .mockResolvedValueOnce(casey);
    const profiles = [
      { id: "profile-1", name: "Alex Example", email: "alex@example.com", position: "Developer" },
      { id: "profile-2", name: "Blair Fictional", email: "blair@example.com", position: "Blair reviewed developer" },
      { id: "profile-3", name: "Casey Fictional", email: "casey@example.com", position: "Casey reviewed analyst" },
    ];
    const user = userEvent.setup();
    open();
    for (const [index, profile] of profiles.entries()) {
      if (index > 0)
        await user.click(
          screen.getByRole("button", { name: "Upload another CV" }),
        );
      await upload(user, profile.name);
    }
    await navigateToJobs(user);
    expect(screen.getByLabelText("Candidate profile")).toBeEnabled();
    expect(
      within(screen.getByRole("region", { name: "Awaiting review" })).getAllByRole(
        "article",
      ),
    ).toHaveLength(3);
    expect(
      within(screen.getByLabelText("Candidate profile")).getAllByRole("option"),
    ).toHaveLength(4);
    await analyze(user);
    await reviewRequirements(user);
    for (const [index, profile] of profiles.entries()) {
      const awaiting = screen.getByRole("region", { name: "Awaiting review" });
      const card = within(awaiting).getByRole("article", {
        name: `Awaiting review ${profile.id}`,
      });
      const supplementaryAction = within(card).getByRole("link", {
        name: `Review profile: ${profile.name}`,
      });
      expect(supplementaryAction).toHaveAttribute("href", `/candidates/${profile.id}`);
      expect(supplementaryAction).toHaveTextContent("Review profile");
      const pendingOption = within(screen.getByLabelText("Candidate profile")).getByRole(
        "option",
        { name: new RegExp(`${profile.name}.*Awaiting review`) },
      );
      expect(pendingOption).toBeEnabled();
      await user.selectOptions(screen.getByLabelText("Candidate profile"), pendingOption);
      expect(screen.getByLabelText("Candidate profile")).toHaveValue(profile.id);
      expect(pendingOption).toHaveProperty("selected", true);
      expect(
        screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Compare evidence" })).toBeDisabled();
      expect(
        screen.getByRole("region", { name: "Comparison availability" }),
      ).toHaveTextContent("This candidate must be reviewed and confirmed before comparison.");
      expect(
        screen.getByRole("checkbox", { name: /I reviewed the requirement wording/ }),
      ).toBeChecked();
      const action = screen.getByRole("link", { name: "Review selected candidate" });
      expect(action).toHaveAttribute("href", `/candidates/${profile.id}`);
      expect(jobApi.compare).toHaveBeenCalledTimes(index);
      await user.click(action);
      await screen.findByRole("heading", { name: profile.name });
      await user.click(
        screen.getByRole("button", { name: "Review & correct profile" }),
      );
      expect(screen.getByLabelText("Email")).toHaveValue(profile.email);
      await user.click(
        screen.getByRole("checkbox", { name: /I reviewed the fields/ }),
      );
      await user.click(
        screen.getByRole("button", { name: "Confirm reviewed profile" }),
      );
      await user.click(
        await screen.findByRole("link", { name: "Continue to Job Analysis" }),
      );
      const dropdown = screen.getByLabelText("Candidate profile");
      expect(dropdown).toBeEnabled();
      const options = within(dropdown).getAllByRole("option");
      expect(options).toHaveLength(4);
      expect(options.filter((option) => option.getAttribute("value") !== "")).toHaveLength(
        3,
      );
      expect(
        within(dropdown).getByRole("option", {
          name: new RegExp(`${profile.name}.*Confirmed review`),
        }),
      ).toBeEnabled();
      expect(dropdown).toHaveValue(profile.id);
      expect(
        screen.getByRole("link", { name: "Revisit candidate profile" }),
      ).toHaveAttribute("href", `/candidates/${profile.id}`);
      expect(
        screen.queryByRole("article", { name: `Awaiting review ${profile.id}` }),
      ).not.toBeInTheDocument();
      const remaining = profiles.slice(index + 1);
      if (remaining.length) {
        expect(
          within(screen.getByRole("region", { name: "Awaiting review" })).getAllByRole(
            "article",
          ),
        ).toHaveLength(remaining.length);
        for (const pending of remaining)
          expect(
            within(dropdown).getByRole("option", {
              name: new RegExp(`${pending.name}.*Awaiting review`),
            }),
          ).toBeEnabled();
      } else {
        expect(
          screen.queryByRole("region", { name: "Awaiting review" }),
        ).not.toBeInTheDocument();
      }
      expect(screen.getByLabelText("Requirement text req-001")).toHaveValue(
        environmentRequirement.text,
      );
      expect(
        screen.getByRole("checkbox", { name: /I reviewed the requirement wording/ }),
      ).toBeChecked();
      await user.click(screen.getByRole("button", { name: "Source description" }));
      expect(screen.getByLabelText("Job description")).toHaveValue(environmentText);
      await user.click(screen.getByRole("button", { name: "Reviewed requirements" }));
      expect(screen.getByRole("button", { name: "Compare evidence" })).toBeEnabled();
      await user.click(screen.getByRole("button", { name: "Compare evidence" }));
      await screen.findByRole("heading", { name: "Requirement evidence checklist" });
      const payload = vi.mocked(jobApi.compare).mock.calls[index][0];
      expect(payload.candidate.experience[0].job_title).toBe(profile.position);
      expect(payload.review.candidate_confirmed).toBe(true);
      expect(payload.review.requirements_reviewed).toBe(true);
      expect(payload.candidate).toEqual(payload.review.candidate_snapshot);
      expect(payload.requirements).toEqual(payload.review.requirement_snapshot);
    }
    expect(api.parse).toHaveBeenCalledTimes(3);
    expect(jobApi.compare).toHaveBeenCalledTimes(3);
  });

  it("allows selecting an unreviewed profile and blocks comparison until it is confirmed", async () => {
    const user = userEvent.setup();
    open();
    await upload(user);
    await navigateToJobs(user);
    const dropdown = screen.getByLabelText("Candidate profile");
    expect(dropdown).toBeEnabled();
    expect(
      within(dropdown).getByRole("option", { name: /Alex Example.*Awaiting review/ }),
    ).toBeEnabled();
    await user.selectOptions(dropdown, "profile-1");
    expect(dropdown).toHaveValue("profile-1");
    const awaiting = screen.getByRole("region", { name: "Awaiting review" });
    expect(
      within(awaiting).getByRole("article", {
        name: "Awaiting review profile-1",
      }),
    ).toHaveTextContent("Alex Example");
    await analyze(user);
    await reviewRequirements(user);
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent("This candidate must be reviewed and confirmed before comparison.");
    expect(
      screen.getByRole("link", { name: "Review selected candidate" }),
    ).toHaveAttribute("href", "/candidates/profile-1");
    expect(
      within(awaiting).getByRole("link", {
        name: "Review profile: Alex Example",
      }),
    ).toHaveAttribute("href", "/candidates/profile-1");
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(jobApi.compare).not.toHaveBeenCalled();
    expect(
      within(dropdown).getByRole("option", { name: /Alex Example.*Awaiting review/ }),
    ).toHaveProperty("selected", true);
  });

  it("preserves the selected profile and job review while confirming through the selected action", async () => {
    const user = userEvent.setup();
    open();
    await upload(user);
    await navigateToJobs(user);
    await user.selectOptions(screen.getByLabelText("Candidate profile"), "profile-1");
    await analyze(user);
    await reviewRequirements(user);
    await user.click(screen.getByRole("link", { name: "Review selected candidate" }));
    await confirm(user);
    await user.click(
      screen.getByRole("link", { name: "Continue to Job Analysis" }),
    );
    expect(screen.getByLabelText("Requirement text req-001")).toHaveValue(
      environmentRequirement.text,
    );
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).toBeChecked();
    expect(
      screen.getByRole("option", { name: /Alex Example.*Confirmed review/ }),
    ).toBeEnabled();
    expect(
      screen.queryByRole("region", { name: "Awaiting review" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Candidate profile")).toBeEnabled();
    expect(screen.getByLabelText("Candidate profile")).toHaveValue("profile-1");
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
  });

  it("invalidates old comparison after profile edits and permits comparison after reconfirmation", async () => {
    const user = userEvent.setup();
    open();
    await upload(user);
    await confirm(user);
    await navigateToJobs(user);
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    await analyze(user);
    await reviewRequirements(user);
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    await user.click(
      screen.getByRole("link", { name: "Revisit candidate profile" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Review & correct profile" }),
    );
    fireEvent.change(screen.getByLabelText("Position"), {
      target: { value: "Reviewed developer" },
    });
    await user.click(screen.getByRole("button", { name: "Save corrections" }));
    expect(
      screen.getByRole("heading", { name: "Human review required" }),
    ).toBeInTheDocument();
    await navigateToJobs(user);
    expect(
      screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Comparison results" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent("This candidate must be reviewed and confirmed before comparison.");
    const dropdown = screen.getByLabelText("Candidate profile");
    expect(dropdown).toBeEnabled();
    expect(dropdown).toHaveValue("profile-1");
    expect(
      within(dropdown).queryByRole("option", {
        name: /Alex Example.*Confirmed review/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(dropdown).getByRole("option", { name: /Alex Example.*Awaiting review/ }),
    ).toBeEnabled();
    expect(
      screen.getByRole("region", { name: "Awaiting review" }),
    ).toHaveTextContent("Alex Example");
    expect(jobApi.compare).toHaveBeenCalledTimes(1);
    await user.click(
      screen.getByRole("link", { name: "Review selected candidate" }),
    );
    await confirm(user);
    await navigateToJobs(user);
    expect(
      screen.getByRole("option", { name: /Alex Example.*Confirmed review/ }),
    ).toBeEnabled();
    expect(screen.getByLabelText("Candidate profile")).toHaveValue("profile-1");
    expect(
      screen.queryByRole("region", { name: "Awaiting review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expect(
      vi.mocked(jobApi.compare).mock.calls[1][0].candidate.experience[0]
        .job_title,
    ).toBe("Reviewed developer");
  });

  it("clears requirement confirmation after a wording edit and requires another review", async () => {
    const user = userEvent.setup();
    open();
    await upload(user);
    await confirm(user);
    await navigateToJobs(user);
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    await analyze(user);
    await reviewRequirements(user);
    fireEvent.change(screen.getByLabelText("Requirement text req-001"), {
      target: { value: "Azure AI / Azure OpenAI " },
    });
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    await reviewRequirements(user);
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expect(
      vi.mocked(jobApi.compare).mock.calls[0][0].requirements[0].text,
    ).toBe(environmentRequirement.text);
  });

  it("explains which requirement needs wording before allowing review and comparison", async () => {
    const user = userEvent.setup();
    open();
    await upload(user);
    await confirm(user);
    await navigateToJobs(user);
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    await analyze(user);
    fireEvent.change(screen.getByLabelText("Requirement text req-001"), {
      target: { value: " " },
    });
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent(/Enter requirement text for req-001/);
    expect(jobApi.compare).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Requirement text req-001"), {
      target: { value: environmentRequirement.text },
    });
    await reviewRequirements(user);
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
  });

  it("displays an actual structured HTTP 422 response and keeps review available for correction", async () => {
    vi.mocked(jobApi.compare).mockRestore();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: [
            {
              loc: ["body", "review", "candidate_snapshot"],
              msg: "Reviewed candidate snapshot does not match the submitted qualifications.",
              type: "value_error",
            },
          ],
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    open();
    await upload(user);
    await confirm(user);
    await navigateToJobs(user);
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    await analyze(user);
    await reviewRequirements(user);
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Reviewed candidate snapshot does not match the submitted qualifications.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "review.candidate_snapshot:",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Open the selected profile, correct the listed qualification fields and confirm it again.",
    );
    expect(
      screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Requirement text req-001")).toHaveValue(
      environmentRequirement.text,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/jobs/compare"),
      expect.objectContaining({ method: "POST" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Compare evidence" }),
      ).toBeEnabled(),
    );
  });

  it("recovers from a structured source mismatch by analyzing and reviewing fresh job evidence", async () => {
    vi.mocked(jobApi.compare).mockRestore();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: {
              code: "source_mismatch",
              message: "The job analysis differs from fresh source extraction.",
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(environmentComparison), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    open();
    await upload(user);
    await confirm(user);
    await navigateToJobs(user);
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    await analyze(user);
    await reviewRequirements(user);
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Select Analyze requirements again, review the fresh excerpts and confirm the job review before retrying.",
    );
    expect(screen.getByLabelText("Job description")).toHaveValue(
      environmentText,
    );
    expect(screen.getByLabelText("Candidate profile")).toHaveValue("profile-1");
    expect(
      screen.queryByRole("heading", { name: "Requirement evidence checklist" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Analyze requirements" }),
    );
    await screen.findByLabelText("Requirement text req-001");
    expect(
      screen.getByRole("checkbox", {
        name: /I reviewed the requirement wording/,
      }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    await reviewRequirements(user);
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(jobApi.analyze).toHaveBeenCalledTimes(2);
    const submitted = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(submitted.job_analysis).toEqual(environmentAnalysis);
    expect(submitted.review.requirements_reviewed).toBe(true);
  });

  it("blocks comparison for 101 experience technologies and resumes after correction and reconfirmation", async () => {
    const user = userEvent.setup();
    open();
    await upload(user);
    await user.click(
      screen.getByRole("button", { name: "Review & correct profile" }),
    );
    const technologies = screen.getAllByLabelText(
      "Technologies (comma separated)",
    )[0];
    const oversized = [
      "Python",
      ...Array.from({ length: 100 }, (_, index) => `fictional${index}`),
    ];
    fireEvent.change(technologies, { target: { value: oversized.join(", ") } });
    await user.click(
      screen.getByRole("checkbox", { name: /I reviewed the fields/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm reviewed profile" }),
    );
    await screen.findByRole("heading", { name: "Profile confirmed" });
    await navigateToJobs(user);
    await user.selectOptions(
      screen.getByLabelText("Candidate profile"),
      "profile-1",
    );
    await analyze(user);
    await reviewRequirements(user);
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("region", { name: "Comparison availability" }),
    ).toHaveTextContent(
      "Experience 1 lists 101 technologies. Comparison accepts at most 100; review the profile and remove extra entries.",
    );
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    expect(jobApi.compare).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("link", { name: "Revisit candidate profile" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Review & correct profile" }),
    );
    const savedTechnologies = screen.getAllByLabelText(
      "Technologies (comma separated)",
    )[0];
    expect(savedTechnologies).toHaveValue(oversized.join(", "));
    fireEvent.change(savedTechnologies, {
      target: { value: oversized.slice(0, 100).join(", ") },
    });
    await user.click(
      screen.getByRole("checkbox", { name: /I reviewed the fields/ }),
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm reviewed profile" }),
    );
    await screen.findByRole("heading", { name: "Profile confirmed" });
    await navigateToJobs(user);
    expect(
      screen.getByRole("button", { name: "Compare evidence" }),
    ).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Compare evidence" }));
    await screen.findByRole("heading", {
      name: "Requirement evidence checklist",
    });
    expect(
      vi.mocked(jobApi.compare).mock.calls[0][0].candidate.experience[0]
        .technologies,
    ).toHaveLength(100);
  });
});
