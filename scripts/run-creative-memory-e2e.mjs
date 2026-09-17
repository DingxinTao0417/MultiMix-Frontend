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
import { createOfflineE2EEnv } from "./offline-e2e-env.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const backendRoot = process.env.MULTIMIX_BACKEND_ROOT
  ? path.resolve(process.env.MULTIMIX_BACKEND_ROOT)
  : path.resolve(frontendRoot, "..", "MultiMix-Backend");
const runId = process.env.CREATIVE_MEMORY_RUN_ID ?? crypto.randomUUID();
const backendPort = Number(process.env.CREATIVE_MEMORY_BACKEND_PORT ?? 8297);
const frontendPort = Number(process.env.CREATIVE_MEMORY_FRONTEND_PORT ?? 3221);
if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("Invalid CREATIVE_MEMORY_RUN_ID");
for (const port of [backendPort, frontendPort]) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid E2E port");
}

const databasePath = path.join(os.tmpdir(), `multimix-creative-memory-${runId}.sqlite3`);
const artifactDir = path.join(os.tmpdir(), `multimix-creative-memory-artifacts-${runId}`);
const resultDir = path.join(frontendRoot, "test-results", "creative-memory", runId);
const nextDistDirName = `.next-creative-memory-${runId}`;
const nextDistDir = path.join(frontendRoot, nextDistDirName);
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const bundledPython = process.platform === "win32"
  ? path.join(backendRoot, ".venv", "Scripts", "python.exe")
  : path.join(backendRoot, ".venv", "bin", "python");
const pythonCommand = process.env.PYTHON ?? (fs.existsSync(bundledPython) ? bundledPython : "python");
const children = [];

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
    child.once("exit", (code) => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${command} exited ${code}\n${stderr || stdout}`)));
  });
}

function startProcess(command, args, cwd, env, logName) {
  const started = startLogged(command, args, {
    cwd, env, logPath: path.join(resultDir, logName),
  });
  children.push(started);
  return started.child;
}

function safeRemoveTempDirectory(target, requiredPrefix) {
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())
    || !path.basename(resolved).startsWith(requiredPrefix)
    || !path.basename(resolved).endsWith(runId)) {
    throw new Error(`Unsafe temporary directory target: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function safeRemoveNextDist() {
  const resolved = path.resolve(nextDistDir);
  if (path.dirname(resolved) !== frontendRoot
    || path.basename(resolved) !== nextDistDirName
    || !nextDistDirName.startsWith(".next-creative-memory-")) {
    throw new Error(`Unsafe Next dist target: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

const mutableFiles = ["next-env.d.ts", "tsconfig.json"].map((name) => {
  const filePath = path.join(frontendRoot, name);
  return { filePath, existed: fs.existsSync(filePath), contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null };
});
const offlineEnv = createOfflineE2EEnv(process.env);
let runError;
try {
  console.log(`Creative-memory temp database: ${databasePath}`);
  console.log(`Creative-memory temp artifacts: ${artifactDir}`);
  console.log(`Creative-memory browser evidence: ${resultDir}`);
  if (fs.existsSync(databasePath) || fs.existsSync(artifactDir) || fs.existsSync(nextDistDir)) {
    throw new Error(`Run id ${runId} already has temporary data; choose another ID`);
  }
  fs.mkdirSync(resultDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);

  const backendEnv = {
    ...offlineEnv,
    MULTIMIX_ENV: "local",
    MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_DATABASE_URL: `sqlite:///${databasePath.replaceAll("\\", "/")}`,
    MULTIMIX_ARTIFACT_DIR: artifactDir,
    MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
    MULTIMIX_CREATIVE_MEMORY_CANDIDATE_MODE: "visible",
    MULTIMIX_CREATIVE_MEMORY_CONSUMPTION_ENABLED: "true",
    MULTIMIX_CREATIVE_MEMORY_VISIBLE_USER_IDS: "[1,2,3]",
    MULTIMIX_CREATIVE_MEMORY_SHADOW_USER_IDS: "[]",
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
    cwd: backendRoot, env: backendEnv, stdout: process.stdout, stderr: process.stderr,
  });
  const backend = startProcess(
    pythonCommand,
    ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
    backendRoot, backendEnv, "backend.log",
  );
  await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend);
  const frontend = startProcess(
    npmCommand,
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
    frontendRoot, frontendEnv, "frontend.log",
  );
  await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, frontend, 180_000);
  await run(npxCommand, [
    "playwright", "test", "e2e/creative-memory.spec.ts", "--workers", "1", "--reporter", "list",
  ], {
    cwd: frontendRoot,
    env: {
      ...frontendEnv,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
      PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright"),
      CREATIVE_MEMORY_RESULT_DIR: resultDir,
      CREATIVE_MEMORY_RUN_ID: runId,
      CREATIVE_MEMORY_BACKEND_ROOT: backendRoot,
      CREATIVE_MEMORY_PYTHON: pythonCommand,
      CREATIVE_MEMORY_DATABASE_URL: backendEnv.MULTIMIX_DATABASE_URL,
      MULTIMIX_ENV: backendEnv.MULTIMIX_ENV,
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
  safeRemoveNextDist();
  for (const snapshot of mutableFiles) {
    if (snapshot.existed && snapshot.contents) fs.writeFileSync(snapshot.filePath, snapshot.contents);
    else fs.rmSync(snapshot.filePath, { force: true });
  }
  await safeRemoveRunDatabaseWithRetries(databasePath, runId);
  safeRemoveTempDirectory(artifactDir, "multimix-creative-memory-artifacts-");
  console.log(`Creative-memory runtime cleaned (${runError ? "after failure" : "after pass"})`);
}
