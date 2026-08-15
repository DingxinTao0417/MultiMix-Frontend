// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLongFormCandidateContext,
  importLongFormSourceUrl,
  parseLongFormActionEvent,
  uploadLongFormSource,
  waitForLongFormSourceReady,
} from "../lib/long-form-client";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("long-form candidate client", () => {
  it("loads the public analysis then resolves a scoped source playback URL", async () => {
    const analysis = {
      schema_version: "long_form_candidate_set:v1",
      source_asset_id: 91,
      chapters: [],
      top_candidate_ids: ["candidate-1"],
      candidates: [{
        id: "candidate-1",
        title: "增长不能只看收入",
        why_publish: "观点完整",
        source_start_seconds: 12,
        source_end_seconds: 57,
        target_seconds: 45,
        core_quote: "增长不能只看收入",
        recommended_ratio: "9:16",
        visual_completeness: "complete",
        grounded: true,
      }],
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(analysis), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        playback_url: "/v1/long-form/media/signed-token",
        expires_in_seconds: 900,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    vi.stubGlobal("fetch", fetchMock);

    const context = await getLongFormCandidateContext("token", 92);

    expect(context.analysis).toEqual(analysis);
    expect(context.sourcePlaybackUrl).toBe("http://127.0.0.1:8199/v1/long-form/media/signed-token");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8199/v1/long-form/analyses/92");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:8199/v1/long-form/sources/91/playback");
  });

  it("accepts only an exact structured candidate selection event", () => {
    expect(parseLongFormActionEvent(new CustomEvent("multimix:long-form-action", {
      detail: { kind: "select", analysisAssetId: 92, candidateId: "candidate-1" },
    }))).toEqual({ kind: "select", analysisAssetId: 92, candidateId: "candidate-1" });

    expect(parseLongFormActionEvent(new CustomEvent("multimix:long-form-action", {
      detail: { kind: "select", analysisAssetId: "92", candidateId: "candidate-1" },
    }))).toBeNull();
  });

  it("streams upload progress through the dedicated long-form endpoint", async () => {
    class FakeXmlHttpRequest {
      upload: { onprogress?: (event: ProgressEvent) => void } = {};
      status = 201;
      statusText = "Created";
      responseText = JSON.stringify({ id: 91, title: "访谈第 12 期" });
      onerror?: () => void;
      onload?: () => void;
      open = vi.fn();
      setRequestHeader = vi.fn();
      send = vi.fn(() => {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 47,
          total: 100,
        } as ProgressEvent);
        this.onload?.();
      });
    }
    const request = new FakeXmlHttpRequest();
    vi.stubGlobal("XMLHttpRequest", vi.fn(function MockXmlHttpRequest() {
      return request;
    }));
    const progress = vi.fn();

    await expect(uploadLongFormSource(
      "token",
      new File(["video"], "episode.mp4", { type: "video/mp4" }),
      progress,
    )).resolves.toEqual({ id: 91, title: "访谈第 12 期" });

    expect(request.open).toHaveBeenCalledWith(
      "POST",
      "http://127.0.0.1:8199/v1/long-form/sources/upload",
    );
    expect(request.setRequestHeader).toHaveBeenCalledWith("Authorization", "Bearer token");
    expect(progress).toHaveBeenNthCalledWith(1, 47);
    expect(progress).toHaveBeenLastCalledWith(100);
  });

  it("creates a durable URL import and observes source readiness", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        asset_id: 93,
        job_id: "long-form-ingest-1",
        status: "queued",
        source_kind: "youtube",
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "long-form-ingest-1",
        asset_id: 93,
        status: "completed",
        error_message: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const imported = await importLongFormSourceUrl(
      "token",
      "https://www.youtube.com/watch?v=abc123",
    );
    const ready = await waitForLongFormSourceReady("token", imported.asset_id, new AbortController().signal);

    expect(imported.asset_id).toBe(93);
    expect(ready.status).toBe("completed");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8199/v1/long-form/sources/url");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:8199/v1/assets/93/ingest-jobs/latest");
  });
});
