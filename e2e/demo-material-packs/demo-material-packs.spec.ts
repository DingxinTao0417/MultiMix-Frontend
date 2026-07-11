import path from "node:path";
import { expect, test } from "@playwright/test";

import { DemoApiClient } from "./api-client";
import { loadScenario } from "./scenario-loader";
import { runScenario } from "./scenario-runner";
import { writeScenarioArtifacts } from "./report-writer";
import type { ScenarioId } from "./types";

const packsRoot = process.env.DEMO_PACKS_ROOT ?? path.resolve(process.cwd(), "..", "..", "..", "demo_material_packs");
const ids = (process.env.DEMO_SCENARIOS ?? "04").split(",") as ScenarioId[];
const seeded = JSON.parse(process.env.DEMO_SEED_JSON ?? "{}") as { conversation_ids?: Record<string, string>; asset_ids?: Record<string, number> };

for (const id of ids) {
  test(`demo material scenario ${id}`, async ({ page, request }) => {
    const api = await DemoApiClient.create(request, process.env.DEMO_BACKEND_URL ?? "http://127.0.0.1:8298");
    let evidence;
    if (process.env.DEMO_MODE === "stable") {
      const conversationId = seeded.conversation_ids?.[id];
      const assetId = seeded.asset_ids?.[id];
      if (!conversationId || !assetId) throw new Error(`Missing stable seed for scenario ${id}`);
      await page.goto(`/app/assets?conversation=${conversationId}`);
      const workspace = page.getByRole("region", { name: "Current product workspace" });
      await expect(workspace).toBeVisible();
      await expect(workspace.getByText("编导稿", { exact: false }).first()).toBeVisible();
      const asset = await api.getAsset(assetId);
      const metadata = asset.metadata as { video_plan?: { scenes?: unknown[] } } | undefined;
      expect(metadata?.video_plan?.scenes?.length).toBeGreaterThan(0);
      evidence = { scenarioId: id, stableSeed: true, assetId, sceneCount: metadata?.video_plan?.scenes?.length };
    } else {
      evidence = await runScenario(page, api, loadScenario(packsRoot, id));
    }
    const resultDir = process.env.DEMO_RESULT_DIR;
    if (resultDir) writeScenarioArtifacts(resultDir, id, { id, status: "passed", checks: [] }, evidence);
  });
}
