type DirectorSceneText = {
  title?: unknown;
  visual_brief?: unknown;
  narration?: unknown;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function sceneImageGenerationUtterance(scene: DirectorSceneText, sceneNumber: number): string {
  const title = text(scene.title);
  const visualGoal = text(scene.visual_brief);
  const narration = text(scene.narration);
  const context = [
    title ? `分镜主题：${title}。` : "",
    visualGoal ? `画面目标：${visualGoal}。` : "",
    !visualGoal && narration ? `旁白语境：${narration}。` : "",
  ].join("");
  return `请为当前编导稿第 ${sceneNumber} 镜生成一张创意图片候选。${context}图片仅作创意示意，不代表真实商家商品或门店；生成后供我选择，不自动应用到分镜。`;
}
