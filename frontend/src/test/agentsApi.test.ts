import { afterEach, describe, expect, it, vi } from "vitest";
import { agentApi } from "../agentApi";
import { ApiError } from "../api";
import type { AgentWorkflowStart } from "../agentTypes";

afterEach(() => vi.unstubAllGlobals());
describe("Agent workflow API boundaries", () => {
  it("sends the in-memory capability in a header, preserves structured failures and discards rejected input", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: "workflow_failed", message: "Verification failed.", input: "private rejected fictional input", workflow: { status: "failed", steps: [{ node: "evidence_verification", status: "failed" }] } } }), { status: 422 }));
    vi.stubGlobal("fetch", fetch);
    const error = await agentApi.start("b".repeat(64), { request_revision: "revision-1", client_request_id: "0c8e27d8-8b47-41a3-8b29-4d34368dcbeb", comparison: {} } as AgentWorkflowStart).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toEqual({ workflow: { status: "failed", steps: [{ node: "evidence_verification", status: "failed" }] } });
    expect(JSON.stringify(error)).not.toContain("private rejected fictional input");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("/api/v1/agents/workflows");
    expect(url).not.toContain("b".repeat(64));
    expect(init.headers["X-Workflow-Session"]).toBe("b".repeat(64));
    expect(init.cache).toBe("no-store");
  });
  it("uses a read-only GET request for the workflow status", async () => {
    const fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ workflow_id: "example" }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await agentApi.status("a".repeat(64), "example");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/agents/workflows/example"]);
    expect(fetch.mock.calls.every(([, init]) => init.method === undefined && init.body === undefined)).toBe(true);
  });
});
