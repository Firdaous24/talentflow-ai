import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, MAX_PDF_BYTES, validatePdf } from "../api";
import { pdfFile, syntheticProfile } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());
describe("PDF validation", () => {
  it("accepts a PDF header and the exact size boundary", async () => {
    expect(await validatePdf(pdfFile())).toBeNull();
    const bytes = new Uint8Array(MAX_PDF_BYTES);
    bytes.set(new TextEncoder().encode("%PDF-"));
    expect(
      await validatePdf(
        new File([bytes], "boundary.pdf", { type: "application/pdf" }),
      ),
    ).toBeNull();
  });
  it("rejects wrong extension, empty, oversized and disguised files", async () => {
    expect(await validatePdf(new File(["%PDF-"], "wrong.txt"))).toMatch(
      /Choose a PDF/,
    );
    expect(await validatePdf(new File([], "empty.pdf"))).toMatch(/empty/);
    expect(
      await validatePdf(
        new File([new Uint8Array(MAX_PDF_BYTES + 1)], "large.pdf"),
      ),
    ).toMatch(/5 MiB/);
    expect(await validatePdf(new File(["not PDF"], "pretend.pdf"))).toMatch(
      /header/,
    );
  });
});
describe("API client", () => {
  it("uses the actual multipart field without manually setting content-type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(syntheticProfile), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.parse(pdfFile())).toEqual(syntheticProfile);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/v1/candidates/parse");
    expect(options.method).toBe("POST");
    expect(options.body.get("file").name).toBe("synthetic.pdf");
    expect(options.headers).toBeUndefined();
  });
  it("reads health from the documented endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"status":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);
    expect(await api.health()).toEqual({ status: "ok" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/health");
  });
  it("preserves structured backend error messages and codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            '{"detail":{"code":"encrypted_pdf","message":"Encrypted PDFs are not supported."}}',
            { status: 422 },
          ),
        ),
    );
    await expect(api.parse(pdfFile())).rejects.toMatchObject({
      status: 422,
      code: "encrypted_pdf",
      message: "Encrypted PDFs are not supported.",
    });
  });
  it("handles FastAPI validation arrays", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"detail":[{"msg":"Field required"}]}', {
          status: 422,
        }),
      ),
    );
    await expect(api.parse(pdfFile())).rejects.toThrow("Field required");
  });
  it("reports network failures and non-JSON HTTP errors", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        new Response("<html>Bad gateway</html>", { status: 502 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.health()).rejects.toThrow("Unable to reach the backend");
    await expect(api.health()).rejects.toBeInstanceOf(ApiError);
  });
  it("times out a stalled request", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, options: RequestInit) =>
          new Promise((_resolve, reject) =>
            options.signal?.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            ),
          ),
      ),
    );
    try {
      const result = expect(api.health()).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(120_000);
      await result;
    } finally {
      vi.useRealTimers();
    }
  });
});
