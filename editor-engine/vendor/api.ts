// Timeline data contract — mirrors backend timeline.py output.

import {
  getSegmentMaterialCandidates as getSharedSegmentMaterialCandidates,
  recomposeSegmentMaterial as recomposeSharedSegmentMaterial,
} from "@/lib/video-project-client";

export interface TimelineElement {
  id: string;
  type: "video" | "image" | "audio" | "text";
  name: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
  mediaId?: string;
  content?: string; // text elements
  segmentId?: string;
  segmentText?: string;
}

export interface TimelineTrack {
  id: string;
  type: "video" | "audio" | "text";
  name: string;
  elements: TimelineElement[];
}

export interface MediaItem {
  id: string;
  type: "video" | "image" | "audio";
  file_path: string;
  name: string;
}

export interface TimelineProject {
  metadata: { title: string; duration: number };
  settings: { fps: number; width: number; height: number };
  media: MediaItem[];
  tracks: TimelineTrack[];
  script?: { content: string; keyword: string; estimated_label: string };
}

export interface GenerateRequest {
  topic: string;
  language?: string;
  length?: string;
  humanize?: boolean;
  layout?: string;
  audio_speed?: string;
  max_clip_seconds?: number;
}

// Backend base URL. In MultiMix this is the unified backend; the editor loads a
// pre-built project (from /v1/video/generate) rather than generating here.
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8199";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export async function generateProject(req: GenerateRequest): Promise<TimelineProject> {
  const res = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "generate failed");
  }
  return res.json();
}

// URL to load a media file. Remote stock URLs (http...) pass through directly;
// All media goes through the backend proxy: store refs (local://supabase://) are
// read server-side, and external stock CDN URLs (Pixabay/Pexels) are relayed by
// the backend because those CDNs send no CORS headers — fetching them directly
// from the browser yields an opaque blob the decoder rejects (black video).
export function mediaUrl(filePath: string): string {
  if (!filePath) return "";
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(filePath)}`;
}

// Unified segment material candidate (backend
// GET .../segments/{id}/material-candidates). Mirrors the app-layer type; kept
// here so the vendor editor stays free of app imports.
export interface SegmentMaterialCandidate {
  candidate_id: string | null;
  source_type: "saved_asset" | "public_asset" | "title_card";
  source_asset_id: number | null;
  provider: string;
  media_type: string;
  title: string;
  preview_url: string;
  duration: number;
  license: string;
  author: string;
  requires_trim: boolean;
  relevance_reason: string;
  selectable: boolean;
}

export interface SegmentMaterialCandidatesResult {
  scope: "local" | "public";
  groups: {
    current: SegmentMaterialCandidate[];
    recommended: SegmentMaterialCandidate[];
    library: SegmentMaterialCandidate[];
    public: SegmentMaterialCandidate[];
  };
  provider_statuses: Array<{ provider: string; status: string; error?: string }>;
  next_cursor: string | null;
}

export type BGMAction = "enable" | "disable" | "select" | "restore_auto";

export interface BGMChoice {
  enabled: boolean;
  catalog_id: string;
  alternate_ids: string[];
  selection_reason: string;
  alternate_reasons: Record<string, string>;
  catalog_version: string;
  selected_by: "auto" | "user";
  locked_by_user: boolean;
  music_intent?: "none" | "subtle" | "energetic";
}

export interface BGMCatalogTrack {
  id: string;
  title: string;
  artist: string;
  provider: string;
  category: string;
  mood_tags: string[];
  duration_seconds: number;
  preview_url: string;
  match_reason?: string;
}

export interface BGMCatalogResponse {
  catalog_version: string;
  current_choice: BGMChoice | null;
  recommended_ids: string[];
  tracks: BGMCatalogTrack[];
}

export interface BGMUpdateResponse {
  asset_id: number;
  catalog_version: string;
  choice: BGMChoice;
  project: Record<string, unknown>;
  project_fingerprint?: string;
}

async function bgmJson<T>(url: string, token: string | null, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = payload && typeof payload.detail === "string" ? payload.detail : `HTTP ${response.status}`;
    throw new Error(detail);
  }
  return payload as T;
}

export async function getProjectBGMCatalog(
  assetId: string,
  token: string | null,
): Promise<BGMCatalogResponse> {
  const payload = await bgmJson<BGMCatalogResponse & { choice?: BGMChoice | null }>(
    `${API_BASE}/v1/video/bgm/catalog?asset_id=${encodeURIComponent(assetId)}`,
    token,
  );
  const currentChoice = payload.current_choice ?? payload.choice ?? null;
  return {
    ...payload,
    current_choice: currentChoice,
    recommended_ids: payload.recommended_ids?.length
      ? payload.recommended_ids
      : [currentChoice?.catalog_id, ...(currentChoice?.alternate_ids || [])].filter(
          (value): value is string => Boolean(value),
        ),
  };
}

export async function updateProjectBGM(
  assetId: string,
  token: string | null,
  body: { action: BGMAction; catalog_id?: string; catalog_version: string },
): Promise<BGMUpdateResponse> {
  return bgmJson<BGMUpdateResponse>(
    `${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}/bgm`,
    token,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

// Fetch the only supported candidate contract for a segment.
export async function segmentMaterialCandidates(
  assetId: string,
  segmentId: string,
  scope: "local" | "public",
  token: string | null | undefined,
  cursor?: string | null,
): Promise<SegmentMaterialCandidatesResult> {
  return getSharedSegmentMaterialCandidates({
    token,
    projectAssetId: assetId,
    segmentId,
    scope,
    cursor,
  });
}

export interface RecomposeResult {
  id?: string;
  public_id?: string;
  status?: string;
  render_stage?: string;
  error_message?: string | null;
}

// Server-side segment recompose. The editor submits only a scoped candidate_id
// and never sends a raw public URL. Returns a confirmation on timeline_dirty so the
// caller can re-send with confirm_overwrite=true.
export async function recomposeSegmentMaterial(
  assetId: string,
  segmentId: string,
  candidateId: string,
  token: string | null | undefined,
  confirmOverwrite = false,
): Promise<{ kind: "confirm_overwrite"; message: string } | { kind: "started"; job: RecomposeResult }> {
  return recomposeSharedSegmentMaterial({
    token,
    projectAssetId: assetId,
    segmentId,
    candidateId,
    confirmOverwrite,
  });
}

export interface MGResult {
  id?: string;
  status: string;
  result?: { mg_overlay_ref?: string; duration?: number };
  error_message?: string | null;
}

export async function generateMG(
  assetId: number,
  segmentText: string,
  duration: number,
  layout: string,
  token: string | null | undefined,
  startTime?: number,
): Promise<MGResult> {
  const title = segmentText.slice(0, 40) || "标题";
  const spec: Record<string, unknown> = {
    template: "lower_third" as const,
    durationInSeconds: Math.min(duration, 5),
    layout: layout || "portrait",
    params: {
      title,
      accentColor: "#7a3fb5",
      entrance: "spring_up" as const,
    },
  };
  // Anchor the overlay at the selected clip's timeline position.
  if (typeof startTime === "number" && startTime >= 0) {
    spec.anchor = { offset: startTime };
  }
  const res = await fetch(`${API_BASE}/v1/video/generate-mg`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ asset_id: assetId, spec }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "generate_mg failed" }));
    throw new Error(err.detail || "generate_mg failed");
  }
  return res.json();
}



// Streaming generation over WebSocket: invokes callbacks as each segment arrives.
export interface StreamHandlers {
  onScript?: (data: { settings: { fps: number; width: number; height: number }; script: { content: string; keyword: string; estimated_label: string }; title: string }) => void;
  onSegment?: (data: { index: number; media: MediaItem[]; video: TimelineElement[]; audio: TimelineElement | null; text: TimelineElement[]; duration: number }) => void;
  onDone?: (data: { duration: number }) => void;
  onError?: (msg: string) => void;
}

export function streamGenerate(req: GenerateRequest, handlers: StreamHandlers): () => void {
  const ws = new WebSocket(`${WS_BASE}/ws/generate`);
  ws.onopen = () => ws.send(JSON.stringify(req));
  ws.onmessage = (ev) => {
    const { kind, data } = JSON.parse(ev.data);
    if (kind === "script") handlers.onScript?.(data);
    else if (kind === "segment") handlers.onSegment?.(data);
    else if (kind === "done") handlers.onDone?.(data);
    else if (kind === "error") handlers.onError?.(data.message || "error");
  };
  ws.onerror = () => handlers.onError?.("websocket error");
  return () => ws.close();
}
