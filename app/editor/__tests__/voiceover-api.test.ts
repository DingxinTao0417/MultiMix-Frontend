import { afterEach, describe, expect, it, vi } from "vitest";

import {
  VoiceoverApiError,
  submitVoicePreview,
  type VoiceRequestArgs,
} from "../voiceover-api";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const baseArgs: VoiceRequestArgs = {
  assetId: "7",
  segmentId: "scene-1",
  token: "secret-token",
  draft: {
    narration: "修改后的口播",
    voiceName: "female_warm",
    voiceSpeed: 1,
    energy: "warm_clear",
    pronunciations: [],
  },
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("voiceover api", () => {
  it("uses VideoJobRead.id as the polling id", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({
        id: "video-job-123",
        asset_id: 7,
        status: "queued",
        workflow_stage: "video_project_queued",
        error_message: null,
        result: {},
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const job = await submitVoicePreview(baseArgs);

    expect(job.id).toBe("video-job-123");
    expect(job).not.toHaveProperty("public_id");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "/v1/video/projects/7/segments/scene-1/recompose",
      ),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
  });

  it("parses structured timeline conflicts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            detail: {
              code: "timeline_dirty",
              message: "会覆盖手工剪辑",
            },
          },
          409,
        ),
      ),
    );

    await expect(submitVoicePreview(baseArgs)).rejects.toMatchObject({
      code: "timeline_dirty",
      message: "会覆盖手工剪辑",
    } satisfies Partial<VoiceoverApiError>);
  });
});
