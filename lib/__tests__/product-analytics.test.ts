// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getProductAnalyticsSessionId,
  isAllowedProductEvent,
  sanitizeProductEventProperties,
  trackProductEvent,
} from "../product-analytics";


describe("product analytics", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("drops unknown properties before sending", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await trackProductEvent("token", {
      eventName: "recommendation_selected",
      properties: {
        recommendation_key: "saved-assets-video",
        prompt: "secret",
      },
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      event_name: "recommendation_selected",
      properties: { recommendation_key: "saved-assets-video" },
    });
  });

  it.each(["video_active_interval", "director_active_interval"])("transmits %s bounds without leaking text", async (eventName) => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await trackProductEvent("token", { eventName, assetId: 42,
      sessionId: "anonymous-tab", properties: {
        interval_start_ms: 1790860000000, interval_end_ms: 1790860005000, prompt: "private",
      } });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      event_name: eventName, asset_id: 42, session_id: "anonymous-tab",
      properties: { interval_start_ms: 1790860000000, interval_end_ms: 1790860005000 },
    });
  });

  it("does not send unknown events or requests without a token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await trackProductEvent(null, { eventName: "workspace_opened" });
    await trackProductEvent("token", { eventName: "prompt_submitted" });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never rejects the product action when analytics is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));

    await expect(trackProductEvent("token", { eventName: "workspace_opened" })).resolves.toBeUndefined();
  });

  it("uses one anonymous session id for the current browser tab", () => {
    const first = getProductAnalyticsSessionId();
    const second = getProductAnalyticsSessionId();

    expect(first).toBeTruthy();
    expect(second).toBe(first);
    expect(window.sessionStorage.getItem("multimix_product_analytics_session")).toBe(first);
  });

  it("allowlists requirement events and removes raw requirement content", () => {
    expect(isAllowedProductEvent("requirement_confirmed_first_pass")).toBe(true);
    expect(isAllowedProductEvent("requirement_conflict_resolved")).toBe(true);
    expect(sanitizeProductEventProperties({
      snapshot_version: 3,
      conflict_severity: "blocking",
      question_required: false,
      raw_requirement_text: "customer private text",
      filename: "private-brief.docx",
    })).toEqual({
      snapshot_version: 3,
      conflict_severity: "blocking",
      question_required: false,
    });
  });
});
