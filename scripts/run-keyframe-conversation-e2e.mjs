import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  assertPortFree,
  startLogged,
  stopChild,
  waitFor,
} from "./demo-e2e/environment-manager.mjs";
import { createOfflineE2EEnv } from "./offline-e2e-env.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(workspaceRoot, "MultiMix-Backend");
const databasePath = path.join(
  backendRoot,
  "multimix_keyframe_conversation_e2e_20260912.sqlite3",
);
const resultDir = path.join(frontendRoot, "test-results", "keyframe-conversation");
const backendPort = 8297;
const frontendPort = 3217;
const backendUrl = `http://127.0.0.1:${backendPort}`;
const frontendUrl = `http://127.0.0.1:${frontendPort}`;
const python = process.env.PYTHON
  ?? "C:\\Users\\24566\\Desktop\\multimix\\MultiMix-Backend\\.venv\\Scripts\\python.exe";
const children = [];
let browser;
let ownsDatabase = false;
const report = { status: "running", paidCalls: 0, checks: [] };

function start(command, args, cwd, env, name) {
  const item = startLogged(command, args, {
    cwd,
    env,
    logPath: path.join(resultDir, name),
  });
  children.push(item);
  return item.child;
}

async function readState(conversationId) {
  const response = await fetch(
    `${backendUrl}/__test__/state?conversation_id=${encodeURIComponent(conversationId)}`,
  );
  assert.equal(response.status, 200);
  return response.json();
}

async function removeFileWithRetry(filePath) {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      fs.rmSync(filePath, { force: true });
      return;
    } catch (error) {
      if (attempt === 20 || !["EBUSY", "EPERM"].includes(error?.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function openCase(page, seed, caseName) {
  await page.goto(
    `${frontendUrl}/app/assets?conversation=${seed.conversations[caseName]}`
      + `&product=asset-${seed.director_id}`,
  );
  await page.getByText("生成视频前需要先完成这些关键帧：", { exact: false }).waitFor({
    timeout: 45000,
  });
  assert.equal(
    await page.getByRole("button", { name: "采纳关键帧建议", exact: true }).count(),
    0,
  );
}

async function sendMessage(page, instruction) {
  const submitted = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith("/v1/assets/conversations/messages")
  ));
  await page.getByLabel("输入对话内容").fill(instruction);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await submitted;
  assert.equal(response.status(), 201, await response.text());
}

try {
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);
  assert.equal(fs.existsSync(databasePath), false, "Refuse to overwrite test database");
  ownsDatabase = true;
  fs.mkdirSync(resultDir, { recursive: true });
  const offlineEnv = createOfflineE2EEnv();
  const backendEnv = {
    ...offlineEnv,
    KEYFRAME_CONVERSATION_OFFLINE_E2E: "1",
    MULTIMIX_DATABASE_URL: `sqlite:///${databasePath.replaceAll("\\", "/")}`,
    MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_SECRET_KEY: "offline-keyframe-e2e-not-a-production-secret",
    MULTIMIX_DATABASE_POOL_WARMUP_ENABLED: "false",
    MULTIMIX_DATABASE_SCHEMA_BOOTSTRAP_ENABLED: "false",
    MULTIMIX_DATABASE_BACKGROUND_BOOTSTRAP_ENABLED: "false",
    MULTIMIX_SCHEMA_COMPATIBILITY_CHECK_ENABLED: "false",
    MULTIMIX_MODULES_MONITORING_ENABLED: "false",
    MULTIMIX_AGENT_RUNTIME_ENABLED: "false",
    MULTIMIX_ASSET_GENERATION_QUEUE_ENABLED: "false",
    MULTIMIX_CORS_ORIGINS: JSON.stringify([frontendUrl]),
  };
  const api = start(
    python,
    [
      "-m",
      "uvicorn",
      "app.tests.keyframe_conversation_e2e_fixture:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(backendPort),
    ],
    backendRoot,
    backendEnv,
    "backend.log",
  );
  await waitFor(`${backendUrl}/__test__/seed`, api, 45000);
  const seed = await (await fetch(`${backendUrl}/__test__/seed`)).json();
  const web = start(
    process.execPath,
    [
      path.join(frontendRoot, "node_modules", "next", "dist", "bin", "next"),
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(frontendPort),
    ],
    frontendRoot,
    {
      ...offlineEnv,
      NEXT_PUBLIC_API_BASE_URL: backendUrl,
      NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    },
    "frontend.log",
  );
  await waitFor(frontendUrl, web, 60000);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(url.hostname)
      || ["data:", "blob:"].includes(url.protocol)
      ? route.continue()
      : route.abort();
  });
  await page.addInitScript(({ token, email }) => {
    localStorage.setItem("multimix_local_user", JSON.stringify({ token, email }));
  }, seed);

  await openCase(page, seed, "partial");
  await sendMessage(page, "采纳第 2 镜");
  await page.getByLabel("确认图片生成 · 待确认").waitFor();
  let state = await readState(seed.conversations.partial);
  assert.deepEqual(state.pending.request.target.scene_ids, ["scene-2"]);
  assert.deepEqual(state.pending.frame_target_bindings.map((item) => item.scene_id), ["scene-2"]);
  assert.equal(state.job_count, 0);
  assert.equal(state.version_count, 1);
  report.checks.push("自然语言局部采纳进入费用确认卡，确认前零任务、零版本变化");

  await openCase(page, seed, "all");
  await sendMessage(page, "全部采纳");
  await page.getByLabel("确认图片生成 · 待确认").waitFor();
  state = await readState(seed.conversations.all);
  assert.deepEqual(state.pending.request.target.scene_ids, ["scene-1", "scene-2"]);
  assert.deepEqual(
    state.pending.frame_target_bindings.map((item) => [item.frame_id, item.scene_id]),
    [["F01", "scene-1"], ["F02", "scene-2"]],
  );
  assert.equal(state.job_count, 0);
  assert.equal(state.version_count, 1);
  report.checks.push("自然语言全部采纳形成单一确认卡和显式逐帧映射");

  await openCase(page, seed, "decline");
  await sendMessage(page, "第 2 镜不要");
  await page.getByText(/已记录你不采纳第 2 镜/).waitFor();
  state = await readState(seed.conversations.decline);
  assert.equal(state.pending, null);
  assert.equal(state.job_count, 0);
  report.checks.push("自然语言拒绝只回复对话，不创建方案或任务");

  await openCase(page, seed, "unclear");
  await sendMessage(page, "按你说的处理");
  await page.getByText(/未能安全确认你要采纳还是拒绝哪些关键帧建议/).waitFor();
  state = await readState(seed.conversations.unclear);
  assert.equal(state.pending, null);
  assert.equal(state.job_count, 0);
  report.checks.push("歧义表达失败关闭，关键帧采纳按钮在所有真实页面均不存在");

  await page.screenshot({
    path: path.join(resultDir, "keyframe-conversation-unclear.png"),
    fullPage: true,
  });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error?.stack ?? error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const item of children.reverse()) {
    await stopChild(item.child);
    item.log.end();
  }
  if (ownsDatabase) {
    assert.equal(path.dirname(databasePath), backendRoot);
    assert.equal(
      path.basename(databasePath),
      "multimix_keyframe_conversation_e2e_20260912.sqlite3",
    );
    for (const suffix of ["", "-wal", "-shm", "-journal"]) {
      await removeFileWithRetry(databasePath + suffix);
    }
  }
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
}
