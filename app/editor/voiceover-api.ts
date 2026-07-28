import { API_BASE } from "../../editor-engine/vendor/api";

export type VoiceEnergy =
  | "calm_confident"
  | "warm_clear"
  | "bright_energetic"
  | "steady_authoritative";

export type PronunciationDraft = {
  text: string;
  spokenAs: string;
};

export type VoiceoverDraft = {
  narration: string;
  voiceName: string;
  voiceSpeed: number;
  energy: VoiceEnergy;
  pronunciations: PronunciationDraft[];
};

export type VoicePreview = {
  segment_id: string;
  audio_ref: string;
  duration_seconds: number;
  request_fingerprint: string;
};

export type VideoJob = {
  id: string;
  asset_id: number;
  status: "queued" | "running" | "completed" | "failed";
  render_stage: string;
  error_message: string | null;
  result: {
    voice_preview?: VoicePreview;
    undo_version?: number;
    undo_version_id?: number;
    narration_failure?: {
      segment_id?: string;
      code?: string;
    };
  };
};

export type VoiceRequestArgs = {
  assetId: string;
  segmentId: string;
  token: string;
  draft: VoiceoverDraft;
  previewJobId?: string;
  confirmOverwrite?: boolean;
};

export type ProjectVoiceRequestArgs = Omit<VoiceRequestArgs, "segmentId">;

export class VoiceoverApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, options: { code: string; status: number }) {
    super(message);
    this.name = "VoiceoverApiError";
    this.code = options.code;
    this.status = options.status;
  }
}

function authHeaders(token: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function voiceBody(
  draft: VoiceoverDraft,
  options: {
    previewOnly?: boolean;
    previewJobId?: string;
    confirmOverwrite?: boolean;
  },
) {
  return {
    voice_name: draft.voiceName,
    voice_speed: draft.voiceSpeed,
    voice_direction: { energy: draft.energy },
    pronunciations: draft.pronunciations
      .map((item) => ({
        text: item.text.trim(),
        spoken_as: item.spokenAs.trim(),
      }))
      .filter((item) => item.text && item.spoken_as),
    preview_job_id: options.previewJobId,
    confirm_overwrite: options.confirmOverwrite ?? false,
    ...(options.previewOnly === undefined
      ? {}
      : { preview_only: options.previewOnly }),
  };
}

async function parseJob(response: Response): Promise<VideoJob> {
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload?.detail;
    const code =
      detail && typeof detail === "object" && typeof detail.code === "string"
        ? detail.code
        : `http_${response.status}`;
    const message =
      detail && typeof detail === "object" && typeof detail.message === "string"
        ? detail.message
        : typeof detail === "string"
          ? detail
          : "配音请求失败，请稍后重试。";
    throw new VoiceoverApiError(message, { code, status: response.status });
  }
  if (!payload || typeof payload.id !== "string") {
    throw new VoiceoverApiError("配音任务返回格式无效。", {
      code: "invalid_job_response",
      status: response.status,
    });
  }
  return payload as VideoJob;
}

async function requestSegmentVoice(
  args: VoiceRequestArgs,
  options: { previewOnly: boolean },
): Promise<VideoJob> {
  const response = await fetch(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(args.assetId)}/segments/${encodeURIComponent(args.segmentId)}/recompose`,
    {
      method: "POST",
      headers: authHeaders(args.token),
      body: JSON.stringify({
        operation: "revoice",
        voiceover: args.draft.narration,
        ...voiceBody(args.draft, {
          previewOnly: options.previewOnly,
          previewJobId: args.previewJobId,
          confirmOverwrite: args.confirmOverwrite,
        }),
      }),
    },
  );
  return parseJob(response);
}

export function submitVoicePreview(args: VoiceRequestArgs): Promise<VideoJob> {
  return requestSegmentVoice(args, { previewOnly: true });
}

export function applySegmentVoice(args: VoiceRequestArgs): Promise<VideoJob> {
  return requestSegmentVoice(args, { previewOnly: false });
}

export async function applyProjectVoice(
  args: ProjectVoiceRequestArgs,
): Promise<VideoJob> {
  const response = await fetch(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(args.assetId)}/revoice`,
    {
      method: "POST",
      headers: authHeaders(args.token),
      body: JSON.stringify(
        voiceBody(args.draft, {
          previewJobId: args.previewJobId,
          confirmOverwrite: args.confirmOverwrite,
        }),
      ),
    },
  );
  return parseJob(response);
}

export async function pollVideoJob(
  jobId: string,
  token: string,
  intervalMs = 1500,
): Promise<VideoJob> {
  for (;;) {
    const response = await fetch(
      `${API_BASE}/v1/video/jobs/${encodeURIComponent(jobId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const job = await parseJob(response);
    if (job.status === "completed" || job.status === "failed") return job;
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
}

export function voicePreviewUrl(audioRef: string): string {
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(audioRef)}`;
}

export async function restoreVoiceVersion(args: {
  assetId: string;
  versionId: number;
  token: string;
}): Promise<void> {
  const response = await fetch(
    `${API_BASE}/v1/assets/${encodeURIComponent(args.assetId)}/versions/${encodeURIComponent(String(args.versionId))}/restore`,
    {
      method: "POST",
      headers: authHeaders(args.token),
    },
  );
  if (!response.ok) {
    await parseJob(response);
  }
}
