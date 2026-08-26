import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  assertPortFree,
  startLogged,
  stopChild,
  waitFor,
} from "./demo-e2e/environment-manager.mjs";
import { createE2ERunLifecycle } from "./e2e-run-lifecycle.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = resolveWorkspaceRoot(frontendRoot);
const canonicalBackendRoot = path.join(workspaceRoot, "MultiMix-Backend");
const backendRoot = resolveBackendRoot(frontendRoot, canonicalBackendRoot);
const runId = (process.env.AGENT_ATOMIC_E2E_RUN_ID ?? crypto.randomUUID())
  .replace(/[^a-zA-Z0-9-]/g, "-");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const resultDir = path.resolve(
  process.env.AGENT_ATOMIC_E2E_RESULT_DIR
    ?? path.join(frontendRoot, "test-results", "agent-video-atomic", timestamp),
);
const lifecycle = createE2ERunLifecycle({ suite: "agent-video-atomic", runId, resultDir });
const { databasePath, artifactDir } = lifecycle;
const nextDistDir = `.next-agent-video-atomic-${runId}`;
const backendPort = configuredPort("AGENT_ATOMIC_E2E_BACKEND_PORT", 8299);
const frontendPort = configuredPort("AGENT_ATOMIC_E2E_FRONTEND_PORT", 3318);
const children = [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const pythonCommand = process.env.PYTHON ?? path.join(
  canonicalBackendRoot,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "python.exe" : "python",
);
const rqCommand = process.env.RQ_COMMAND ?? path.join(
  canonicalBackendRoot,
  ".venv",
  process.platform === "win32" ? "Scripts" : "bin",
  process.platform === "win32" ? "rq.exe" : "rq",
);
const redisServerCommand = process.env.REDIS_SERVER_COMMAND ?? "redis-server";
const snapshots = snapshotFiles([
  path.join(frontendRoot, "next-env.d.ts"),
  path.join(frontendRoot, "tsconfig.json"),
]);

let fakeProvider = null;
let redisPort = null;
let fakeProviderPort = null;
let backendEnv = null;
let workerStartTimer = null;
let workerStarted = false;
let ownsRunPaths = false;

function resolveWorkspaceRoot(root) {
  const candidates = [
    path.resolve(root, ".."),
    path.resolve(root, "../../.."),
  ];
  const found = candidates.find((candidate) => (
    fs.existsSync(path.join(candidate, "MultiMix-Backend"))
    && fs.existsSync(path.join(candidate, "MultiMix-Frontend"))
  ));
  if (!found) throw new Error(`Cannot resolve MultiMix workspace from ${root}`);
  return found;
}

function resolveBackendRoot(root, canonicalRoot) {
  if (process.env.MULTIMIX_BACKEND_ROOT) {
    return path.resolve(process.env.MULTIMIX_BACKEND_ROOT);
  }
  const worktreeParent = path.basename(path.dirname(root));
  if (worktreeParent === ".worktrees") {
    const matching = path.join(
      canonicalRoot,
      ".worktrees",
      path.basename(root),
    );
    if (fs.existsSync(matching)) return matching;
  }
  return canonicalRoot;
}

function configuredPort(name, fallback) {
  const value = process.env[name] ?? String(fallback);
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`${name} must be a TCP port between 1024 and 65535`);
  }
  if ([8199, 3117, 3200].includes(port)) {
    throw new Error(`${name} cannot use a protected developer port`);
  }
  return port;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else if (!port || [8199, 3117, 3200].includes(port)) {
          findFreePort().then(resolve, reject);
        } else {
          resolve(port);
        }
      });
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && command.endsWith(".cmd"),
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
      options.stdout?.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
      options.stderr?.write(chunk);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stderr || stdout}`));
    });
  });
}

function startProcess(command, args, cwd, env, logName) {
  const started = startLogged(command, args, {
    cwd,
    env,
    logPath: path.join(resultDir, logName),
  });
  children.push(started);
  return started.child;
}

function snapshotFiles(paths) {
  return paths.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }));
}

function restoreFiles(files) {
  for (const snapshot of files) {
    if (snapshot.existed) fs.writeFileSync(snapshot.filePath, snapshot.contents);
    else fs.rmSync(snapshot.filePath, { force: true });
  }
}

async function waitForPort(port, child, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) {
      throw new Error(`Port ${port} process exited with ${child.exitCode}`);
    }
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host: "127.0.0.1", port });
        socket.setTimeout(500);
        socket.once("connect", () => {
          socket.destroy();
          resolve();
        });
        socket.once("timeout", () => {
          socket.destroy();
          reject(new Error("timeout"));
        });
        socket.once("error", reject);
      });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`Timed out waiting for port ${port}`);
}

async function assertPortEventuallyFree(port) {
  let lastError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await assertPortFree(port);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function createSyntheticAudio(audioPath) {
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  await run("ffmpeg", [
    "-y",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=24000:duration=15",
    "-q:a",
    "4",
    audioPath,
  ]);
}

function extractTurnContext(requestBody) {
  const messages = Array.isArray(requestBody?.messages)
    ? requestBody.messages
    : [];
  const content = String(messages.at(-1)?.content ?? "");
  try {
    const payload = JSON.parse(content);
    if (payload && typeof payload === "object") {
      return {
        context: payload.context && typeof payload.context === "object"
          ? payload.context
          : {},
        instruction: String(payload.trusted_user_task ?? "").trim(),
      };
    }
  } catch {
    // Retain compatibility with the legacy text prompt below.
  }
  const marker = "\n\nUser message:\n";
  const markerIndex = content.lastIndexOf(marker);
  const contextText = markerIndex >= 0
    ? content.slice("Context:\n".length, markerIndex)
    : "{}";
  const instruction = markerIndex >= 0
    ? content.slice(markerIndex + marker.length).trim()
    : content.trim();
  try {
    return { context: JSON.parse(contextText), instruction };
  } catch {
    return { context: {}, instruction };
  }
}

function fakeInterpretation(requestBody) {
  const { context, instruction } = extractTurnContext(requestBody);
  if (instruction.includes("第1个分镜") && instruction.includes("逐词高亮")) {
    scheduleWorkerStart();
    return {
      turn_kind: "act", task_relation: "continue_active", control_action: null,
      goal: "调整第一分镜字幕效果", task_id_hint: null,
      proposed_actions: [{
        action_id: "video.scene.set_subtitle_presentation",
        target_hint: { scope: "scene", scene_id: "scene-1" },
        parameters: { mode: "word_highlight", background_enabled: false },
        reference_asset_ids: [], missing_fields: [],
        reason: "用户指定逐词高亮并保持无背景。",
      }],
      confidence: 0.99, reason: "explicit_subtitle_word_highlight",
    };
  }
  if (instruction.includes("第2个分镜") && instruction.includes("卡拉 OK")) {
    scheduleWorkerStart();
    return {
      turn_kind: "act", task_relation: "continue_active", control_action: null,
      goal: "调整第二分镜字幕效果", task_id_hint: null,
      proposed_actions: [{
        action_id: "video.scene.set_subtitle_presentation",
        target_hint: { scope: "scene", scene_id: "scene-2" },
        parameters: { mode: "karaoke", background_enabled: true, background_color: "#101010cc" },
        reference_asset_ids: [], missing_fields: [],
        reason: "用户指定卡拉 OK 和深色背景。",
      }],
      confidence: 0.99, reason: "explicit_subtitle_karaoke",
    };
  }
  if (instruction.includes("第2个分镜") && instruction.includes("图片")) {
    const references = Array.isArray(context.reference_assets)
      ? context.reference_assets
      : [];
    const sourceAssetId = Number(references[0]?.id);
    if (!Number.isInteger(sourceAssetId) || sourceAssetId <= 0) {
      return {
        turn_kind: "clarify",
        task_relation: "continue_active",
        control_action: null,
        goal: "替换第二分镜素材",
        task_id_hint: null,
        proposed_actions: [],
        confidence: 0.99,
        reason: "missing_reference_asset",
      };
    }
    scheduleWorkerStart();
    return {
      turn_kind: "act",
      task_relation: "continue_active",
      control_action: null,
      goal: "替换第二分镜素材",
      task_id_hint: null,
      proposed_actions: [{
        action_id: "video.scene.replace_material",
        target_hint: { scope: "scene", scene_id: "scene-2" },
        parameters: { source_asset_id: sourceAssetId },
        reference_asset_ids: [sourceAssetId],
        missing_fields: [],
        reason: "用户明确指定第二分镜和已加入的图片素材。",
      }],
      confidence: 0.99,
      reason: "explicit_scene_and_reference",
    };
  }
  if (instruction.includes("整支视频") && instruction.includes("沉稳男声")) {
    return {
      turn_kind: "act",
      task_relation: "start_new",
      control_action: null,
      goal: "统一全片声音",
      task_id_hint: null,
      proposed_actions: [{
        action_id: "video.project.set_voice",
        target_hint: { scope: "project" },
        parameters: { voice_name: "male_steady", voice_speed: 1.0 },
        reference_asset_ids: [],
        missing_fields: [],
        reason: "用户要求整支视频统一换声。",
      }],
      confidence: 0.99,
      reason: "explicit_project_voice",
    };
  }
  if (instruction.includes("发布") && instruction.includes("平台")) {
    return {
      turn_kind: "act",
      task_relation: "continue_active",
      control_action: null,
      goal: "发布视频",
      task_id_hint: null,
      proposed_actions: [{
        action_id: "video.project.publish",
        target_hint: { scope: "project" },
        parameters: {},
        reference_asset_ids: [],
        missing_fields: [],
        reason: "用户请求了当前注册表没有提供的发布能力。",
      }],
      confidence: 0.99,
      reason: "unsupported_publish",
    };
  }
  return {
    turn_kind: "clarify",
    task_relation: context.current_task ? "continue_active" : "none",
    control_action: null,
    goal: "",
    task_id_hint: null,
    proposed_actions: [],
    confidence: 0.5,
    reason: "fixture_has_no_matching_turn",
  };
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("Fake provider request is too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function startFakeProvider(audioPath) {
  const audio = fs.readFileSync(audioPath);
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }
      if (request.url === "/v1/audio/speech") {
        await readRequestBody(request);
        response.writeHead(200, {
          "Content-Type": "audio/mpeg",
          "Content-Length": String(audio.length),
        });
        response.end(audio);
        return;
      }
      if (request.url === "/v1/chat/completions") {
        const raw = await readRequestBody(request);
        const body = JSON.parse(raw.toString("utf8"));
        const interpretation = fakeInterpretation(body);
        const payload = JSON.stringify({
          choices: [{
            message: {
              role: "assistant",
              content: JSON.stringify(interpretation),
            },
          }],
        });
        response.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload)),
        });
        response.end(payload);
        return;
      }
      response.writeHead(404).end();
    } catch (error) {
      const message = JSON.stringify({ error: String(error?.message ?? error) });
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(message);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

function scheduleWorkerStart() {
  if (workerStarted || workerStartTimer) return;
  workerStartTimer = setTimeout(() => {
    workerStartTimer = null;
    if (workerStarted || !backendEnv || redisPort === null) return;
    workerStarted = true;
    startProcess(
      rqCommand,
      [
        "worker",
        "--worker-class",
        "rq.worker.SimpleWorker",
        "--url",
        `redis://127.0.0.1:${redisPort}/0`,
        "video_orchestration",
      ],
      backendRoot,
      backendEnv,
      "rq-worker.log",
    );
  }, 1500);
}

async function closeServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(() => resolve()));
}

let runError;
try {
  lifecycle.record("environment", "starting", { backendPort, frontendPort });
  if (backendPort === frontendPort) {
    throw new Error("Backend and frontend E2E ports must be different");
  }
  await Promise.all([
    assertPortFree(backendPort),
    assertPortFree(frontendPort),
  ]);
  if (fs.existsSync(databasePath) || fs.existsSync(artifactDir)) {
    throw new Error(`Refusing to overwrite an existing isolated run path for ${runId}`);
  }

  redisPort = await findFreePort();
  await assertPortFree(redisPort);
  fs.mkdirSync(artifactDir, { recursive: true });
  fs.mkdirSync(resultDir, { recursive: true });
  ownsRunPaths = true;

  const fakeAudioPath = path.join(artifactDir, "fake-provider", "speech.mp3");
  await createSyntheticAudio(fakeAudioPath);
  fakeProvider = await startFakeProvider(fakeAudioPath);
  const address = fakeProvider.address();
  fakeProviderPort = typeof address === "object" && address ? address.port : null;
  if (!fakeProviderPort) throw new Error("Fake provider did not bind a port");

  console.log(`Agent atomic E2E temporary SQLite: ${databasePath}`);
  console.log(`Agent atomic E2E temporary ArtifactStore: ${artifactDir}`);
  console.log(`Agent atomic E2E ports: backend ${backendPort}, frontend ${frontendPort}`);
  console.log(
    `Agent atomic E2E isolated helpers: Redis ${redisPort}, fake provider ${fakeProviderPort}`,
  );
  console.log(`Agent atomic E2E results: ${resultDir}`);
  console.log(
    "Cleanup: only this runner's processes are terminated; SQLite sidecars, "
      + "temporary ArtifactStore, and isolated Next build are removed in finally.",
  );

  const redis = startProcess(
    redisServerCommand,
    [
      "--port",
      String(redisPort),
      "--bind",
      "127.0.0.1",
      "--protected-mode",
      "no",
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      artifactDir,
    ],
    artifactDir,
    process.env,
    "redis.log",
  );
  await waitForPort(redisPort, redis);

  const databaseUrl = `sqlite:///${databasePath.replaceAll("\\", "/")}`;
  const fakeProviderBaseUrl = `http://127.0.0.1:${fakeProviderPort}/v1`;
  backendEnv = {
    ...process.env,
    MULTIMIX_ENV: "local",
    MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_AUTH_EMAIL_VERIFICATION_REQUIRED: "false",
    MULTIMIX_DATABASE_URL: databaseUrl,
    MULTIMIX_ARTIFACT_DIR: artifactDir,
    MULTIMIX_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
    MULTIMIX_REDIS_URL: `redis://127.0.0.1:${redisPort}/0`,
    MULTIMIX_VIDEO_ORCHESTRATION_QUEUE_NAME: "video_orchestration",
    MULTIMIX_VIDEO_ORCHESTRATION_INLINE: "false",
    MULTIMIX_MODULES_VIDEO_ORCHESTRATION_ENABLED: "true",
    MULTIMIX_MODULES_MONITORING_ENABLED: "false",
    MULTIMIX_ASSET_GENERATION_QUEUE_ENABLED: "false",
    MULTIMIX_LLM_BASE_URL: fakeProviderBaseUrl,
    MULTIMIX_LLM_API_KEY: "agent-atomic-e2e-local",
    MULTIMIX_LLM_MODEL: "agent-atomic-e2e-json",
    MULTIMIX_LLM_TIMEOUT_SECONDS: "10",
    MULTIMIX_TTS_PROVIDER: "openai",
    MULTIMIX_TTS_API_KEY: "agent-atomic-e2e-local",
    MULTIMIX_TTS_BASE_URL: fakeProviderBaseUrl,
    MULTIMIX_TTS_MODEL: "gpt-4o-mini-tts",
    MULTIMIX_TTS_TIMEOUT_SECONDS: "10",
    MULTIMIX_VIDEO_NARRATION_MAX_ESTIMATE_RATIO: "10",
    MULTIMIX_SUPABASE_URL: "",
    MULTIMIX_SUPABASE_PUBLISHABLE_KEY: "",
    MULTIMIX_SUPABASE_ANON_KEY: "",
    MULTIMIX_SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    MULTIMIX_S3_ENDPOINT_URL: "",
    MULTIMIX_S3_ACCESS_KEY: "",
    MULTIMIX_S3_SECRET_KEY: "",
    MULTIMIX_DEEPSEEK_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    OPENAI_API_KEY: "",
    LLM_API_KEY: "",
    MULTIMIX_IMAGE_GENERATION_API_KEY: "",
    MULTIMIX_IMAGE_TO_VIDEO_API_KEY: "",
    MULTIMIX_PEXELS_API_KEY: "",
    MULTIMIX_PIXABAY_API_KEY: "",
    MULTIMIX_MODAL_TOKEN_ID: "",
    MULTIMIX_MODAL_TOKEN_SECRET: "",
  };

  const seed = await run(
    pythonCommand,
    [
      "-m",
      "tools.seed_agent_video_atomic_e2e",
      "--database-url",
      databaseUrl,
      "--artifact-dir",
      artifactDir,
    ],
    { cwd: backendRoot, env: backendEnv },
  );
  const seedLine = seed.stdout.trim().split(/\r?\n/).at(-1);
  const seedData = JSON.parse(seedLine);

  const backend = startProcess(
    pythonCommand,
    [
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(backendPort),
    ],
    backendRoot,
    backendEnv,
    "backend.log",
  );
  await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend, 120_000);

  const frontendEnv = {
    ...process.env,
    NEXT_DEV_DIST_DIR: nextDistDir,
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };
  const frontend = startProcess(
    npmCommand,
    [
      "run",
      "dev",
      "--",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(frontendPort),
    ],
    frontendRoot,
    frontendEnv,
    "frontend.log",
  );
  await waitFor(
    `http://127.0.0.1:${frontendPort}/app/assets`,
    frontend,
    180_000,
  );

  await run(
    npxCommand,
    [
      "playwright",
      "test",
      process.env.AGENT_ATOMIC_E2E_SPEC ?? "e2e/agent-video-atomic-edit.spec.ts",
      "--workers=1",
    ],
    {
      cwd: frontendRoot,
      env: {
        ...frontendEnv,
        PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
        PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright"),
        AGENT_ATOMIC_E2E_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
        AGENT_ATOMIC_E2E_SEED: JSON.stringify(seedData),
      },
      stdout: process.stdout,
      stderr: process.stderr,
    },
  );
  lifecycle.record("playwright", "passed");
} catch (error) {
  runError = error;
  lifecycle.record("run", "failed", { errorName: error?.name ?? "Error" });
  throw error;
} finally {
  if (workerStartTimer) {
    clearTimeout(workerStartTimer);
    workerStartTimer = null;
  }
  await closeServer(fakeProvider);
  for (const { child } of [...children].reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  if (ownsRunPaths) {
    fs.rmSync(path.join(frontendRoot, nextDistDir), {
      recursive: true,
      force: true,
    });
  }
  restoreFiles(snapshots);
  await Promise.all([
    assertPortEventuallyFree(backendPort),
    assertPortEventuallyFree(frontendPort),
    ...(redisPort ? [assertPortEventuallyFree(redisPort)] : []),
    ...(fakeProviderPort ? [assertPortEventuallyFree(fakeProviderPort)] : []),
  ]);
  lifecycle.finish(runError ? "failed_retained" : "passed_pending_cleanup", { retainedForConfirmation: true });
  console.log(`E2E runtime retained: ${lifecycle.runDir}. Confirm cleanup with npm run test:e2e:cleanup-run -- agent-video-atomic/${runId} --confirm`);
}
