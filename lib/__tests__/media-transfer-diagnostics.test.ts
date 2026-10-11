import { afterEach, describe, expect, it, vi } from "vitest";
import { observeMediaPage, parseRelayTiming, relayTimingHeader, reportMediaDiagnostic, type MediaDiagnostic } from "../media-transfer-diagnostics";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("bounded media timing evidence", () => {
  it("round-trips only the three canonical relay timings", () => {
    expect(parseRelayTiming(relayTimingHeader({ upstreamHeadersMs: 20, upstreamBodyMs: 40, relayMs: 60 })))
      .toEqual({ upstreamHeadersMs: 20, upstreamBodyMs: 40, relayMs: 60 });
  });

  it("does not emit an invalid timing header when a clock value is unavailable", () => {
    expect(relayTimingHeader({ upstreamHeadersMs: Number.NaN, upstreamBodyMs: 0, relayMs: 0 })).toBe("");
    expect(relayTimingHeader({ upstreamHeadersMs: 0, upstreamBodyMs: Number.POSITIVE_INFINITY, relayMs: 0 })).toBe("");
    expect(relayTimingHeader({ upstreamHeadersMs: -1, upstreamBodyMs: 0, relayMs: 0 })).toBe("");
  });

  it.each([
    null, "", "media_relay;dur=0", "media_headers;dur=NaN, media_body;dur=1, media_relay;dur=1",
    "media_headers;dur=-1, media_body;dur=1, media_relay;dur=1",
    "media_headers;dur=1, media_body;dur=1, media_relay;dur=2, media_relay;dur=3",
    "media_headers;dur=1, media_body;dur=1, media_relay;dur=2;desc=token",
    "media_headers;dur=1, media_body;dur=1, media_relay;dur=2, private;dur=3",
  ])("treats missing or malformed server evidence as unknown, not zero", value => {
    expect(parseRelayTiming(value)).toBeUndefined();
  });

  it("cannot serialize private inputs even when a caller supplies extra properties", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    reportMediaDiagnostic("MediaPart", { outcome: "received", responseWaitMs: 1, bodyReadMs: Number.NaN,
      token: "PRIVATE", url: "https://private.test", fileName: "secret.mp4", userId: 42,
      startVisibility: "PRIVATE" } as unknown as MediaDiagnostic);
    const record = String(info.mock.calls[0][0]);
    expect(JSON.parse(record.slice("[MediaPart] ".length))).toMatchObject({ outcome: "received", responseWaitMs: 1 });
    expect(record).not.toMatch(/PRIVATE|token|url|fileName|userId|bodyReadMs/);
  });

  it("logging failures cannot replace a media result with a diagnostic exception", () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("writer failed"); });
    vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("writer failed"); });
    expect(() => reportMediaDiagnostic("MediaRelay", { outcome: "delivered", receivedBytes: 4 })).not.toThrow();
    expect(() => reportMediaDiagnostic("MediaPart", { outcome: "failed", status: 504 })).not.toThrow();
  });

  it("observes actual lifecycle events and removes listeners after a part completes", () => {
    const page = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    vi.stubGlobal("document", page);
    const observer = observeMediaPage();
    page.dispatchEvent(new Event("freeze")); page.dispatchEvent(new Event("resume"));
    page.visibilityState = "visible";
    expect(observer.snapshot()).toEqual({ startVisibility: "hidden", endVisibility: "visible", freezeCount: 1, resumeCount: 1 });
    observer.dispose(); page.dispatchEvent(new Event("freeze"));
    expect(observer.snapshot().freezeCount).toBe(1);
  });
});
