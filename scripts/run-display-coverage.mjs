import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertPortFree, startLogged, stopChild, waitFor } from "./demo-e2e/environment-manager.mjs";
import { cleanupRetainedE2ERun, createE2ERunLifecycle } from "./e2e-run-lifecycle.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const backendRoot = process.env.MULTIMIX_BACKEND_ROOT
  ? path.resolve(process.env.MULTIMIX_BACKEND_ROOT)
  : path.resolve(frontendRoot, "..", "MultiMix-Backend");
const backendPort = Number(process.env.DISPLAY_COVERAGE_BACKEND_PORT ?? 8299);
const frontendPort = Number(process.env.DISPLAY_COVERAGE_FRONTEND_PORT ?? 3219);
if (!Number.isInteger(backendPort) || backendPort < 1024 || backendPort > 65535) {
  throw new Error("DISPLAY_COVERAGE_BACKEND_PORT must be an integer between 1024 and 65535");
}
if (!Number.isInteger(frontendPort) || frontendPort < 1024 || frontendPort > 65535) {
  throw new Error("DISPLAY_COVERAGE_FRONTEND_PORT must be an integer between 1024 and 65535");
}
const runId = process.env.DISPLAY_COVERAGE_RUN_ID ?? crypto.randomUUID();
if (!/^[a-zA-Z0-9-]+$/.test(runId)) throw new Error("DISPLAY_COVERAGE_RUN_ID must contain only letters, numbers, and hyphens");
const nextDistDirName = `.next-display-coverage-${runId}`;
const nextDistDir = path.join(frontendRoot, nextDistDirName);
const resultDir = path.join(frontendRoot, "test-results", "display-coverage");
const lifecycle = createE2ERunLifecycle({ suite: "display-coverage", runId, resultDir });
const { databasePath, artifactDir } = lifecycle;
const e2eOnly = process.argv.includes("--e2e-only");
const cleanupProbe = process.argv.includes("--cleanup-probe");
const exportRecovery = process.argv.includes("--export-recovery");
const updateSnapshots = process.argv.includes("--update-snapshots");
const grepArgument = process.argv.find((argument) => argument.startsWith("--grep="));
const grep = grepArgument?.slice("--grep=".length) ?? "";
const playwrightWorkersArgument = process.argv.find((argument) => argument.startsWith("--playwright-workers="));
const playwrightWorkers = playwrightWorkersArgument?.slice("--playwright-workers=".length) ?? "";
const exportRecoverySignalPath = path.join(lifecycle.runDir, "export-recovery-ready.json");
const exportRecoveryResultPath = path.join(lifecycle.runDir, "export-recovery-result.json");
const children = [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

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

const workspaceFileSnapshots = snapshotWorkspaceFiles([
  path.join(frontendRoot, "next-env.d.ts"),
  path.join(frontendRoot, "tsconfig.json"),
]);

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

function startDisplayProcess(command, args, cwd, env, logName) {
  const started = startLogged(command, args, { cwd, env, logPath: path.join(resultDir, logName) });
  children.push(started);
  return started.child;
}

const clearedExternalEnv = {
  MULTIMIX_SUPABASE_URL: "",
  MULTIMIX_SUPABASE_SERVICE_ROLE_KEY: "",
  MULTIMIX_OPENAI_API_KEY: "",
  OPENAI_API_KEY: "",
  ELEVENLABS_API_KEY: "",
  PEXELS_API_KEY: "",
  PIXABAY_API_KEY: "",
};

let runError;
try {
  lifecycle.record("environment", "starting", { backendPort, frontendPort });
  console.log(`Display coverage temp database: ${databasePath}`);
  console.log(`Display coverage temp artifacts: ${artifactDir}`);
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
    MULTIMIX_ENV: "local",
    MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_DATABASE_URL: databaseUrl,
    MULTIMIX_ARTIFACT_DIR: artifactDir,
    MULTIMIX_DEFAULT_ADMIN_EMAIL: seedJson.user_email,
    MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
    MULTIMIX_VIDEO_ORCHESTRATION_INLINE: "false",
  };
  const frontendEnv = {
    ...process.env,
    NEXT_DEV_DIST_DIR: nextDistDirName,
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "dev-admin",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };

  const recoveryBackendEnv = exportRecovery
    ? { ...backendEnv, DISPLAY_EXPORT_RECOVERY_HOLD_DISPATCH: "true" }
    : backendEnv;
  let backend = startDisplayProcess(
    process.env.PYTHON ?? "python",
    [
      "-m", "uvicorn",
      exportRecovery ? "app.tests.fixtures.display_coverage.export_recovery:app" : "app.main:app",
      "--host", "127.0.0.1",
      "--port", String(backendPort),
    ],
    backendRoot,
    recoveryBackendEnv,
    "backend.log",
  );
  await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend);
  const frontend = startDisplayProcess(npmCommand, ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)], frontendRoot, frontendEnv, "frontend.log");
  await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, frontend, 120_000);
  if (cleanupProbe) throw new Error("Intentional display coverage cleanup probe");

  const playwrightArgs = ["playwright", "test", "e2e/display-area.spec.ts"];
  if (updateSnapshots) playwrightArgs.push("--update-snapshots");
  const effectiveGrep = exportRecovery
    ? "recovers the same export after API and worker restart"
    : grep;
  if (effectiveGrep) playwrightArgs.push("--grep", effectiveGrep);
  if (exportRecovery) playwrightArgs.push("--workers", "1");
  else if (playwrightWorkers) playwrightArgs.push("--workers", playwrightWorkers);
  const playwrightRun = run(npxCommand, playwrightArgs, {
    cwd: frontendRoot,
    env: {
      ...frontendEnv,
      DISPLAY_COVERAGE_SEED_JSON: JSON.stringify(seedJson),
      DISPLAY_EXPORT_RECOVERY: exportRecovery ? "true" : "false",
      DISPLAY_EXPORT_RECOVERY_SIGNAL_PATH: exportRecoverySignalPath,
      DISPLAY_EXPORT_RECOVERY_RESULT_PATH: exportRecoveryResultPath,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
    },
    stdout: process.stdout,
    stderr: process.stderr,
  });
  void playwrightRun.catch(() => {});

  if (exportRecovery) {
    await Promise.race([
      waitForFile(exportRecoverySignalPath, 330_000),
      playwrightRun.then(() => {
        throw new Error("Export recovery Playwright run ended before publishing its restart signal");
      }),
    ]);
    const recoverySignal = JSON.parse(fs.readFileSync(exportRecoverySignalPath, "utf8"));
    if (!/^video-export-/.test(String(recoverySignal.jobId ?? ""))) {
      throw new Error("Export recovery signal did not contain a durable public job id");
    }

    await stopChild(backend);
    backend = startDisplayProcess(
      process.env.PYTHON ?? "python",
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
      backendRoot,
      { ...backendEnv, DISPLAY_EXPORT_RECOVERY_HOLD_DISPATCH: "false" },
      "backend-restarted.log",
    );
    await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend);

    const workerResult = await run(process.env.PYTHON ?? "python", [
      "-m", "app.tests.fixtures.display_coverage.export_recovery",
      "--run-job", recoverySignal.jobId,
    ], {
      cwd: backendRoot,
      env: { ...backendEnv, DISPLAY_EXPORT_RECOVERY_HOLD_DISPATCH: "false" },
      stdout: process.stdout,
      stderr: process.stderr,
    });
    const workerResultJson = workerResult.stdout.trim().split(/\r?\n/).at(-1);
    if (!workerResultJson) throw new Error("Export recovery worker produced no result");
    fs.writeFileSync(exportRecoveryResultPath, workerResultJson, "utf8");
  }

  await playwrightRun;
  lifecycle.record("playwright", "passed");
} catch (error) {
  runError = error;
  lifecycle.record("run", "failed", { errorName: error?.name ?? "Error" });
  throw error;
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  lifecycle.finish(runError ? "failed_retained" : "passed_pending_cleanup", {
    retainedForConfirmation: !exportRecovery,
  });
  fs.rmSync(nextDistDir, { recursive: true, force: true });
  restoreWorkspaceFiles(workspaceFileSnapshots);
  if (exportRecovery) {
    const cleanup = cleanupRetainedE2ERun({ suite: "display-coverage", runId, confirmed: true });
    console.log(`Export recovery runtime cleaned: ${cleanup.runDir}`);
  } else {
    console.log(`E2E runtime retained: ${lifecycle.runDir}. Confirm cleanup with npm run test:e2e:cleanup-run -- display-coverage/${runId} --confirm`);
  }
}

async function waitForFile(filePath, timeoutMs) {
  const startedAt = Date.now();
  while (!fs.existsSync(filePath)) {
    if (Date.now() - startedAt >= timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
