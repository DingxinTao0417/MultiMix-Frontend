import { describe, expect, it, vi } from "vitest";

import {
  captureRenderedReviewFrames,
  deriveSceneReviewWindows,
  isRenderedReviewExportReady,
  shouldCaptureRenderedReview,
  shouldPollRenderedReview,
  type RenderedReviewEditor,
  type RenderedReviewState,
} from "./renderedReview";

function fakeEditor() {
  const captureFrame = vi.fn(async ({ time }: { time: number }) => ({
    success: true as const,
    blob: new Blob([String(time)], { type: "image/png" }),
    filename: `frame-${time}.png`,
  }));
  const editor: RenderedReviewEditor = {
    renderer: { captureFrame },
  };
  return { editor, captureFrame };
}

describe("rendered review frame capture", () => {
  it("captures start, middle and end samples in scene order", async () => {
    const { editor, captureFrame } = fakeEditor();

    const captures = await captureRenderedReviewFrames(editor, [
      { sceneId: "seg-1", startTime: 0, duration: 8 },
      { sceneId: "seg-2", startTime: 8, duration: 6 },
    ]);

    expect(captures.map((item) => item.sceneId)).toEqual([
      "seg-1",
      "seg-1",
      "seg-1",
      "seg-2",
      "seg-2",
      "seg-2",
    ]);
    expect(captureFrame.mock.calls.map(([value]) => value.time)).toEqual([
      0.4,
      4,
      7.6,
      8.3,
      11,
      13.7,
    ]);
    expect(captureFrame.mock.calls.map(([value]) => value.mimeType)).toEqual(
      Array(6).fill("image/jpeg"),
    );
    expect(captureFrame.mock.calls.map(([value]) => value.quality)).toEqual(
      Array(6).fill(0.86),
    );
  });

  it("never captures more than 24 frames", async () => {
    const { editor } = fakeEditor();
    const windows = Array.from({ length: 12 }, (_, index) => ({
      sceneId: `seg-${index + 1}`,
      startTime: index * 2,
      duration: 2,
    }));

    const captures = await captureRenderedReviewFrames(editor, windows);

    expect(captures).toHaveLength(24);
    expect(new Set(captures.map((item) => item.sceneId))).toHaveLength(12);
  });

  it("fails the batch instead of silently omitting a failed frame", async () => {
    const editor: RenderedReviewEditor = {
      renderer: {
        captureFrame: vi.fn(async () => ({
          success: false as const,
          error: "canvas unavailable",
        })),
      },
    };

    await expect(
      captureRenderedReviewFrames(editor, [
        { sceneId: "seg-1", startTime: 0, duration: 4 },
      ]),
    ).rejects.toThrow("canvas unavailable");
  });

  it("derives windows from the final main video track and ignores overlays", () => {
    expect(
      deriveSceneReviewWindows({
        metadata: { title: "demo", duration: 10 },
        settings: { fps: 30, width: 1920, height: 1080 },
        media: [],
        tracks: [
          {
            id: "main",
            type: "video",
            name: "main",
            elements: [
              {
                id: "v1",
                type: "video",
                startTime: 0,
                duration: 4,
                segmentId: "seg-1",
              },
              {
                id: "v2",
                type: "image",
                startTime: 4,
                duration: 6,
                segmentId: "seg-2",
              },
            ],
          },
          {
            id: "mg",
            type: "video",
            name: "overlay",
            overlay: true,
            elements: [
              {
                id: "mg1",
                type: "video",
                startTime: 0,
                duration: 10,
                segmentId: "seg-1",
              },
            ],
          },
        ],
      }),
    ).toEqual([
      { sceneId: "seg-1", startTime: 0, duration: 4 },
      { sceneId: "seg-2", startTime: 4, duration: 6 },
    ]);
  });
});

describe("rendered review lifecycle", () => {
  const review = (
    status: RenderedReviewState["status"],
    projectFingerprint = "a".repeat(64),
  ): RenderedReviewState => ({
    status,
    project_fingerprint: projectFingerprint,
    attempt: 1,
    issues: [],
  });

  it.each(["pending", "reviewing", "stale"] as const)(
    "captures or resumes frames from %s",
    (status) => {
      expect(shouldCaptureRenderedReview(review(status))).toBe(true);
    },
  );

  it("does not capture while a current MG overlay can still change pixels", () => {
    expect(shouldCaptureRenderedReview(review("pending"), false)).toBe(false);
    expect(shouldCaptureRenderedReview(review("pending"), true)).toBe(true);
  });

  it("polls only while a targeted repair is running", () => {
    expect(shouldPollRenderedReview(review("repairing"))).toBe(true);
    expect(shouldPollRenderedReview(review("pending"))).toBe(false);
    expect(shouldPollRenderedReview(review("passed"))).toBe(false);
  });

  it("unlocks export only for a passed review of the exact project", () => {
    const fingerprint = "a".repeat(64);

    expect(isRenderedReviewExportReady(false, null, "")).toBe(true);
    expect(isRenderedReviewExportReady(true, review("passed"), fingerprint)).toBe(true);
    expect(isRenderedReviewExportReady(true, review("pending"), fingerprint)).toBe(false);
    expect(
      isRenderedReviewExportReady(
        true,
        review("passed", "b".repeat(64)),
        fingerprint,
      ),
    ).toBe(false);
  });
});
