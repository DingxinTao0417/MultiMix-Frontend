import { describe, expect, it, vi } from "vitest";
import { createProjectLoadDiagnostic, type ProjectLoadEvent, type ProjectLoadOptions } from "../project-load-diagnostics";

describe("project load diagnostic privacy and isolation", () => {
  it("writes readable JSON text through the default console collector", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      createProjectLoadDiagnostic({ embedded: true, online: true, apiSameOrigin: false });
      const [tag, raw] = info.mock.calls[0];
      expect(tag).toBe("[EditorLoad]");
      expect(typeof raw).toBe("string");
      expect(JSON.parse(raw)).toMatchObject({ phase: "mounted", embedded: true, online: true, api_same_origin: false });
    } finally { info.mockRestore(); }
  });

  it("constructs an allowlisted event without copying input or error text", () => {
    const events: ProjectLoadEvent[] = [];
    const options = { embedded: true, online: true, apiSameOrigin: false, token: "secret-token", url: "private-url" };
    const trace = createProjectLoadDiagnostic(options, (event) => events.push(event));
    trace.stage("request_started");
    trace.fail(new TypeError("secret-token private-url private-response"));
    expect(events.at(-1)).toMatchObject({ phase: "failed", failed_at: "request_started", error_kind: "type_error" });
    expect(JSON.stringify(events)).not.toMatch(/secret-token|private-url|private-response/);
    expect(Object.keys(events[0]).sort()).toEqual(["api_same_origin", "embedded", "id", "online", "phase", "timestamp"]);
    expect(new Set(events.map((event) => event.id)).size).toBe(1);
  });

  it("keeps HTTP failure evidence separate from transport failure", () => {
    const events: ProjectLoadEvent[] = [];
    const trace = createProjectLoadDiagnostic({ embedded: false, online: true, apiSameOrigin: false }, (event) => events.push(event));
    trace.stage("request_started");
    trace.stage("response_received", 401);
    trace.fail(new Error("Authorization: private"));
    expect(events.at(-1)).toMatchObject({ failed_at: "response_received", error_kind: "error", http_status: 401 });
  });

  it.each([
    [new DOMException("private", "AbortError"), "abort_error"],
    [new SyntaxError("private JSON"), "syntax_error"],
    [{ message: "private", name: "Bearer token" }, "unknown_error"],
  ])("does not expose arbitrary error properties", (error, kind) => {
    const events: ProjectLoadEvent[] = [];
    const trace = createProjectLoadDiagnostic({ embedded: true, online: false, apiSameOrigin: true }, (event) => events.push(event));
    trace.fail(error);
    expect(events.at(-1)?.error_kind).toBe(kind);
    expect(JSON.stringify(events)).not.toMatch(/private|Bearer/);
  });

  it("cannot interrupt the product when logging is unavailable", () => {
    const trace = createProjectLoadDiagnostic({ embedded: true, online: true, apiSameOrigin: false }, () => { throw new Error("logger failed"); });
    expect(() => { trace.stage("request_started"); trace.fail(new TypeError()); trace.pageHide(); trace.unmount(); }).not.toThrow();
  });

  it("rejects arbitrary stages and invalid HTTP values at runtime", () => {
    const events: ProjectLoadEvent[] = [];
    const trace = createProjectLoadDiagnostic({ embedded: "private" } as unknown as ProjectLoadOptions, (event) => events.push(event));
    trace.stage("Bearer private" as "request_started", NaN);
    trace.stage("response_received", 9999);
    expect(events).toHaveLength(2);
    expect(events[0].embedded).toBe(false);
    expect(events[1].http_status).toBeUndefined();
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("preserves the failure boundary when a frame unloads during a request", () => {
    const events: ProjectLoadEvent[] = [];
    const trace = createProjectLoadDiagnostic({ embedded: true, online: true, apiSameOrigin: true }, (event) => events.push(event));
    trace.stage("request_started");
    trace.pageHide();
    trace.unmount();
    trace.unmount();
    trace.fail(new TypeError("private"));
    expect(events.map((event) => event.phase)).toEqual(["mounted", "request_started", "page_hidden", "unmounted", "failed"]);
    expect(events.at(-1)).toMatchObject({ failed_at: "request_started", after_unmount: true });
  });
});
