import { describe, expect, it, vi } from "vitest";
import {
  getSegmentMaterialCandidates,
  getVideoProjectJob,
  recomposeSegmentMaterial,
} from "../video-project-client";

describe("video project client", () => {
  it("uses the scoped candidate endpoint with the caller token", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      scope: "local",
      segment_id: "scene-1",
      groups: { current: [], recommended: [], library: [], public: [] },
      provider_statuses: [],
      next_cursor: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await getSegmentMaterialCandidates({ token: "token", projectAssetId: 7, segmentId: "scene-1", scope: "local" });

    expect(new URL(String(fetchMock.mock.calls[0]?.[0])).pathname).toBe(
      "/v1/video/projects/7/segments/scene-1/material-candidates",
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer token" });
    vi.unstubAllGlobals();
  });

  it("keeps timeline_dirty as an explicit confirmation instead of treating it as a failed job", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      detail: { code: "timeline_dirty", message: "会覆盖手工剪辑" },
    }), { status: 409, headers: { "Content-Type": "application/json" } })));

    await expect(recomposeSegmentMaterial({
      token: "token", projectAssetId: 7, segmentId: "scene-1", candidateId: "candidate-1",
    })).resolves.toEqual({ kind: "confirm_overwrite", message: "会覆盖手工剪辑" });
    vi.unstubAllGlobals();
  });

  it("returns the persisted job state for callers to wait before reloading an edited project", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "job-7", asset_id: 7, status: "running", workflow_stage: "video_rendering", error_message: null, project: null,
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(getVideoProjectJob({ token: "token", jobId: "job-7" })).resolves.toMatchObject({
      id: "job-7", status: "running",
    });
    vi.unstubAllGlobals();
  });
});
