export type ProductionRecomposeScene = {
  id: string;
  primary_visual?: {
    source_type?: string;
  };
  primary_visual_strategy?: {
    mode?: string;
  };
};

export const PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION =
  "保留当前主画面模式和本镜已确认信息，只优化构图层次、画面清晰度与安全区，不要切换主画面类型；如果本镜包含 MG 动画，保留其形式和内容。";

export type DurationCandidate = {
  id?: unknown;
  target_seconds?: unknown;
};

type RoundTripTrack = {
  id?: unknown;
  elements?: readonly Record<string, unknown>[];
  [key: string]: unknown;
};

function withoutDisplayLineBreaks(value: string): string {
  return value.replace(/\r?\n/g, "");
}

export function normalizePresenterRoundTripTrack<Track extends RoundTripTrack>(
  track: Track,
): Track {
  if (track.id !== "track-text" || !Array.isArray(track.elements)) {
    return track;
  }
  return {
    ...track,
    elements: track.elements.map((element) => {
      const content = element.content;
      const displayText = element.displayText;
      if (
        typeof content !== "string"
        || typeof displayText !== "string"
        || withoutDisplayLineBreaks(content) !== withoutDisplayLineBreaks(displayText)
      ) {
        return element;
      }
      return { ...element, content: displayText };
    }),
  } as Track;
}

export function selectClosestDurationCandidate(
  candidates: readonly DurationCandidate[],
  groundedTopCandidateIds: readonly string[],
  targetSeconds: number,
): { id: string; targetSeconds: number; rank: number } | undefined {
  const topRank = new Map(
    groundedTopCandidateIds.map((id, rank) => [String(id), rank]),
  );
  return candidates
    .map((candidate) => {
      const id = String(candidate.id ?? "");
      const rank = topRank.get(id);
      const candidateSeconds = Number(candidate.target_seconds);
      return id && rank !== undefined && Number.isFinite(candidateSeconds) && candidateSeconds > 0
        ? { id, targetSeconds: candidateSeconds, rank }
        : undefined;
    })
    .filter(
      (candidate): candidate is { id: string; targetSeconds: number; rank: number } =>
        candidate !== undefined,
    )
    .sort((left, right) => (
      Math.abs(left.targetSeconds - targetSeconds)
      - Math.abs(right.targetSeconds - targetSeconds)
      || left.rank - right.rank
    ))[0];
}

export function selectProductionGeneratedRecomposeTarget<
  Scene extends ProductionRecomposeScene,
>(scenes: readonly Scene[]): Scene | undefined {
  const generatedScenes = scenes.filter(
    (scene) =>
      scene.primary_visual?.source_type === "generated_scene" &&
      Boolean(scene.primary_visual_strategy?.mode),
  );
  return (
    generatedScenes.find(
      (scene) => scene.primary_visual_strategy?.mode === "mg_scene",
    ) ?? generatedScenes[0]
  );
}
