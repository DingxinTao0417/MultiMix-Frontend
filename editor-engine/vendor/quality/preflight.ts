import type { VideoQualityIssue, VideoQualityReport } from "../../../app/assets/lib/video-quality";
import type { BackendElement, BackendProject, SafeRegion } from "../buildProject";

function issue(
  code: string,
  message: string,
  element?: BackendElement,
  objectType = "editor_timeline",
): VideoQualityIssue {
  return {
    code,
    segment_id: element?.segmentId ?? null,
    object_type: objectType,
    message,
    suggested_actions: ["定位并修复当前分镜"],
  };
}

function overlaps(left: SafeRegion, right: SafeRegion): boolean {
  return (
    left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y
  );
}

function overlapsInTime(left: BackendElement, right: BackendElement): boolean {
  return (
    left.startTime < right.startTime + right.duration
    && left.startTime + left.duration > right.startTime
  );
}

function isSubtitleElement(trackId: string, element: BackendElement): boolean {
  return element.textRole
    ? element.textRole === "subtitle"
    : trackId === "track-text";
}

export function inspectEditorProject(project: BackendProject): VideoQualityReport {
  const blockers: VideoQualityIssue[] = [];
  const warnings: VideoQualityIssue[] = [];
  const duration = Number(project.metadata.duration || 0);
  const contract = project.metadata.duration_contract;
  if (contract && (duration < contract.min_seconds || duration > contract.max_seconds)) {
    warnings.push(issue(
      "duration_out_of_range",
      `当前时间轴 ${duration.toFixed(2)}s 不在 ${contract.min_seconds.toFixed(2)}s–${contract.max_seconds.toFixed(2)}s 内。`,
      undefined,
      "duration",
    ));
  }

  const mainTrack = project.tracks.find((track) => track.type === "video" && !track.overlay);
  const fps = Math.max(1, Number(project.settings.fps || 30));
  const frameTolerance = 1 / fps;
  const intervals = [...(mainTrack?.elements ?? [])]
    .filter((element) => element.duration > 0)
    .sort((left, right) => left.startTime - right.startTime);
  let coveredUntil = 0;
  for (const element of intervals) {
    if (element.startTime - coveredUntil > frameTolerance) {
      blockers.push(issue(
        "main_track_gap",
        `当前主画面在 ${coveredUntil.toFixed(2)}s–${element.startTime.toFixed(2)}s 存在空档。`,
        element,
        "main_track",
      ));
    }
    coveredUntil = Math.max(coveredUntil, element.startTime + element.duration);
  }
  if (!intervals.length || duration - coveredUntil > frameTolerance) {
    blockers.push(issue(
      "main_track_gap",
      intervals.length
        ? `当前主画面在 ${coveredUntil.toFixed(2)}s–${duration.toFixed(2)}s 存在空档。`
        : "当前时间轴没有主画面。",
      intervals.at(-1),
      "main_track",
    ));
  }

  const mediaIds = new Set(project.media.map((media) => media.id));
  for (const track of project.tracks) {
    for (const element of track.elements) {
      if (element.type !== "text" && (!element.mediaId || !mediaIds.has(element.mediaId))) {
        blockers.push(issue(
          "missing_media_reference",
          "当前时间轴引用了不存在的媒体，导出会出现空画面或静音。",
          element,
          "material",
        ));
      }
      if (
        element.type === "text"
        && isSubtitleElement(track.id, element)
        && String(element.content || "").split("\n").length > 2
      ) {
        blockers.push(issue(
          "subtitle_too_many_lines",
          "当前字幕超过两行，可能遮挡主画面或越出安全区。",
          element,
          "subtitle",
        ));
      }
    }
  }

  const subtitles = project.tracks
    .filter((track) => track.type === "text")
    .flatMap((track) => track.elements.filter((element) => isSubtitleElement(track.id, element)))
    .filter((element) => Boolean(element.safeRegion));
  const overlays = project.tracks
    .filter((track) => track.type === "video" && track.overlay)
    .flatMap((track) => track.elements)
    .filter((element) => Boolean(element.safeRegion));
  for (const overlay of overlays) {
    for (const subtitle of subtitles) {
      if (
        overlapsInTime(overlay, subtitle)
        && overlaps(overlay.safeRegion!, subtitle.safeRegion!)
      ) {
        blockers.push(issue(
          "overlay_subtitle_collision",
          "MG 动效与字幕安全区重叠。",
          overlay,
          "mg_overlay",
        ));
        break;
      }
    }
  }

  return {
    stage: "editor_preflight",
    status: blockers.length ? "blocked" : "pass",
    blockers,
    warnings,
  };
}
