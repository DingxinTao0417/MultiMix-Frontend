"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Film, Search } from "lucide-react";
import { API_BASE } from "../../../lib/api";
import type { ProductArtifact } from "../lib/asset-workspace-shared";

type JsonRecord = Record<string, unknown>;

type SceneMaterialOption = {
  file_path: string;
  media_type: "video" | "image";
  source_type: string;
  duration: number;
};

type SceneView = {
  id: string;
  index: number;
  title: string;
  text: string;
  duration: number;
  materialStatus: string;
  voiceStatus: string;
  materialUrl: string;
  materialName: string;
  videoElement?: JsonRecord;
  audioElement?: JsonRecord;
  textElement?: JsonRecord;
  alternates: SceneMaterialOption[];
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function formatSeconds(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}s`;
}

function mediaUrl(filePath: string): string {
  if (!filePath) return "";
  if (/^https?:\/\//i.test(filePath)) return filePath;
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(filePath)}`;
}

function rawVideoProject(product: ProductArtifact): JsonRecord | null {
  const metadata = isRecord(product.metadata) ? product.metadata : {};
  const videoProject = metadata.video_project;
  return isRecord(videoProject) ? videoProject : null;
}

function projectTimeline(project: JsonRecord): JsonRecord {
  return isRecord(project.timeline) ? project.timeline : project;
}

function projectSegments(project: JsonRecord): JsonRecord[] {
  const timeline = projectTimeline(project);
  return records(timeline.segments).length ? records(timeline.segments) : records(project.segments);
}

function projectTracks(project: JsonRecord): JsonRecord[] {
  return records(projectTimeline(project).tracks);
}

function mediaItems(project: JsonRecord): JsonRecord[] {
  const timeline = projectTimeline(project);
  return records(timeline.media);
}

function trackElements(project: JsonRecord, type: string): JsonRecord[] {
  const track = projectTracks(project).find((item) => textValue(item.type) === type);
  return track ? records(track.elements) : [];
}

function materialForElement(project: JsonRecord, element: JsonRecord | undefined): JsonRecord | undefined {
  if (!element) return undefined;
  const mediaId = textValue(element.mediaId);
  return mediaItems(project).find((item) => textValue(item.id) === mediaId);
}

function normalizeAlternates(value: unknown): SceneMaterialOption[] {
  return records(value).map((item) => ({
    file_path: textValue(item.file_path),
    media_type: (textValue(item.media_type) === "image" ? "image" : "video") as SceneMaterialOption["media_type"],
    source_type: textValue(item.source_type) || "candidate",
    duration: numberValue(item.duration, 0),
  })).filter((item) => item.file_path);
}

function getSceneViews(project: JsonRecord): SceneView[] {
  const segments = projectSegments(project);
  const videoElements = trackElements(project, "video");
  const audioElements = trackElements(project, "audio");
  const textElements = trackElements(project, "text");

  const count = Math.max(segments.length, textElements.length, videoElements.length);
  return Array.from({ length: count }).map((_, index) => {
    const segment = segments[index] ?? {};
    const segmentId = textValue(segment.id) || `seg-${index}`;
    const videoElement = videoElements.find((item) => textValue(item.segmentId) === segmentId) ?? videoElements[index];
    const audioElement = audioElements.find((item) => textValue(item.segmentId) === segmentId) ?? audioElements[index];
    const textElement = textElements.find((item) => textValue(item.segmentId) === segmentId) ?? textElements[index];
    const material = materialForElement(project, videoElement);
    const materialPath = textValue(material?.file_path);
    const duration = numberValue(segment.duration, numberValue(textElement?.duration, numberValue(videoElement?.duration, 0)));
    const rawText = textValue(segment.narration)
      || textValue(segment.text)
      || textValue(textElement?.content)
      || textValue(videoElement?.segmentText);
    const title = textValue(segment.title) || textValue(videoElement?.name) || `分镜 ${index + 1}`;
    const hasAudio = Boolean(materialForElement(project, audioElement)?.file_path || audioElement?.mediaId);
    return {
      id: segmentId,
      index,
      title,
      text: rawText,
      duration,
      materialStatus: materialPath ? "素材已选" : textValue(videoElement?.materialState) === "pending_modal_match" ? "待匹配素材" : "待选素材",
      voiceStatus: hasAudio ? "语音已生成" : textValue(audioElement?.voiceoverState) === "pending_modal_generation" ? "待生成语音" : "未生成语音",
      materialUrl: materialPath,
      materialName: textValue(material?.name) || textValue(videoElement?.name) || "当前素材",
      videoElement,
      audioElement,
      textElement,
      alternates: normalizeAlternates(videoElement?.alternates),
    };
  });
}

function cloneProject(project: JsonRecord): JsonRecord {
  return JSON.parse(JSON.stringify(project)) as JsonRecord;
}

function updateSceneText(project: JsonRecord, scene: SceneView, text: string): void {
  const segment = projectSegments(project).find((item) => textValue(item.id) === scene.id) ?? projectSegments(project)[scene.index];
  if (segment) {
    segment.narration = text;
    segment.subtitle = text;
    segment.text = text;
  }
  for (const element of [scene.videoElement, scene.audioElement, scene.textElement]) {
    if (!element) continue;
    if ("segmentText" in element) element.segmentText = text;
    if (textValue(element.type) === "text") element.content = text;
  }
}

function updateSceneMaterial(project: JsonRecord, scene: SceneView, option: SceneMaterialOption): void {
  const element = scene.videoElement;
  if (!element) return;
  const media = mediaItems(project);
  let mediaItem = materialForElement(project, element);
  if (!mediaItem) {
    const id = `vid-${scene.index}-${Date.now()}`;
    mediaItem = { id, type: option.media_type, name: `素材 ${scene.index + 1}`, file_path: option.file_path };
    media.push(mediaItem);
    const timeline = projectTimeline(project);
    timeline.media = media;
    element.mediaId = id;
  }
  mediaItem.file_path = option.file_path;
  mediaItem.type = option.media_type;
  mediaItem.name = option.source_type || mediaItem.name;
  element.type = option.media_type;
  element.materialState = "selected";
}

export default function VideoProjectWorkspace({
  onProjectUpdated,
  product,
  token,
}: {
  onProjectUpdated?: (product: ProductArtifact) => void;
  product: ProductArtifact;
  token?: string | null;
}) {
  const [project, setProject] = useState<JsonRecord | null>(() => rawVideoProject(product));
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [draftText, setDraftText] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [materialLoading, setMaterialLoading] = useState(false);
  const [freshOptions, setFreshOptions] = useState<SceneMaterialOption[]>([]);

  useEffect(() => {
    setProject(rawVideoProject(product));
    setSelectedIndex(null);
  }, [product]);

  const scenes = useMemo(() => project ? getSceneViews(project) : [], [project]);
  const selectedScene = selectedIndex === null ? undefined : scenes[Math.min(selectedIndex, Math.max(0, scenes.length - 1))];

  useEffect(() => {
    setDraftText(selectedScene?.text ?? "");
    setFreshOptions([]);
  }, [selectedScene?.id, selectedScene?.text]);

  if (!project || scenes.length === 0) {
    return null;
  }

  const currentProject = project;
  const timeline = projectTimeline(project);
  const timelineSettings = isRecord(timeline.settings) ? timeline.settings : {};
  const projectWidth = numberValue(timelineSettings.width, product.ratio === "16:9" ? 1920 : 1080);
  const projectHeight = numberValue(timelineSettings.height, product.ratio === "16:9" ? 1080 : product.ratio === "1:1" ? 1080 : 1920);
  const totalDuration = numberValue(isRecord(timeline.metadata) ? timeline.metadata.duration : undefined, scenes.reduce((sum, item) => sum + item.duration, 0));
  const materialHits = scenes.filter((item) => item.materialUrl).length;
  const voiceHits = scenes.filter((item) => item.voiceStatus === "语音已生成").length;
  const allOptions = [...(selectedScene?.alternates ?? []), ...freshOptions].filter((item, index, array) => (
    array.findIndex((candidate) => candidate.file_path === item.file_path) === index
  ));

  async function saveProject(nextProject: JsonRecord, message: string) {
    setSaving(true);
    setStatus("");
    try {
      if (token && product.backendAssetId) {
        const response = await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(product.backendAssetId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify(nextProject),
        });
        if (!response.ok) {
          const error = await response.json().catch(() => ({ detail: response.statusText }));
          throw new Error(typeof error.detail === "string" ? error.detail : "保存失败");
        }
      }
      setProject(nextProject);
      setStatus(message);
      onProjectUpdated?.({
        ...product,
        metadata: {
          ...(product.metadata ?? {}),
          video_project: nextProject,
        },
      });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function applyTextAndDuration() {
    if (!selectedScene) return;
    const nextProject = cloneProject(currentProject);
    const nextScene = getSceneViews(nextProject)[selectedScene.index];
    updateSceneText(nextProject, nextScene, draftText.trim());
    void saveProject(nextProject, "当前分镜已保存");
  }

  function applyMaterial(option: SceneMaterialOption) {
    if (!selectedScene) return;
    const nextProject = cloneProject(currentProject);
    const nextScene = getSceneViews(nextProject)[selectedScene.index];
    updateSceneMaterial(nextProject, nextScene, option);
    void saveProject(nextProject, "素材已更新");
  }

  async function refreshMaterialOptions() {
    if (!selectedScene) return;
    setMaterialLoading(true);
    setStatus("");
    try {
      const response = await fetch(`${API_BASE}/v1/video/replace-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment_text: draftText.trim() || selectedScene.text,
          duration: selectedScene.duration,
          layout: product.ratio === "16:9" ? "landscape" : product.ratio === "1:1" ? "square" : "portrait",
        }),
      });
      if (!response.ok) throw new Error("素材搜索失败");
      const data = await response.json() as { options?: SceneMaterialOption[] };
      setFreshOptions(data.options ?? []);
      setStatus((data.options ?? []).length ? "已找到新的备选素材" : "没有找到新的备选素材");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材搜索失败");
    } finally {
      setMaterialLoading(false);
    }
  }

  return (
    <div
      className="shadcn-prototype-video-project-workspace"
      onClick={(event) => {
        if (event.target === event.currentTarget) setSelectedIndex(null);
      }}
    >
      <section
        className="shadcn-prototype-shot-list"
        aria-label={`视频工程分镜列表，${scenes.length} 个分镜，${formatSeconds(totalDuration)}，素材 ${materialHits}/${scenes.length}，语音 ${voiceHits}/${scenes.length}`}
        onClick={(event) => {
          if ((event.target as HTMLElement).classList.contains("shadcn-prototype-shot-list-items")) {
            setSelectedIndex(null);
          }
        }}
      >
        <div className="shadcn-prototype-shot-list-items">
          {scenes.map((scene) => (
            <button
              type="button"
              key={scene.id}
              className={selectedScene && scene.index === selectedScene.index ? "active" : ""}
              onClick={() => setSelectedIndex((current) => current === scene.index ? null : scene.index)}
            >
              <span>{String(scene.index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{scene.title}</strong>
                <em>{scene.text || "暂无分镜文案"}</em>
              </div>
              <small>{formatSeconds(scene.duration)}</small>
              <small>{scene.materialStatus}</small>
              <small>{scene.voiceStatus}</small>
            </button>
          ))}
        </div>
      </section>

      {selectedScene ? (
      <section className="shadcn-prototype-shot-detail" aria-label="当前分镜结果">
        <header>
          <div>
            <strong>{String(selectedScene.index + 1).padStart(2, "0")} {selectedScene.title}</strong>
          </div>
          {status ? <p>{status}</p> : null}
          <button type="button" className="shadcn-prototype-shot-detail-save" disabled={saving} onClick={applyTextAndDuration}>
            <Check size={13} aria-hidden="true" />
            {saving ? "保存中" : "保存当前分镜"}
          </button>
          <button type="button" className="shadcn-prototype-shot-detail-close" aria-label="关闭分镜详情" onClick={() => setSelectedIndex(null)}>
            关闭
          </button>
        </header>

        <div className="shadcn-prototype-shot-result-grid">
          <div className="shadcn-prototype-shot-preview">
            <span className="shadcn-prototype-shot-panel-title">当前画面</span>
            <span className="shadcn-prototype-shot-frame-size">{product.ratio} · {projectWidth}×{projectHeight}</span>
            {selectedScene.materialUrl ? (
              selectedScene.materialUrl.match(/\.(png|jpe?g|webp|gif)(\?|$)/i) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={mediaUrl(selectedScene.materialUrl)} alt={selectedScene.materialName} />
              ) : (
                <video src={mediaUrl(selectedScene.materialUrl)} muted playsInline controls />
              )
            ) : (
              <div>
                <Film size={22} aria-hidden="true" />
                <strong>待选择画面素材</strong>
                <span>可通过对话指定画面，也可以在这里搜索或上传本段素材。</span>
              </div>
            )}
          </div>

          <div className="shadcn-prototype-shot-copy-panel">
            <label>
              <span>分镜文案</span>
              <textarea
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                rows={5}
              />
            </label>
          </div>
        </div>

        <section className="shadcn-prototype-shot-materials" aria-label="备选素材">
          <header>
            <strong>备选素材</strong>
            <button type="button" onClick={() => void refreshMaterialOptions()} disabled={materialLoading}>
              <Search size={14} aria-hidden="true" />
              {materialLoading ? "搜索中" : "重新找素材"}
            </button>
          </header>
          <div>
            {allOptions.length ? allOptions.map((option) => (
              <article key={option.file_path}>
                <span>{option.source_type}</span>
                <strong>{option.media_type === "image" ? "图片素材" : "视频素材"}</strong>
                <button type="button" onClick={() => applyMaterial(option)}>使用</button>
              </article>
            )) : (
              <span className="shadcn-prototype-shot-material-empty">无</span>
            )}
          </div>
        </section>

      </section>
      ) : null}
    </div>
  );
}
