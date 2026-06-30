// Timeline data contract — mirrors backend timeline.py output.

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

export interface MaterialOption {
  file_path: string;
  media_type: "video" | "image";
  source_type: string;
  duration: number;
}

export async function replaceOptions(segmentText: string, duration: number, layout = "portrait", page = 1): Promise<MaterialOption[]> {
  const res = await fetch(`${API_BASE}/v1/video/replace-options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segment_text: segmentText, duration, layout, page }),
  });
  if (!res.ok) throw new Error("replace_options failed");
  const data = await res.json();
  return data.options || [];
}

export interface MGResult {
  html_path: string;
  mp4_path: string | null;
  rendered: boolean;
}

export async function generateMG(segmentText: string, duration: number, width = 1080, height = 1920, render = false): Promise<MGResult> {
  const res = await fetch(`${API_BASE}/v1/video/generate-mg`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ segment_text: segmentText, duration, width, height, render }),
  });
  if (!res.ok) throw new Error("generate_mg failed");
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
