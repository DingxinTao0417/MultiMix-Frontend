"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, ChevronRight, Film, Search, Volume2, X } from "lucide-react";
import { API_BASE } from "../../../lib/api";
import { isRecord, numberValue, stringValue as textValue, type ProductArtifact } from "../lib/asset-workspace-shared";

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
  startTime: number;
  trimStart: number;
  materialStatus: string;
  voiceStatus: string;
  materialUrl: string;
  materialName: string;
  audioUrl: string;
  videoElement?: JsonRecord;
  audioElement?: JsonRecord;
  textElement?: JsonRecord;
  alternates: SceneMaterialOption[];
};

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function formatSeconds(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}s`;
}

function mediaUrl(filePath: string): string {
  if (!filePath) return "";
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(filePath)}`;
}

function mediaPreviewUrl(filePath: string, startSeconds?: number, durationSeconds?: number): string {
  const url = mediaUrl(filePath);
  if (!url || startSeconds === undefined || durationSeconds === undefined || durationSeconds <= 0) return url;
  const start = Math.max(0, startSeconds);
  const end = start + durationSeconds;
  return `${url}#t=${start.toFixed(3)},${end.toFixed(3)}`;
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

function materialOptionForScene(scene: SceneView): SceneMaterialOption | null {
  if (!scene.materialUrl) return null;
  return {
    file_path: scene.materialUrl,
    media_type: textValue(scene.videoElement?.type) === "image" ? "image" : "video",
    source_type: scene.materialName || "current",
    duration: scene.duration,
  };
}

function getSceneViews(project: JsonRecord): SceneView[] {
  const segments = projectSegments(project);
  const videoElements = trackElements(project, "video");
  const audioElements = trackElements(project, "audio");
  const textElements = trackElements(project, "text");

  const sceneKeys: string[] = [];
  const addKey = (key: string) => {
    if (key && !sceneKeys.includes(key)) sceneKeys.push(key);
  };
  segments.forEach((segment, index) => addKey(textValue(segment.id) || `seg-${index}`));
  textElements.forEach((element, index) => addKey(textValue(element.segmentId) || `seg-${index}`));
  videoElements.forEach((element, index) => addKey(textValue(element.segmentId) || `seg-${index}`));
  audioElements.forEach((element, index) => addKey(textValue(element.segmentId) || `seg-${index}`));

  return sceneKeys.map((segmentId, index) => {
    const segment = segments[index] ?? {};
    const segmentById = segments.find((item) => textValue(item.id) === segmentId) ?? segment;
    const videoElement = videoElements.find((item) => textValue(item.segmentId) === segmentId) ?? videoElements[index];
    const audioElement = audioElements.find((item) => textValue(item.segmentId) === segmentId) ?? audioElements[index];
    const textElement = textElements.find((item) => textValue(item.segmentId) === segmentId) ?? textElements[index];
    const material = materialForElement(project, videoElement);
    const audioMaterial = materialForElement(project, audioElement);
    const materialPath = textValue(material?.file_path);
    const audioPath = textValue(audioMaterial?.file_path);
    const duration = numberValue(segmentById.duration, numberValue(textElement?.duration, numberValue(videoElement?.duration, 0)));
    const rawText = textValue(segmentById.narration)
      || textValue(segmentById.text)
      || textValue(textElement?.content)
      || textValue(videoElement?.segmentText);
    const title = textValue(segmentById.title) || textValue(videoElement?.name) || `分镜 ${index + 1}`;
    const hasAudio = Boolean(audioPath);
    return {
      id: segmentId,
      index,
      title,
      text: rawText,
      duration,
      startTime: numberValue(videoElement?.startTime, numberValue(textElement?.startTime, 0)),
      trimStart: numberValue(videoElement?.trimStart, 0),
      materialStatus: materialPath ? "素材已选" : textValue(videoElement?.materialState) === "pending_modal_match" ? "待匹配素材" : "待选素材",
      voiceStatus: hasAudio ? "语音已生成" : textValue(audioElement?.voiceoverState) === "pending_modal_generation" ? "待生成语音" : "未生成语音",
      materialUrl: materialPath,
      materialName: textValue(material?.name) || textValue(videoElement?.name) || "当前素材",
      audioUrl: audioPath,
      videoElement,
      audioElement,
      textElement,
      alternates: normalizeAlternates(videoElement?.alternates),
    };
  });
}

function SceneVideoPreview({ scene }: { scene: SceneView }) {
  const src = mediaPreviewUrl(scene.materialUrl, scene.trimStart, scene.duration);
  const [aspectRatio, setAspectRatio] = useState<string | undefined>(undefined);
  const [intrinsicSize, setIntrinsicSize] = useState<{ width: number; height: number } | undefined>(undefined);
  const mediaStyle = intrinsicSize
    ? {
        aspectRatio: aspectRatio ?? `${intrinsicSize.width} / ${intrinsicSize.height}`,
        width: intrinsicSize.width > intrinsicSize.height ? "min(100%, 520px)" : "auto",
        height: intrinsicSize.height >= intrinsicSize.width ? "min(100%, 390px)" : "auto",
      }
    : undefined;
  return (
    <div className="shadcn-prototype-shot-preview-media" style={mediaStyle}>
      <video
        key={`${scene.id}-${scene.materialUrl}-${scene.trimStart}-${scene.duration}`}
        src={src}
        muted
        playsInline
        controls
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          const end = scene.trimStart + scene.duration;
          if (scene.duration > 0 && video.currentTime >= end) {
            video.pause();
            video.currentTime = scene.trimStart;
          }
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setIntrinsicSize({ width: video.videoWidth, height: video.videoHeight });
            setAspectRatio(`${video.videoWidth} / ${video.videoHeight}`);
          }
          video.currentTime = scene.trimStart;
        }}
      />
    </div>
  );
}

function SceneAudioButton({ scene }: { scene: SceneView }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const src = scene.audioUrl ? mediaUrl(scene.audioUrl) : "";

  useEffect(() => {
    setPlaying(false);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  }, [src]);

  async function toggleAudio() {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  return (
    <span className="shadcn-prototype-shot-audio-control">
      <button type="button" className={playing ? "playing" : ""} disabled={!src} onClick={() => void toggleAudio()}>
        <Volume2 size={18} aria-hidden="true" />
        <span className="sr-only">{src ? (playing ? "暂停配音" : "试听配音") : "未生成配音"}</span>
      </button>
      {src ? (
        <audio
          ref={audioRef}
          src={src}
          onEnded={() => setPlaying(false)}
          onPause={() => setPlaying(false)}
        />
      ) : null}
    </span>
  );
}

function MaterialOptionPreview({ option, duration }: { option: SceneMaterialOption; duration: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const src = mediaPreviewUrl(option.file_path, 0, duration);

  async function toggleVideo() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      try {
        await video.play();
      } catch {
        // Browser may block until the next direct user gesture.
      }
    } else {
      video.pause();
    }
  }

  if (option.media_type === "image") {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={mediaUrl(option.file_path)} alt="备选图片素材" />
    );
  }

  return (
    <video
      ref={videoRef}
      src={src}
      muted
      playsInline
      preload="metadata"
      onClick={() => void toggleVideo()}
    />
  );
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

function updateSceneAlternates(scene: SceneView, options: SceneMaterialOption[]): void {
  const element = scene.videoElement;
  if (!element) return;
  element.alternates = options.filter((item, index, array) => (
    item.file_path && array.findIndex((candidate) => candidate.file_path === item.file_path) === index
  ));
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
  const [materialPage, setMaterialPage] = useState(1);
  const [previewOption, setPreviewOption] = useState<SceneMaterialOption | null>(null);

  useEffect(() => {
    setProject(rawVideoProject(product));
    setSelectedIndex(null);
  }, [product]);

  const scenes = useMemo(() => project ? getSceneViews(project) : [], [project]);
  const selectedScene = selectedIndex === null ? undefined : scenes[Math.min(selectedIndex, Math.max(0, scenes.length - 1))];

  useEffect(() => {
    setDraftText(selectedScene?.text ?? "");
    setFreshOptions([]);
    setMaterialPage(1);
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

  function applyMaterial(option: SceneMaterialOption, optionIndex: number) {
    if (!selectedScene) return;
    const nextProject = cloneProject(currentProject);
    const nextScene = getSceneViews(nextProject)[selectedScene.index];
    const previousOption = materialOptionForScene(nextScene);
    const nextOptions = allOptions.filter((item) => item.file_path !== option.file_path);
    if (previousOption) {
      nextOptions.splice(Math.max(0, optionIndex), 0, previousOption);
    }
    updateSceneAlternates(nextScene, nextOptions);
    updateSceneMaterial(nextProject, nextScene, option);
    setFreshOptions([]);
    setProject(nextProject);
    setStatus("素材已切换，保存当前分镜后生效");
  }

  async function refreshMaterialOptions() {
    if (!selectedScene) return;
    setMaterialLoading(true);
    setStatus("");
    const nextPage = materialPage + 1;
    try {
      const response = await fetch(`${API_BASE}/v1/video/replace-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segment_text: draftText.trim() || selectedScene.text,
          duration: selectedScene.duration,
          layout: product.ratio === "16:9" ? "landscape" : product.ratio === "1:1" ? "square" : "portrait",
          page: nextPage,
        }),
      });
      if (!response.ok) throw new Error("素材搜索失败");
      const data = await response.json() as { page?: number; options?: SceneMaterialOption[] };
      setMaterialPage(data.page ?? nextPage);
      setFreshOptions(data.options ?? []);
      setStatus((data.options ?? []).length ? "已换一批素材" : "没有找到新的素材");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "素材搜索失败");
    } finally {
      setMaterialLoading(false);
    }
  }

  return (
    <div
      className="shadcn-prototype-video-project-workspace"
      onClickCapture={(event) => {
        if (!selectedScene) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.closest(".shadcn-prototype-shot-detail, .shadcn-prototype-material-preview-modal")) return;
        setSelectedIndex(null);
        event.stopPropagation();
      }}
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
      <section
        className="shadcn-prototype-shot-detail"
        aria-label="当前分镜结果"
      >
        <header>
          <div>
            <strong>{String(selectedScene.index + 1).padStart(2, "0")} {selectedScene.title}</strong>
          </div>
          {status ? <p>{status}</p> : null}
          <button
            type="button"
            className="shadcn-prototype-shot-detail-nav"
            disabled={selectedScene.index <= 0}
            onClick={() => setSelectedIndex((current) => Math.max(0, (current ?? selectedScene.index) - 1))}
          >
            <ChevronLeft size={13} aria-hidden="true" />
            上一个分镜
          </button>
          <button type="button" className="shadcn-prototype-shot-detail-save" disabled={saving} onClick={applyTextAndDuration}>
            <Check size={13} aria-hidden="true" />
            {saving ? "保存中" : "保存当前分镜"}
          </button>
          <button
            type="button"
            className="shadcn-prototype-shot-detail-nav"
            disabled={selectedScene.index >= scenes.length - 1}
            onClick={() => setSelectedIndex((current) => Math.min(scenes.length - 1, (current ?? selectedScene.index) + 1))}
          >
            下一个分镜
            <ChevronRight size={13} aria-hidden="true" />
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
                <SceneVideoPreview scene={selectedScene} />
              )
            ) : (
              <div className="shadcn-prototype-shot-preview-empty">
                <Film size={22} aria-hidden="true" />
                <strong>待选择画面素材</strong>
                <span>可通过对话指定画面，也可以在这里搜索或上传本段素材。</span>
              </div>
            )}
          </div>

          <div className="shadcn-prototype-shot-copy-panel">
            <label>
              <span className="shadcn-prototype-shot-copy-heading">
                <SceneAudioButton scene={selectedScene} />
                <span>分镜配音稿</span>
              </span>
              <textarea
                value={draftText}
                onChange={(event) => setDraftText(event.target.value)}
                rows={5}
              />
            </label>
          </div>
        </div>

        <section className="shadcn-prototype-shot-materials" aria-label="更换素材">
          <header>
            <strong>更换素材</strong>
            <button type="button" onClick={() => void refreshMaterialOptions()} disabled={materialLoading}>
              <Search size={14} aria-hidden="true" />
              {materialLoading ? "换素材中" : "换一批"}
            </button>
          </header>
          <div>
            {allOptions.length ? allOptions.map((option, index) => (
              <article key={option.file_path} onDoubleClick={() => setPreviewOption(option)}>
                <div className="shadcn-prototype-shot-material-preview">
                  <MaterialOptionPreview option={option} duration={selectedScene.duration} />
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    applyMaterial(option, index);
                  }}
                >
                  使用
                </button>
              </article>
            )) : (
              <span className="shadcn-prototype-shot-material-empty">无</span>
            )}
          </div>
        </section>

      </section>
      ) : null}
      {previewOption ? (
        <div className="shadcn-prototype-material-preview-modal" role="dialog" aria-modal="true" aria-label="查看备选素材" onClick={() => setPreviewOption(null)}>
          <div onClick={(event) => event.stopPropagation()}>
            <button type="button" aria-label="关闭素材预览" onClick={() => setPreviewOption(null)}>
              <X size={18} aria-hidden="true" />
            </button>
            {previewOption.media_type === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(previewOption.file_path)} alt="备选素材预览" />
            ) : (
              <video src={mediaUrl(previewOption.file_path)} controls muted playsInline preload="metadata" />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
