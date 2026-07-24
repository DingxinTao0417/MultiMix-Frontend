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
