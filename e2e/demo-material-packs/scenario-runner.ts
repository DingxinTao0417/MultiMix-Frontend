import { expect, type Page } from "@playwright/test";

import type { DemoApiClient } from "./api-client";
import type { ScenarioDefinition } from "./types";

export type ScenarioEvidence = { scenarioId: string; uiUploadedFiles: string[]; apiAssetIds: number[]; directorDraftVisible: boolean };

export async function runScenario(page: Page, api: DemoApiClient, scenario: ScenarioDefinition): Promise<ScenarioEvidence> {
  await page.goto("/app/assets");
  const composer = page.getByRole("textbox", { name: "输入对话内容" });
  await expect(composer).toBeVisible();
  await page.locator('input[type="file"][accept*="image"]').first().setInputFiles([scenario.primaryImages[0], scenario.distractorImages[0]]);
  const apiAssets = [];
  for (const filePath of [...scenario.primaryImages.slice(1), ...scenario.distractorImages.slice(1)]) apiAssets.push(await api.uploadAsset(filePath));
  await composer.fill(scenario.prompts.initial);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("编导稿", { exact: false }).first()).toBeVisible({ timeout: 90_000 });
  return { scenarioId: scenario.id, uiUploadedFiles: [scenario.primaryImages[0], scenario.distractorImages[0]], apiAssetIds: apiAssets.map((asset) => asset.id), directorDraftVisible: true };
}
