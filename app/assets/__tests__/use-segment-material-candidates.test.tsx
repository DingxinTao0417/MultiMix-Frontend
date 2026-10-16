// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSegmentMaterialCandidates } from "../lib/use-segment-material-candidates";

afterEach(() => {
  vi.unstubAllGlobals();
});

function candidate(overrides: Record<string, unknown>) {
  return {
    candidate_id: "cand-1",
    source_type: "saved_asset",
    source_asset_id: 12,
    provider: "library",
    provider_item_id: "12",
    media_type: "image",
    title: "素材",
    preview_url: "",
    width: 0,
    height: 0,
    duration: 0,
    license: "",
    author: "",
    attribution_url: "",
    verification_status: "persisted",
    relevance_status: "recommended",
    relevance_reason: "",
    requires_trim: false,
    already_persisted: true,
    selectable: true,
    ...overrides,
  };
}

function localResponse(recommended: unknown[], library: unknown[] = []) {
  return {
    scope: "local",
    segment_id: "segment-1",
    groups: { current: [], recommended, library },
  };
}

const args = { token: "t", projectAssetId: 9100, segmentId: "segment-1", enabled: true };

describe("useSegmentMaterialCandidates", () => {
  it("loads only the user's library and never requests public material", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(localResponse(
      [candidate({ candidate_id: "rec-1" })],
      [candidate({ candidate_id: "lib-1", relevance_status: "library" })],
    )), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSegmentMaterialCandidates(args));

    await waitFor(() => expect(result.current.localLoading).toBe(false));
    expect(result.current.recommended.map((item) => item.id)).toEqual(["rec-1"]);
    expect(result.current.library.map((item) => item.id)).toEqual(["lib-1"]);
    expect(result.current.localError).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(url).toContain("scope=local");
    expect(url).not.toContain("scope=public");
    expect(Object.keys(result.current)).not.toEqual(
      expect.arrayContaining(["publicItems", "loadMorePublic"]),
    );
  });

  it("surfaces a local 404 without calling a deleted fallback endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "Segment not found." }), { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSegmentMaterialCandidates(args));

    await waitFor(() => expect(result.current.localError).toBe("Segment not found."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.recommended).toEqual([]);
  });

  it("stays idle until it is enabled with a token, project and segment", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSegmentMaterialCandidates({ ...args, enabled: false }));

    expect(result.current.localLoading).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
