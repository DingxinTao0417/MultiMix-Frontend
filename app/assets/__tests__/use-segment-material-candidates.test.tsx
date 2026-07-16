// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
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

function localResponse(recommended: unknown[]) {
  return {
    scope: "local",
    segment_id: "segment-1",
    groups: { current: [], recommended, library: [], public: [] },
    provider_statuses: [],
    next_cursor: null,
  };
}

function publicResponse(publicItems: unknown[], nextCursor: string | null, statuses: unknown[] = []) {
  return {
    scope: "public",
    segment_id: "segment-1",
    groups: { current: [], recommended: [], library: [], public: publicItems },
    provider_statuses: statuses,
    next_cursor: nextCursor,
  };
}

const args = { token: "t", projectAssetId: 9100, segmentId: "segment-1", enabled: true };

describe("useSegmentMaterialCandidates", () => {
  it("loads local first, then public, keeping them independent", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=local")) {
        return new Response(JSON.stringify(localResponse([candidate({})])), { status: 200 });
      }
      return new Response(JSON.stringify(publicResponse([candidate({ candidate_id: "pub-1", source_type: "public_asset", source_asset_id: null })], "cursor-2", [{ provider: "pexels", status: "ok" }])), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSegmentMaterialCandidates(args));

    await waitFor(() => expect(result.current.recommended).toHaveLength(1));
    await waitFor(() => expect(result.current.publicItems).toHaveLength(1));
    expect(result.current.recommended[0]?.candidateId).toBe("cand-1");
    expect(result.current.publicItems[0]?.candidateId).toBe("pub-1");
    expect(result.current.hasMorePublic).toBe(true);
  });

  it("keeps local candidates when the public search fails", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=local")) {
        return new Response(JSON.stringify(localResponse([candidate({})])), { status: 200 });
      }
      return new Response(JSON.stringify({ detail: "boom" }), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSegmentMaterialCandidates(args));

    await waitFor(() => expect(result.current.recommended).toHaveLength(1));
    await waitFor(() => expect(result.current.publicError).not.toBe(""));
    expect(result.current.recommended).toHaveLength(1);
    expect(result.current.publicItems).toEqual([]);
  });

  it("surfaces a local 404 without calling a deleted fallback endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ detail: "segment not found" }), { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSegmentMaterialCandidates(args));

    await waitFor(() => expect(result.current.localError).toBe("segment not found"));
    expect(result.current.recommended).toEqual([]);
    expect(result.current.publicItems).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("appends and dedupes the next public page on load more", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("scope=local")) {
        return new Response(JSON.stringify(localResponse([])), { status: 200 });
      }
      if (url.includes("cursor=cursor-2")) {
        return new Response(JSON.stringify(publicResponse([
          candidate({ candidate_id: "pub-1", source_type: "public_asset", source_asset_id: null }),
          candidate({ candidate_id: "pub-2", source_type: "public_asset", source_asset_id: null }),
        ], null)), { status: 200 });
      }
      return new Response(JSON.stringify(publicResponse([candidate({ candidate_id: "pub-1", source_type: "public_asset", source_asset_id: null })], "cursor-2")), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSegmentMaterialCandidates(args));

    await waitFor(() => expect(result.current.publicItems).toHaveLength(1));
    await act(async () => { result.current.loadMorePublic(); });
    await waitFor(() => expect(result.current.publicItems).toHaveLength(2));
    expect(result.current.publicItems.map((item) => item.candidateId)).toEqual(["pub-1", "pub-2"]);
    expect(result.current.hasMorePublic).toBe(false);
  });
});
