import type { CheckResult, InitialPlanInput, ScenarioDefinition } from "./types";

const check = (code: string, passed: boolean, severity: CheckResult["severity"], expected: unknown, actual: unknown, evidence?: unknown): CheckResult => ({ code, status: passed ? "passed" : "failed", severity, expected, actual, evidence });

export function scoreInitialPlan(scenario: ScenarioDefinition, input: InitialPlanInput): CheckResult[] {
  const effectiveScenes = input.scenes.filter((scene) => Boolean(scene.narration?.trim() || scene.visual_brief?.trim()));
  const chosenIds = input.scenes.map((scene) => scene.asset_reference?.chosen_asset_id).filter((id): id is number => typeof id === "number");
  const matched = input.scenes.filter((scene) => scene.asset_reference?.status === "matched" && (scene.asset_reference.match_confidence ?? 0) >= 0.6 && input.imageIds.includes(scene.asset_reference.chosen_asset_id ?? -1));
  const distractorHits = chosenIds.filter((id) => input.distractorIds.includes(id));
  const stockViolations = input.scenes.filter((scene) => scene.material_candidates?.some((candidate) => ["stock", "public"].includes(candidate.source_type ?? "")) && scene.asset_reference?.status !== "no_asset_hit");
  const noAssetHits = input.scenes.filter((scene) => scene.asset_reference?.status === "no_asset_hit").length;
  const forbiddenHits = scenario.forbiddenPhrases.filter((phrase) => input.markdown.includes(phrase));
  const syntheticHits = (input.syntheticEvidencePhrases ?? []).filter((phrase) => input.markdown.includes(phrase));
  const mgNeeded = input.scenes.filter((scene) => scene.mg_decision?.needed && scene.mg_decision.mode === "overlay" && Boolean(scene.mg_decision.chosen_template));

  return [
    check("R1", input.scenes.length > 0 && input.scenes.filter((scene) => scene.asset_reference?.status).length / input.scenes.length >= 0.8, "P1", ">=80% scenes have asset_reference", input.scenes.length),
    check("R2", matched.length >= scenario.thresholds.matchedMinimum, "P1", scenario.thresholds.matchedMinimum, matched.length),
    check("R3", distractorHits.length === 0, "P0", 0, distractorHits.length, distractorHits),
    check("R4", stockViolations.length === 0, "P0", 0, stockViolations.length),
    check("R5", scenario.thresholds.noAssetHitMinimum === undefined || noAssetHits >= scenario.thresholds.noAssetHitMinimum, "P0", scenario.thresholds.noAssetHitMinimum ?? "not applicable", noAssetHits),
    check("R6", input.scenes.every((scene) => Boolean(scene.asset_reference?.status)), "P1", "canonical asset_reference", input.scenes.length),
    check("R7", distractorHits.length === 0, "P0", 0, distractorHits.length, distractorHits),
    check("M1", mgNeeded.length >= 1, "P1", ">=1 overlay decision", mgNeeded.length),
    check("M3", input.scenes.every((scene) => scene.mg_decision?.mode === undefined || scene.mg_decision.mode === "overlay"), "P0", "overlay only", input.scenes.map((scene) => scene.mg_decision?.mode)),
    check("C1", forbiddenHits.length === 0, "P0", 0, forbiddenHits.length, forbiddenHits),
    check("C4", syntheticHits.length === 0, "P0", 0, syntheticHits.length, syntheticHits),
    check("S1", effectiveScenes.length >= scenario.thresholds.effectiveSceneMinimum, "P1", scenario.thresholds.effectiveSceneMinimum, effectiveScenes.length),
  ];
}

export function scoreUnderstanding(items: Array<{ status?: string; tags?: unknown[]; caption?: string; objects?: unknown[]; storyboard_roles?: unknown[]; scene_types?: unknown[]; confidence?: number }>): CheckResult[] {
  const complete = items.filter((item) => item.status && item.tags?.length && item.caption && item.objects?.length && item.storyboard_roles?.length && item.scene_types?.length && typeof item.confidence === "number").length;
  return [check("U1", complete === items.length, "P1", items.length, complete), check("U2", items.every((item) => ["ready", "processing", "failed"].includes(item.status ?? "")), "P1", "truthful status", items.map((item) => item.status))];
}

export function scoreRevision(beforeIds: number[], afterIds: number[]): CheckResult[] {
  const retained = beforeIds.filter((id) => afterIds.includes(id)).length;
  const ratio = beforeIds.length ? retained / beforeIds.length : 1;
  return [check("E1", ratio >= 0.6, "P1", ">=0.6", ratio)];
}

export function scoreDialogBoundary(input: { claimedMp4: boolean; questionCreatedVersion: boolean; unrelatedTextPersisted: boolean; inventedCase: boolean }): CheckResult[] {
  return [check("D1", !input.claimedMp4, "P0", false, input.claimedMp4), check("D2", !input.questionCreatedVersion, "P0", false, input.questionCreatedVersion), check("D3", !input.unrelatedTextPersisted, "P0", false, input.unrelatedTextPersisted), check("D4", !input.inventedCase, "P0", false, input.inventedCase)];
}

export function finalizeScenarioResult(checks: CheckResult[], blockedReason?: string) {
  if (blockedReason) return { status: "blocked" as const, blockedReason, checks };
  return { status: checks.some((item) => item.status === "failed") ? "failed" as const : "passed" as const, checks };
}
