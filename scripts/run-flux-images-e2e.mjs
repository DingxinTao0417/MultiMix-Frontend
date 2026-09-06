// Isolated real API/worker/browser test. Model calls are replaced only in the Python test harness.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { assertPortFree, startLogged, stopChild, waitFor } from "./demo-e2e/environment-manager.mjs";
import { createOfflineE2EEnv } from "./offline-e2e-env.mjs";

const frontend = path.resolve(import.meta.dirname, "..");
const workspace = path.resolve(frontend, "../../..");
const backend = path.join(workspace, "MultiMix-Backend/.worktrees/codex-flux-product");
assert.ok(fs.existsSync(path.join(backend, "app/tests/flux_e2e_fixture.py")));
const database = path.join(os.tmpdir(), "multimix-flux-review-20260906.sqlite3");
const artifacts = path.join(os.tmpdir(), "multimix-flux-review-20260906-artifacts");
const results = path.join(frontend, "test-results/flux-images-review");
const backendPort = 8391, frontendPort = 3419;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const python = path.join(workspace, "MultiMix-Backend/.venv/Scripts/python.exe");
const children = [];
let browser, owned = false;
const report = { status: "running", paidCalls: 0, checks: [] };

function start(command, args, cwd, env, name) {
  const item = startLogged(command, args, { cwd, env, logPath: path.join(results, name) });
  children.push(item);
  return item.child;
}

try {
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);
  assert.ok(!fs.existsSync(database) && !fs.existsSync(artifacts), "Refuse to overwrite test state");
  owned = true;
  fs.mkdirSync(artifacts);
  fs.mkdirSync(results, { recursive: true });
  const env = { ...createOfflineE2EEnv(), FLUX_OFFLINE_E2E: "1",
    MULTIMIX_DATABASE_URL: `sqlite:///${database.replaceAll("\\", "/")}`,
    MULTIMIX_ARTIFACT_DIR: artifacts, MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_SECRET_KEY: "offline-flux-e2e-not-a-production-secret",
    MULTIMIX_DATABASE_POOL_WARMUP_ENABLED: "false", MULTIMIX_DATABASE_SCHEMA_BOOTSTRAP_ENABLED: "false",
    MULTIMIX_MODULES_MONITORING_ENABLED: "false", MULTIMIX_SCHEMA_COMPATIBILITY_CHECK_ENABLED: "false",
    MULTIMIX_DATABASE_BACKGROUND_BOOTSTRAP_ENABLED: "false",
    MULTIMIX_AGENT_RUNTIME_ENABLED: "false", MULTIMIX_CORS_ORIGINS: JSON.stringify([frontendUrl]),
    MULTIMIX_ASSET_GENERATION_QUEUE_ENABLED: "false",
  };
  const api = start(python, ["-m", "uvicorn", "app.tests.flux_e2e_fixture:app", "--host", "127.0.0.1", "--port", String(backendPort)], backend, env, "backend.log");
  await waitFor(`${backendUrl}/__test__/seed`, api, 45000);
  const seed = await (await fetch(`${backendUrl}/__test__/seed`)).json();
  const headers = { Authorization: `Bearer ${seed.token}` };
  const generated = [];
  for (const payload of [{ purpose: "cover_image", count: 1 }, { purpose: "storyboard_image", count: 3 }, { purpose: "storyboard_image" }]) {
    const response = await fetch(`${backendUrl}/__test__/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(result.images.length, payload.count ?? 4);
    for (const frame of result.images) {
      const detail = await (await fetch(`${backendUrl}/v1/assets/detail/${frame.asset_id}`, { headers })).json();
      assert.equal(detail.asset.metadata.understanding.status, "ready");
      assert.ok(detail.asset.metadata.quality_review.status);
      const media = await fetch(`${backendUrl}/v1/video/media?ref=${encodeURIComponent(frame.storage_ref)}`);
      assert.equal(media.status, 200);
      assert.ok(media.headers.get("content-type").startsWith("image/png"));
    }
    generated.push(result);
  }
  assert.equal(generated.at(-1).calls, 8);
  report.checks.push("cover 1 / explicit keyframes 3 / LLM keyframes 4", "8 persisted understood frame assets", "completed job replay creates no extra FLUX calls", "real media endpoint PNG delivery");
  const web = start(process.execPath, [path.join(workspace, "MultiMix-Frontend/node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(frontendPort)], frontend,
    { ...createOfflineE2EEnv(), NEXT_PUBLIC_API_BASE_URL: backendUrl, NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local" }, "frontend.log");
  await waitFor(frontendUrl, web, 60000);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.addInitScript(({ token, email }) => localStorage.setItem("multimix_local_user", JSON.stringify({ token, email })), seed);
  const group = generated[1];
  await page.goto(`${frontendUrl}/app/assets?conversation=${group.conversation_id}&product=asset-${group.asset_id}`);
  const gallery = page.getByRole("region", { name: "生成图片集" });
  await gallery.waitFor({ timeout: 45000 });
  await page.getByText("分镜图方案 · 9:16 / 1 张", { exact: true }).waitFor();
  assert.equal(await gallery.getByRole("button").count(), 1);
  await gallery.getByRole("button", { name: /^查看 F01 / }).click();
  const mainImage = gallery.getByRole("img", { name: /大图$/ });
  await mainImage.evaluate((image) => image.decode());
  await page.screenshot({ path: path.join(results, "gallery-primary.png"), fullPage: true });
  await page.goto(`${frontendUrl}/app/assets?conversation=${group.conversation_id}&product=asset-${group.images[1].asset_id}`);
  await gallery.waitFor();
  await gallery.getByRole("button", { name: /^查看 F02 / }).click();
  await gallery.getByText("数量：离线测试：多了一个配件。").waitFor();
  await mainImage.evaluate((image) => image.decode());
  await page.screenshot({ path: path.join(results, "gallery-flagged.png"), fullPage: true });
  await page.goto(`${frontendUrl}/app/assets?conversation=${group.conversation_id}&product=asset-${group.images[2].asset_id}`);
  await gallery.waitFor();
  await gallery.getByRole("button", { name: /^查看 F03 / }).click();
  await gallery.getByRole("img", { name: /大图$/ }).evaluate((image) => image.decode());
  await page.screenshot({ path: path.join(results, "gallery-reloaded.png"), fullPage: true });
  report.checks.push("browser independently persists F01/F02/F03 candidates / flagged detail / full PNG decoded");
  await page.getByText("图片库", { exact: true }).first().click();
  await page.locator(".shadcn-prototype-library-media-card").filter({ hasText: "F01" }).first().click();
  const detail = page.getByRole("dialog", { name: /F01.*详情/ });
  await detail.getByText("离线测试生成的方形主体。", { exact: true }).waitFor();
  await page.screenshot({ path: path.join(results, "understood-image-library.png"), fullPage: true });
  const joined = page.waitForResponse((response) => response.request().method() === "PUT" && /\/sources\/\d+$/.test(response.url()));
  await detail.getByRole("button", { name: "加入项目…", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择目标项目" });
  await picker.getByRole("button", { name: /^FLUX 离线闭环/ }).first().click();
  const joinedResponse = await joined;
  assert.equal(joinedResponse.status(), 200);
  const selectedAssetId = Number(joinedResponse.url().split("/").at(-1));
  assert.ok(generated.flatMap((group) => group.images).some((frame) => frame.asset_id === selectedAssetId));
  report.checks.push("browser selects understood generated image and persists its real asset ID into project sources");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const item of children.reverse()) { await stopChild(item.child); item.log.end(); }
  if (owned) {
    assert.equal(path.dirname(database), os.tmpdir());
    assert.equal(path.basename(artifacts), "multimix-flux-review-20260906-artifacts");
    for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(database + suffix, { force: true, maxRetries: 10, retryDelay: 100 });
    fs.rmSync(artifacts, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  fs.mkdirSync(results, { recursive: true });
  fs.writeFileSync(path.join(results, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
