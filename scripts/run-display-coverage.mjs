import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const backendRoot = path.resolve(frontendRoot, "..", "MultiMix-Backend");
const backendPort = 8299;
const frontendPort = 3219;
const runId = crypto.randomUUID();
const databasePath = path.join(os.tmpdir(), `multimix-display-coverage-${runId}.sqlite3`);
const artifactDir = path.join(os.tmpdir(), `multimix-display-artifacts-${runId}`);
const resultDir = path.join(frontendRoot, "test-results", "display-coverage");
const e2eOnly = process.argv.includes("--e2e-only");
const cleanupProbe = process.argv.includes("--cleanup-probe");
const children = [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32" && command.endsWith(".cmd"), stdio: ["ignore", "pipe", "pipe"], ...options });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; options.stdout?.write(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += chunk; options.stderr?.write(chunk); });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${command} exited ${code}\n${stderr || stdout}`)));
  });
}

function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Test port ${port} is already in use`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

async function waitFor(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`${url} process exited with ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function startLogged(command, args, cwd, env, logName) {
  const log = fs.createWriteStream(path.join(resultDir, logName), { flags: "w" });
  const child = spawn(command, args, { cwd, env, shell: process.platform === "win32" && command.endsWith(".cmd"), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.push({ child, log });
  return child;
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === "win32") {
    await run("taskkill", ["/PID", String(child.pid), "/T", "/F"]).catch(() => {});
  } else {
    child.kill("SIGTERM");
  }
}

const clearedExternalEnv = {
  CHANGEIN_SUPABASE_URL: "",
  CHANGEIN_SUPABASE_SERVICE_ROLE_KEY: "",
  CHANGEIN_OPENAI_API_KEY: "",
  OPENAI_API_KEY: "",
  ELEVENLABS_API_KEY: "",
  PEXELS_API_KEY: "",
  PIXABAY_API_KEY: "",
};

try {
  fs.mkdirSync(resultDir, { recursive: true });
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);

  if (!e2eOnly) {
    await run(npmCommand, ["run", "test:display-components"], { cwd: frontendRoot, env: process.env, stdout: process.stdout, stderr: process.stderr });
  }

  const databaseUrl = `sqlite:///${databasePath.replaceAll("\\", "/")}`;
  const seedResult = await run(process.env.PYTHON ?? "python", [
    "-m", "app.tests.fixtures.display_coverage.cli",
    "--database-url", databaseUrl,
    "--artifact-dir", artifactDir,
  ], { cwd: backendRoot, env: { ...process.env, ...clearedExternalEnv } });
  const seedJson = JSON.parse(seedResult.stdout.trim());

  const backendEnv = {
    ...process.env,
    ...clearedExternalEnv,
    CHANGEIN_ENV: "local",
    CHANGEIN_AUTH_PROVIDER: "local",
    CHANGEIN_DATABASE_URL: databaseUrl,
    CHANGEIN_ARTIFACT_DIR: artifactDir,
    CHANGEIN_DEFAULT_ADMIN_EMAIL: seedJson.user_email,
    CHANGEIN_MODULES_MONITORING_ENABLED: "false",
    CHANGEIN_MODULES_VIDEO_ORCHESTRATION_ENABLED: "true",
    CHANGEIN_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
  };
  const frontendEnv = {
    ...process.env,
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };

  const backend = startLogged(process.env.PYTHON ?? "python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)], backendRoot, backendEnv, "backend.log");
  await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend);
  const frontend = startLogged(npmCommand, ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)], frontendRoot, frontendEnv, "frontend.log");
  await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, frontend, 120_000);
  if (cleanupProbe) throw new Error("Intentional display coverage cleanup probe");

  await run(npxCommand, ["playwright", "test", "e2e/display-area.spec.ts"], {
    cwd: frontendRoot,
    env: { ...frontendEnv, DISPLAY_COVERAGE_SEED_JSON: JSON.stringify(seedJson) },
    stdout: process.stdout,
    stderr: process.stderr,
  });
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(`${databasePath}${suffix}`, { force: true });
  fs.rmSync(artifactDir, { recursive: true, force: true });
}
