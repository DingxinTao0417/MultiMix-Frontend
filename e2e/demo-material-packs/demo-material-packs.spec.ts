import path from "node:path";
import { test } from "@playwright/test";

import { DemoApiClient } from "./api-client";
import { loadScenario } from "./scenario-loader";
import { runScenario } from "./scenario-runner";
import type { ScenarioId } from "./types";

const packsRoot = process.env.DEMO_PACKS_ROOT ?? path.resolve(process.cwd(), "..", "..", "..", "demo_material_packs");
const ids = (process.env.DEMO_SCENARIOS ?? "04").split(",") as ScenarioId[];

for (const id of ids) {
  test(`demo material scenario ${id}`, async ({ page, request }) => {
    const api = new DemoApiClient(request, process.env.DEMO_BACKEND_URL ?? "http://127.0.0.1:8298");
    await runScenario(page, api, loadScenario(packsRoot, id));
  });
}
