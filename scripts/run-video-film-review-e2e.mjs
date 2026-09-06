// Isolated workbench integration with controlled review responses; no paid providers.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { assertPortFree, startLogged, stopChild, waitFor } from "./demo-e2e/environment-manager.mjs";
import { createE2ERunLifecycle, finalizeE2ERun, cleanupRetainedE2ERun } from "./e2e-run-lifecycle.mjs";
import { createOfflineE2EEnv } from "./offline-e2e-env.mjs";

const frontend = path.resolve(import.meta.dirname, "..");
const backend = path.resolve(frontend, "../MultiMix-Backend");
const runId = process.env.FILM_REVIEW_RUN_ID ?? `review-${Date.now()}`;
const backendPort = 8397;
const frontendPort = 3297;
const resultDir = path.join(frontend, "test-results/video-film-review");
const lifecycle = createE2ERunLifecycle({ suite: "video-film-review", runId, resultDir });
const distName = `.next-film-review-${runId}`;
const distPath = path.resolve(frontend, distName);
if (path.dirname(distPath) !== frontend || !distName.startsWith(".next-film-review-")) throw new Error("Invalid isolated build path");
const snapshots = ["next-env.d.ts", "tsconfig.json"].map((name) => ({
  path: path.join(frontend, name), content: fs.readFileSync(path.join(frontend, name)),
}));
const children = [];
const python = process.env.PYTHON ?? path.join(backend, ".venv/Scripts/python.exe");
const offline = createOfflineE2EEnv(process.env);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: command.endsWith(".cmd"), windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(output) : reject(new Error(output)));
  });
}
function start(command, args, cwd, env, name) {
  const process = startLogged(command, args, { cwd, env, logPath: path.join(resultDir, name) });
  children.push(process);
  return process.child;
}
let failed = false;
try {
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);
  fs.mkdirSync(resultDir, { recursive: true });
  console.log(`Temporary database: ${lifecycle.databasePath}`);
  const databaseUrl = `sqlite:///${lifecycle.databasePath.replaceAll("\\", "/")}`;
  const seed = JSON.parse((await run(python, ["-m", "app.tests.fixtures.display_coverage.cli",
    "--database-url", databaseUrl, "--artifact-dir", lifecycle.artifactDir], { cwd: backend, env: offline })).trim());
  const backendEnv = { ...offline, MULTIMIX_ENV: "local", MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_DATABASE_URL: databaseUrl, MULTIMIX_ARTIFACT_DIR: lifecycle.artifactDir,
    MULTIMIX_DEFAULT_ADMIN_EMAIL: seed.user_email, MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}` };
  const frontendEnv = { ...offline, NEXT_DEV_DIST_DIR: distName,
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`, NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "dev-admin",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" };
  const api = start(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
    backend, backendEnv, "backend.log");
  await waitFor(`http://127.0.0.1:${backendPort}/healthz`, api);
  const web = start(npm, ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
    frontend, frontendEnv, "frontend.log");
  await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, web, 120000);
  console.log(await run(npx, ["playwright", "test", "e2e/video-film-review.spec.ts", "--workers", "1"], {
    cwd: frontend, env: { ...frontendEnv, DISPLAY_COVERAGE_SEED_JSON: JSON.stringify(seed),
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`, PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright") },
  }));
} catch (error) {
  failed = true;
  throw error;
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  fs.rmSync(distPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  for (const snapshot of snapshots) fs.writeFileSync(snapshot.path, snapshot.content);
  const result = finalizeE2ERun({ lifecycle, failed });
  if (result.retained) cleanupRetainedE2ERun({ suite: lifecycle.suite, runId, confirmed: true });
  console.log("Stopped isolated services and removed temporary database, artifacts and build.");
}
