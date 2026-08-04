import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  safeRemoveRunDatabase,
  startLogged,
  stopChild,
  waitFor,
} from "./demo-e2e/environment-manager.mjs";
import { createE2ERunLifecycle } from "./e2e-run-lifecycle.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(frontendRoot, "..");
const backendRoot = path.join(workspaceRoot, "MultiMix-Backend");
const runId = (process.env.BGM_E2E_RUN_ID ?? crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, "-");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const resultDir = path.resolve(
  process.env.BGM_E2E_RESULT_DIR
    ?? path.join(workspaceRoot, "..", "multimix-test-results", "video-bgm", timestamp),
);
const lifecycle = createE2ERunLifecycle({ suite: "video-bgm", runId, resultDir });
const { databasePath, artifactDir } = lifecycle;
const nextDistDir = `.next-video-bgm-${runId}`;
const FORBIDDEN_PORTS = new Set([8199, 3117, 3200]);
const children = [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const pythonCommand = process.env.PYTHON ?? path.join(
  backendRoot,
  ".venv",
  "Scripts",
  process.platform === "win32" ? "python.exe" : "python",
);

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && command.endsWith(".cmd"),
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; options.stdout?.write(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += chunk; options.stderr?.write(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => (
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${command} exited ${code}\n${stderr || stdout}`))
    ));
  });
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) return reject(error);
        if (!port || FORBIDDEN_PORTS.has(port)) return findFreePort().then(resolve, reject);
        resolve(port);
      });
    });
  });
}

function configuredPort(name) {
  const raw = process.env[name];
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || FORBIDDEN_PORTS.has(port)) {
    throw new Error(`${name} must be an allowed TCP port between 1024 and 65535`);
  }
  return port;
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

function restoreFiles(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.existed) fs.writeFileSync(snapshot.filePath, snapshot.contents);
    else fs.rmSync(snapshot.filePath, { force: true });
  }
}

async function removeDatabaseWithRetry() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      safeRemoveRunDatabase(databasePath, runId);
      return;
    } catch (error) {
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

async function createSyntheticMedia() {
  await run("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=0x1e3a8a:s=640x360",
    "-frames:v", "1", path.join(artifactDir, "video-orchestration", "e2e", "background.png"),
  ]);
  for (const [relativePath, frequency, duration] of [
    [["e2e", "track-one.m4a"], "440", "12"],
    [["e2e", "track-two.m4a"], "660", "12"],
    [["video-orchestration", "e2e", "narration.m4a"], "880", "30"],
  ]) {
    await run("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `sine=frequency=${frequency}:sample_rate=48000:duration=${duration}`,
      "-af", "volume=0.8,pan=stereo|c0=c0|c1=c0",
      "-c:a", "aac", "-b:a", "192k", path.join(artifactDir, ...relativePath),
    ]);
  }
}

const snapshots = snapshotFiles([
  path.join(frontendRoot, "next-env.d.ts"),
  path.join(frontendRoot, "tsconfig.json"),
]);

let runError;
try {
  lifecycle.record("environment", "starting", { backendPort, frontendPort });
  const backendPort = configuredPort("BGM_E2E_BACKEND_PORT") ?? await findFreePort();
  const frontendPort = configuredPort("BGM_E2E_FRONTEND_PORT") ?? await findFreePort();
  if (
    backendPort === frontendPort
    || FORBIDDEN_PORTS.has(backendPort)
    || FORBIDDEN_PORTS.has(frontendPort)
  ) {
    throw new Error("BGM E2E selected a protected development port");
  }
  console.log(`Video BGM E2E temporary SQLite: ${databasePath}`);
  console.log(`Video BGM E2E temporary ArtifactStore: ${artifactDir}`);
  console.log(`Video BGM E2E ports: backend ${backendPort}, frontend ${frontendPort}`);
  console.log(`Video BGM E2E results: ${resultDir}`);
  console.log("Cleanup: both child processes, SQLite sidecars, temporary ArtifactStore, and isolated Next build are removed in finally.");
  fs.mkdirSync(path.join(artifactDir, "e2e"), { recursive: true });
  fs.mkdirSync(path.join(artifactDir, "video-orchestration", "e2e"), { recursive: true });
  fs.mkdirSync(resultDir, { recursive: true });

  await createSyntheticMedia();
  const databaseUrl = `sqlite:///${databasePath.replaceAll("\\", "/")}`;
  const backendEnv = {
    ...process.env,
    MULTIMIX_ENV: "local",
    MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_AUTH_EMAIL_VERIFICATION_REQUIRED: "false",
    MULTIMIX_DATABASE_URL: databaseUrl,
    MULTIMIX_ARTIFACT_DIR: artifactDir,
    MULTIMIX_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
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
    MULTIMIX_MODULES_MONITORING_ENABLED: "false",
    MULTIMIX_MODULES_VIDEO_ORCHESTRATION_ENABLED: "true",
    MULTIMIX_VIDEO_ORCHESTRATION_INLINE: "true",
    MULTIMIX_VIDEO_BGM_MANIFEST_REF: "local://bgm/catalog/v1/manifest.json",
  };
  const seed = await run(
    pythonCommand,
    ["-m", "tools.seed_video_bgm_e2e", "--database-url", databaseUrl, "--artifact-dir", artifactDir],
    { cwd: backendRoot, env: backendEnv },
  );
  const seedLine = seed.stdout.trim().split(/\r?\n/).at(-1);
  const seedData = JSON.parse(seedLine);

  const backend = startProcess(
    pythonCommand,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
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
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
    frontendRoot,
    frontendEnv,
    "frontend.log",
  );
  await waitFor(`http://127.0.0.1:${frontendPort}/editor?asset=${seedData.narrated_asset_id}`, frontend, 180_000);

  await run(npxCommand, ["playwright", "test", "e2e/video-bgm.spec.ts", "--workers=1"], {
    cwd: frontendRoot,
    env: {
      ...frontendEnv,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
      PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright"),
      BGM_E2E_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
      BGM_E2E_RESULT_DIR: resultDir,
      BGM_E2E_SEED: JSON.stringify(seedData),
    },
    stdout: process.stdout,
    stderr: process.stderr,
  });
  lifecycle.record("playwright", "passed");
} catch (error) {
  runError = error;
  lifecycle.record("run", "failed", { errorName: error?.name ?? "Error" });
  throw error;
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  fs.rmSync(path.join(frontendRoot, nextDistDir), { recursive: true, force: true });
  restoreFiles(snapshots);
  lifecycle.finish(runError ? "failed_retained" : "passed_pending_cleanup", { retainedForConfirmation: true });
  console.log(`E2E runtime retained: ${lifecycle.runDir}. Confirm cleanup with npm run test:e2e:cleanup-run -- video-bgm/${runId} --confirm`);
}
