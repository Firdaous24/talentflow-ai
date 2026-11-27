import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { api } from "../api";
import { buildDemoCvPdf, DEMO_FILENAME, DEMO_JOB } from "../demo";
import { syntheticProfile } from "./fixtures";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { health: vi.fn(), parse: vi.fn(), extractionConfig: vi.fn() },
}));
beforeEach(() => {
  vi.mocked(api.health).mockResolvedValue({ status: "ok" });
  vi.mocked(api.extractionConfig).mockResolvedValue({ available: false, provider: null, destination: null, model: null, connectivity: "not_checked" });
  vi.mocked(api.parse).mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("Demo mode", () => {
  it("builds a structurally valid, fictional PDF with exact cross-reference offsets", () => {
    const text = new TextDecoder().decode(buildDemoCvPdf());
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...text.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    expect(offsets).toHaveLength(6);
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
    // Fictional person and reserved example domain only.
    expect(text).toContain("Juno Fictional");
    expect(text).toContain("example.com");
    expect(text).not.toMatch(/@(?!example\.com)[a-z0-9-]+\.[a-z]{2,}/i);
    expect(DEMO_JOB).toContain("are required");
  });

  it("parses the demo CV through the normal API, opens human review and prefills the sample job without storing anything", { timeout: 20000 }, async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    vi.mocked(api.parse).mockResolvedValue({ ...syntheticProfile, candidate: { ...syntheticProfile.candidate, full_name: "Juno Fictional" } });
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Try with fictional data" }));

    expect(api.parse).toHaveBeenCalledTimes(1);
    const [file, consent] = vi.mocked(api.parse).mock.calls[0];
    expect(file.name).toBe(DEMO_FILENAME);
    expect(file.type).toBe("application/pdf");
    expect(consent).toBeUndefined();

    // The review gate is not bypassed: the profile is unconfirmed on arrival.
    // Parsing, then a router transition into the heavy review page: measured at ~0.2-0.5 s after the click in jsdom.
    expect(await screen.findByRole("heading", { name: "Candidate profile" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & correct profile" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Profile confirmed" })).not.toBeInTheDocument();
    expect(screen.getByText(/Fictional CV parsed\. Review and confirm the profile/)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Job Analysis" }));
    expect(screen.getByLabelText("Job description")).toHaveValue(DEMO_JOB);
    const prerequisites = screen.getByRole("region", { name: "Comparison availability" });
    expect(within(prerequisites).getByText("Complete these steps to compare evidence")).toBeInTheDocument();
    expect(storage).not.toHaveBeenCalled();
  });

  it("reports a parsing failure without leaving a partial demo", async () => {
    vi.mocked(api.parse).mockRejectedValue(new Error("Backend offline."));
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Try with fictional data" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Backend offline. Check that the local API is running");
    expect(screen.getByRole("heading", { name: "A clearer view of talent." })).toBeInTheDocument();
    expect(screen.getByText("Your workspace is ready")).toBeInTheDocument();
  });
});
