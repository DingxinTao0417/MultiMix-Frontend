import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  assertPortFree,
  safeRemoveRunDatabaseWithRetries,
  startLogged,
  stopChild,
  waitFor,
} from "./demo-e2e/environment-manager.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const backendRoot = process.env.MULTIMIX_BACKEND_ROOT
  ? path.resolve(process.env.MULTIMIX_BACKEND_ROOT)
  : path.resolve(frontendRoot, "..", "MultiMix-Backend");
const backendPort = Number(process.env.PRODUCT_POSITIONING_BACKEND_PORT ?? 8298);
const frontendPort = Number(process.env.PRODUCT_POSITIONING_FRONTEND_PORT ?? 3220);
const runId = process.env.PRODUCT_POSITIONING_RUN_ID ?? crypto.randomUUID();

if (!Number.isInteger(backendPort) || backendPort < 1024 || backendPort > 65535) {
  throw new Error("PRODUCT_POSITIONING_BACKEND_PORT must be an integer between 1024 and 65535");
}
if (!Number.isInteger(frontendPort) || frontendPort < 1024 || frontendPort > 65535) {
  throw new Error("PRODUCT_POSITIONING_FRONTEND_PORT must be an integer between 1024 and 65535");
}
if (!/^[a-zA-Z0-9-]+$/.test(runId)) {
  throw new Error("PRODUCT_POSITIONING_RUN_ID must contain only letters, numbers, and hyphens");
}

const databasePath = path.join(os.tmpdir(), `multimix-product-positioning-${runId}.sqlite3`);
const artifactDir = path.join(os.tmpdir(), `multimix-product-positioning-artifacts-${runId}`);
const resultDir = path.join(frontendRoot, "test-results", "product-positioning", runId);
const nextDistDirName = `.next-product-positioning-${runId}`;
const nextDistDir = path.join(frontendRoot, nextDistDirName);
const children = [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const bundledPython = process.platform === "win32"
  ? path.join(backendRoot, ".venv", "Scripts", "python.exe")
  : path.join(backendRoot, ".venv", "bin", "python");
const pythonCommand = process.env.PYTHON ?? (fs.existsSync(bundledPython) ? bundledPython : "python");

function snapshotWorkspaceFiles(filePaths) {
  return filePaths.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }));
}

function restoreWorkspaceFiles(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.existed && snapshot.contents) fs.writeFileSync(snapshot.filePath, snapshot.contents);
    else fs.rmSync(snapshot.filePath, { force: true });
  }
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

function safeRemoveArtifactDir() {
  const resolved = path.resolve(artifactDir);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())) {
    throw new Error(`Artifact path is outside temp directory: ${resolved}`);
  }
  if (!path.basename(resolved).includes(runId)) {
    throw new Error(`Artifact path does not contain current run id: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

const workspaceFileSnapshots = snapshotWorkspaceFiles([
  path.join(frontendRoot, "next-env.d.ts"),
  path.join(frontendRoot, "tsconfig.json"),
]);
const clearedExternalEnv = {
  MULTIMIX_SUPABASE_URL: "",
  MULTIMIX_SUPABASE_SERVICE_ROLE_KEY: "",
  MULTIMIX_OPENAI_API_KEY: "",
  OPENAI_API_KEY: "",
  ELEVENLABS_API_KEY: "",
  MULTIMIX_TTS_PROVIDER: "",
  MULTIMIX_TTS_API_KEY: "",
  PEXELS_API_KEY: "",
  PIXABAY_API_KEY: "",
};

let runError;
try {
  console.log(`Product positioning temp database: ${databasePath}`);
  console.log(`Product positioning temp artifacts: ${artifactDir}`);
  console.log(`Product positioning evidence: ${resultDir}`);
  if (fs.existsSync(databasePath) || fs.existsSync(artifactDir)) {
    throw new Error(`Run id ${runId} already has temporary data; choose a fresh PRODUCT_POSITIONING_RUN_ID`);
  }

  fs.mkdirSync(resultDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);

  const databaseUrl = `sqlite:///${databasePath.replaceAll("\\", "/")}`;
  const backendEnv = {
    ...process.env,
    ...clearedExternalEnv,
    MULTIMIX_ENV: "local",
    MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_DATABASE_URL: databaseUrl,
    MULTIMIX_ARTIFACT_DIR: artifactDir,
    MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
    MULTIMIX_VIDEO_ORCHESTRATION_INLINE: "false",
  };
  const frontendEnv = {
    ...process.env,
    NEXT_DEV_DIST_DIR: nextDistDirName,
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };

  await run(pythonCommand, ["-m", "app.database_cli", "bootstrap"], {
    cwd: backendRoot,
    env: backendEnv,
    stdout: process.stdout,
    stderr: process.stderr,
  });

  const backend = startProcess(
    pythonCommand,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
    backendRoot,
    backendEnv,
    "backend.log",
  );
  await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend);

  const frontend = startProcess(
    npmCommand,
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
    frontendRoot,
    frontendEnv,
    "frontend.log",
  );
  await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, frontend, 180_000);

  await run(npxCommand, [
    "playwright",
    "test",
    "e2e/product-positioning.spec.ts",
    "--workers",
    "1",
    "--reporter",
    "list",
  ], {
    cwd: frontendRoot,
    env: {
      ...frontendEnv,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
      PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright"),
      PRODUCT_POSITIONING_RESULT_DIR: resultDir,
      PRODUCT_POSITIONING_RUN_ID: runId,
    },
    stdout: process.stdout,
    stderr: process.stderr,
  });
} catch (error) {
  runError = error;
  throw error;
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  fs.rmSync(nextDistDir, { recursive: true, force: true });
  restoreWorkspaceFiles(workspaceFileSnapshots);
  await safeRemoveRunDatabaseWithRetries(databasePath, runId);
  safeRemoveArtifactDir();
  console.log(`Product positioning runtime cleaned (${runError ? "after failure" : "after pass"})`);
}
