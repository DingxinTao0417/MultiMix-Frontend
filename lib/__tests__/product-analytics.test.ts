// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getProductAnalyticsSessionId,
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
});
