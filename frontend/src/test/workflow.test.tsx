import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { api } from "../api";
import { pdfFile, syntheticProfile } from "./fixtures";

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  api: { health: vi.fn(), parse: vi.fn(), extractionConfig: vi.fn() },
}));
beforeEach(() => {
  vi.mocked(api.extractionConfig).mockResolvedValue({
    available: false,
    provider: null,
    destination: null,
    model: null,
    connectivity: "not_checked",
  });
  vi.mocked(api.health).mockResolvedValue({ status: "ok" });
  vi.mocked(api.parse).mockReset();
});
afterEach(() => vi.restoreAllMocks());
function open(path = "/parser") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
function fileInput() {
  return document.querySelector<HTMLInputElement>("#cv-file")!;
}

describe("Human review and consent", () => {
  it("corrects missing fields, removes an entry, confirms, and keeps corrections in session navigation", async () => {
    vi.mocked(api.parse).mockResolvedValue(syntheticProfile);
    const user = userEvent.setup();
    open();
    await user.upload(fileInput(), pdfFile());
    await user.click(await screen.findByRole("button", { name: "Parse CV" }));
    await screen.findByText("Alex Example");
    await user.click(
      screen.getByRole("button", { name: "Review & correct profile" }),
    );
    const name = screen.getByLabelText("Full name");
    await user.clear(name);
    await user.type(name, "Alex Reviewed");
    await user.type(screen.getByLabelText("Phone"), "+212 612 345 678");
    await user.click(
      screen.getByRole("button", { name: "Remove experience 1" }),
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
    expect(
      screen.getByRole("heading", { name: "Profile confirmed" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Alex Reviewed" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Candidates" }));
    expect(
      screen.getByRole("heading", { name: "Alex Reviewed" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /Alex Reviewed/ }));
    expect(
      screen.getByRole("heading", { name: "Profile confirmed" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Review & correct profile" }),
    );
    expect(screen.getAllByText("User-corrected").length).toBeGreaterThan(0);
  });
  it("never requests a model without opt-in and resets consent for a new file", async () => {
    vi.mocked(api.extractionConfig).mockResolvedValue({
      available: true,
      provider: "openai-compatible",
      destination: "https://provider.example",
      model: "configured-test-model",
      connectivity: "not_checked",
    });
    vi.mocked(api.parse).mockResolvedValue(syntheticProfile);
    const user = userEvent.setup();
    open();
    await user.upload(fileInput(), pdfFile());
    const consent = await screen.findByRole("checkbox", {
      name: /I consent to sending/,
    });
    expect(consent).not.toBeChecked();
    await user.click(consent);
    await user.upload(fileInput(), pdfFile());
    expect(consent).not.toBeChecked();
    await user.click(consent);
    await user.click(screen.getByRole("button", { name: "Parse CV" }));
    await screen.findByText("Alex Example");
    expect(api.parse).toHaveBeenCalledWith(expect.any(File), true);
  });
});

describe("CV workflow", () => {
  it("uploads, displays all sections and warnings, and adds a session candidate", async () => {
    const user = userEvent.setup();
    vi.mocked(api.parse).mockResolvedValue(syntheticProfile);
    open();
    await user.upload(fileInput(), pdfFile());
    expect(await screen.findByText("synthetic.pdf")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Parse CV" }));
    expect(
      await screen.findByRole("heading", { name: "Alex Example" }),
    ).toBeInTheDocument();
    for (const title of [
      "Work experience",
      "Education",
      "Technical skills",
      "Projects",
      "Languages",
      "Certifications",
    ])
      expect(
        screen.getByRole("heading", { name: new RegExp(title) }),
      ).toBeInTheDocument();
    expect(
      screen.getByText("Synthetic extraction warning."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Candidates" }));
    expect(
      screen.getByRole("heading", { name: "Alex Example" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/exist only in browser memory/),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Clear session profiles" }),
    );
    expect(
      screen.getByText("No candidates in this session"),
    ).toBeInTheDocument();
  });
  it("shows loading, backend failure and allows retry", async () => {
    let fail: (error: Error) => void = () => undefined;
    vi.mocked(api.parse)
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      )
      .mockResolvedValueOnce(syntheticProfile);
    const user = userEvent.setup();
    open();
    await user.upload(fileInput(), pdfFile());
    await user.click(await screen.findByRole("button", { name: "Parse CV" }));
    expect(screen.getByRole("button", { name: /Extracting/ })).toBeDisabled();
    expect(
      screen.getByText("Reading your document. This may take a moment."),
    ).toBeInTheDocument();
    fail(new Error("Encrypted PDFs are not supported."));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Encrypted PDFs are not supported.",
    );
    await user.click(screen.getByRole("button", { name: "Parse CV" }));
    expect(await screen.findByText("Alex Example")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Upload another CV/ }));
    expect(screen.getByRole("button", { name: "Parse CV" })).toBeDisabled();
  });
  it("rejects invalid documents without calling the API", async () => {
    open();
    fireEvent.change(fileInput(), {
      target: {
        files: [new File(["bad"], "bad.pdf", { type: "application/pdf" })],
      },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "valid PDF header",
    );
    expect(api.parse).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Parse CV" })).toBeDisabled();
  });
  it("accepts drag and drop and rejects multiple files", async () => {
    open();
    const dropzone = screen.getByText(
      "Drag & drop your CV here",
    ).parentElement!;
    fireEvent.drop(dropzone, { dataTransfer: { files: [pdfFile()] } });
    expect(await screen.findByText("synthetic.pdf")).toBeInTheDocument();
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [pdfFile(), pdfFile()] },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("one PDF at a time");
  });
  it("starts a fresh workspace without persistence", async () => {
    const storage = vi.spyOn(Storage.prototype, "setItem");
    vi.mocked(api.parse).mockResolvedValue(syntheticProfile);
    const user = userEvent.setup();
    const first = open();
    await user.upload(fileInput(), pdfFile());
    await user.click(await screen.findByRole("button", { name: "Parse CV" }));
    await screen.findByText("Alex Example");
    expect(storage).not.toHaveBeenCalled();
    first.unmount();
    open("/candidates");
    expect(
      screen.getByText("No candidates in this session"),
    ).toBeInTheDocument();
  });
  it("shows backend connectivity and honest planned modules", async () => {
    vi.mocked(api.health).mockRejectedValue(new Error("Backend offline"));
    const user = userEvent.setup();
    open("/settings");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Backend offline",
    );
    vi.mocked(api.health).mockResolvedValue({ status: "ok" });
    await user.click(screen.getByRole("button", { name: "Check connection" }));
    await waitFor(() =>
      expect(screen.getAllByText("Backend connected")).toHaveLength(2),
    );
    await user.click(screen.getByRole("link", { name: "Job Matching" }));
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(
      screen.getByText(/Matching and scores are not available/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "AI Agents" }));
    expect(screen.getByText(/No AI agents are running/)).toBeInTheDocument();
  });
});
