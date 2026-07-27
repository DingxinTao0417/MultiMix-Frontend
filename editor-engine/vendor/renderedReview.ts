import type { EditorCore } from "@editor/core";

import type { BackendProject } from "./buildProject";
import type { SnapshotResult } from "./editor/core/managers/renderer-manager";

export const MAX_RENDERED_REVIEW_FRAMES = 24;
export const RENDERED_REVIEW_FRAME_MIME_TYPE = "image/jpeg";
export const RENDERED_REVIEW_FRAME_QUALITY = 0.86;

export type SceneReviewWindow = {
  sceneId: string;
  startTime: number;
  duration: number;
};

export type RenderedReviewCapture = {
  sceneId: string;
  timestampSeconds: number;
  blob: Blob;
  filename: string;
};

export type RenderedReviewStatus =
  | "pending"
  | "reviewing"
  | "passed"
  | "blocked"
  | "unavailable"
  | "stale"
  | "repairing"
  | "blocked_requires_user_choice";

export type RenderedReviewIssue = {
  code: string;
  scene_id: string;
  severity: "warning" | "blocker";
  layer: string;
  reason: string;
  suggested_action: string;
  confidence: number;
};

export type RenderedReviewState = {
  status: RenderedReviewStatus;
  project_fingerprint: string;
  previous_review_fingerprint?: string;
  attempt: number;
  issues: RenderedReviewIssue[];
  repair_job_id?: string;
  repair_scene_id?: string;
  repair_operation?: string;
  repair_block_reason?: string;
  analysis_status?: string;
  model_status?: Record<string, unknown>;
};

export type RenderedReviewEditor = {
  renderer: Pick<EditorCore["renderer"], "captureFrame">;
};

export function shouldCaptureRenderedReview(
  review: RenderedReviewState,
  captureReady = true,
): boolean {
  return captureReady && ["pending", "reviewing", "stale"].includes(review.status);
}

export function shouldPollRenderedReview(review: RenderedReviewState): boolean {
  return review.status === "repairing";
}

export function isRenderedReviewExportReady(
  required: boolean,
  review: RenderedReviewState | null,
  projectFingerprint: string,
): boolean {
  if (!required) return true;
  return Boolean(
    review
    && review.status === "passed"
    && projectFingerprint
    && review.project_fingerprint === projectFingerprint
  );
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

function samplesPerScene(sceneCount: number): number {
  if (sceneCount < 1) return 0;
  if (sceneCount <= 8) return 3;
  if (sceneCount <= 12) return 2;
  if (sceneCount <= MAX_RENDERED_REVIEW_FRAMES) return 1;
  throw new Error(
    `Rendered review supports at most ${MAX_RENDERED_REVIEW_FRAMES} scenes`,
  );
}

function sampleTimes(window: SceneReviewWindow, count: number): number[] {
  const start = finiteNonNegative(window.startTime, "scene start time");
  const duration = finiteNonNegative(window.duration, "scene duration");
  if (duration <= 0) {
    throw new Error(`Scene ${window.sceneId} has no reviewable duration`);
  }
  if (count === 1) return [start + duration * 0.5];
  if (count === 2) return [start + duration * 0.05, start + duration * 0.95];
  return [
    start + duration * 0.05,
    start + duration * 0.5,
    start + duration * 0.95,
  ];
}

export function deriveSceneReviewWindows(
  project: BackendProject,
): SceneReviewWindow[] {
  const windows = new Map<string, { start: number; end: number }>();
  for (const track of project.tracks) {
    if (track.type !== "video" || track.overlay) continue;
    for (const element of track.elements) {
      const sceneId = element.segmentId?.trim();
      if (!sceneId) continue;
      const start = finiteNonNegative(element.startTime, "element start time");
      const duration = finiteNonNegative(element.duration, "element duration");
      if (duration <= 0) continue;
      const previous = windows.get(sceneId);
      windows.set(sceneId, {
        start: previous ? Math.min(previous.start, start) : start,
        end: previous ? Math.max(previous.end, start + duration) : start + duration,
      });
    }
  }
  return [...windows.entries()]
    .map(([sceneId, window]) => ({
      sceneId,
      startTime: window.start,
      duration: window.end - window.start,
    }))
    .sort(
      (left, right) =>
        left.startTime - right.startTime || left.sceneId.localeCompare(right.sceneId),
    );
}

export async function captureRenderedReviewFrames(
  editor: RenderedReviewEditor,
  windows: SceneReviewWindow[],
): Promise<RenderedReviewCapture[]> {
  const count = samplesPerScene(windows.length);
  const captures: RenderedReviewCapture[] = [];
  const seenSceneIds = new Set<string>();
  for (const window of windows) {
    const sceneId = window.sceneId.trim();
    if (!sceneId) throw new Error("Rendered review scene id is required");
    if (seenSceneIds.has(sceneId)) {
      throw new Error(`Rendered review scene ${sceneId} appears more than once`);
    }
    seenSceneIds.add(sceneId);
    for (const time of sampleTimes({ ...window, sceneId }, count)) {
      const snapshot: SnapshotResult = await editor.renderer.captureFrame({
        time,
        mimeType: RENDERED_REVIEW_FRAME_MIME_TYPE,
        quality: RENDERED_REVIEW_FRAME_QUALITY,
      });
      if (!snapshot.success) {
        throw new Error(
          `Failed to capture ${sceneId} at ${time.toFixed(3)}s: ${snapshot.error}`,
        );
      }
      captures.push({
        sceneId,
        timestampSeconds: Math.round(time * 1000) / 1000,
        blob: snapshot.blob,
        filename: snapshot.filename,
      });
    }
  }
  if (captures.length > MAX_RENDERED_REVIEW_FRAMES) {
    throw new Error(
      `Rendered review produced more than ${MAX_RENDERED_REVIEW_FRAMES} frames`,
    );
  }
  return captures;
}

export async function uploadRenderedReviewFrames({
  assetId,
  token,
  projectFingerprint,
  attempt,
  idempotencyKey,
  captures,
  apiBase,
}: {
  assetId: string;
  token: string | null;
  projectFingerprint: string;
  attempt: number;
  idempotencyKey: string;
  captures: RenderedReviewCapture[];
  apiBase: string;
}): Promise<RenderedReviewState> {
  const formData = new FormData();
  const frameManifest = captures.map((capture, index) => {
    const uploadName = `frame-${index + 1}`;
    formData.append(uploadName, capture.blob, capture.filename);
    return {
      scene_id: capture.sceneId,
      timestamp_seconds: capture.timestampSeconds,
      upload_name: uploadName,
    };
  });
  formData.append(
    "manifest",
    JSON.stringify({
      project_fingerprint: projectFingerprint,
      attempt,
      frames: frameManifest,
    }),
  );
  const response = await fetch(
    `${apiBase}/v1/video/projects/${encodeURIComponent(assetId)}/rendered-reviews`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: formData,
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | RenderedReviewState
    | { detail?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      payload && "detail" in payload && typeof payload.detail === "string"
        ? payload.detail
        : `Rendered review upload failed (HTTP ${response.status})`,
    );
  }
  return payload as RenderedReviewState;
}

export async function fetchLatestRenderedReview({
  assetId,
  token,
  apiBase,
}: {
  assetId: string;
  token: string | null;
  apiBase: string;
}): Promise<RenderedReviewState> {
  const response = await fetch(
    `${apiBase}/v1/video/projects/${encodeURIComponent(assetId)}/rendered-reviews/latest`,
    {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | RenderedReviewState
    | { detail?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      payload && "detail" in payload && typeof payload.detail === "string"
        ? payload.detail
        : `Rendered review status failed (HTTP ${response.status})`,
    );
  }
  return payload as RenderedReviewState;
}

export async function retryLatestRenderedReview({
  assetId,
  token,
  idempotencyKey,
  apiBase,
}: {
  assetId: string;
  token: string | null;
  idempotencyKey: string;
  apiBase: string;
}): Promise<RenderedReviewState> {
  const response = await fetch(
    `${apiBase}/v1/video/projects/${encodeURIComponent(assetId)}/rendered-reviews/retry`,
    {
      method: "POST",
      headers: {
        "Idempotency-Key": idempotencyKey,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | RenderedReviewState
    | { detail?: string }
    | null;
  if (!response.ok) {
    throw new Error(
      payload && "detail" in payload && typeof payload.detail === "string"
        ? payload.detail
        : `Rendered review retry failed (HTTP ${response.status})`,
    );
  }
  return payload as RenderedReviewState;
}
