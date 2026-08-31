import { expect, type Page } from "@playwright/test";

import type { DemoApiClient } from "./api-client";
import { finalizeScenarioResult, scoreInitialPlan, scoreUnderstanding } from "./assertions";
import type { CheckResult, PlanScene, ScenarioDefinition } from "./types";

export type ScenarioEvidence = {
  scenarioId: string;
  apiAssetIds: number[];
  resultAssetId: number;
  directorDraftVisible: boolean;
  checks: CheckResult[];
};

export async function runScenario(page: Page, api: DemoApiClient, scenario: ScenarioDefinition): Promise<ScenarioEvidence> {
  await page.goto("/app/assets");
  const composer = page.getByRole("textbox", { name: "输入对话内容" });
  await expect(composer).toBeVisible();
  const primaryAssets = [];
  for (const filePath of scenario.primaryImages) primaryAssets.push(await api.uploadAsset(filePath));
  const distractorAssets = [];
  for (const filePath of scenario.distractorImages) distractorAssets.push(await api.uploadAsset(filePath));
  const linkedAssetIds = [...primaryAssets, ...distractorAssets].map((asset) => asset.id);
  const routePattern = "**/v1/assets/conversations/messages";
  const addLinkedAssets = async (route: import("@playwright/test").Route) => {
    await route.continue({
      postData: JSON.stringify({
        ...(route.request().postDataJSON() as Record<string, unknown>),
        linked_asset_ids: linkedAssetIds,
      }),
    });
  };
  await page.route(routePattern, addLinkedAssets);
  await composer.fill(scenario.prompts.initial);
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST" && response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 12 * 60_000 },
  );
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await responsePromise;
  await page.unroute(routePattern, addLinkedAssets);
  expect(response.ok(), `scenario ${scenario.id} conversation failed: ${response.status()} ${await response.text()}`).toBe(true);
  const payload = await response.json() as {
    result_asset_id?: number | null;
    asset?: { id?: number };
    generation_job?: { id?: string };
  };
  const resultAssetId = payload.result_asset_id
    ?? payload.asset?.id
    ?? (payload.generation_job?.id ? await api.waitForGenerationJob(payload.generation_job.id) : null);
  expect(resultAssetId, `scenario ${scenario.id} must persist a director asset`).toBeTruthy();
  await expect(page.getByText("编导稿", { exact: false }).first()).toBeVisible({ timeout: 20 * 60_000 });

  const sourceAssets = await Promise.all(linkedAssetIds.map((id) => api.waitForUnderstanding(id, 120_000)));
  const resultAsset = await api.getAsset(resultAssetId!);
  const metadata = (resultAsset.metadata ?? {}) as { video_plan?: { scenes?: PlanScene[] } };
  const scenes = metadata.video_plan?.scenes ?? [];
  const checks = [
    ...scoreUnderstanding(sourceAssets.map((asset) => ((asset.metadata ?? {}) as { understanding?: Record<string, unknown> }).understanding ?? {})),
    ...scoreInitialPlan(scenario, {
      imageIds: primaryAssets.map((asset) => asset.id),
      distractorIds: distractorAssets.map((asset) => asset.id),
      scenes,
      markdown: String(resultAsset.body ?? ""),
    }),
  ];
  const result = finalizeScenarioResult(checks);
  expect(result.status, JSON.stringify(checks.filter((item) => item.status === "failed"), null, 2)).toBe("passed");
  return {
    scenarioId: scenario.id,
    apiAssetIds: linkedAssetIds,
    resultAssetId: resultAssetId!,
    directorDraftVisible: true,
    checks,
  };
}
