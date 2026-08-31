import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

import { assertPortFree, startLogged, stopChild, waitFor } from "./demo-e2e/environment-manager.mjs";
import { createE2ERunLifecycle } from "./e2e-run-lifecycle.mjs";
import { assertPaidE2EAllowed } from "./paid-e2e-gate.mjs";

const ids = ["01", "02", "03", "04"];

export function parseArgs(args) {
  const value = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
  if (value("--mode")) throw new Error("Demo stable browser mode was removed; use --scenario or --all for the paid live evaluation");
  const scenario = value("--scenario");
  if (scenario && !ids.includes(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  const all = args.includes("--all");
  if (scenario && all) throw new Error("Choose --scenario or --all, not both");
  if (!scenario && !all) throw new Error("Paid live evaluation requires --scenario or --all");
  return { mode: "paid-live", scenarios: all ? ids : [scenario], cleanupProbe: args.includes("--cleanup-probe") };
}

export function writeRunIndex(resultDir, run) {
  const payload = { ...run, status: "passed", generatedAt: new Date().toISOString() };
  const markdown = [`# Demo Material Packs Run ${run.runId}`, "", `- Mode: ${run.mode}`, "- Status: passed", "", ...run.scenarios.flatMap((id) => [`## Scenario ${id}`, "", `- Result: passed`, `- Evidence: scenarios/${id}/evidence.json`, ""])].join("\n");
  fs.writeFileSync(path.join(resultDir, "results.json"), JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(path.join(resultDir, "summary.md"), markdown, "utf8");
}

function findWorkspace(start) {
  let cursor = path.resolve(start);
  while (path.dirname(cursor) !== cursor) {
    if (fs.existsSync(path.join(cursor, "demo_material_packs")) && fs.existsSync(path.join(cursor, "MultiMix-Backend"))) return cursor;
    cursor = path.dirname(cursor);
  }
  throw new Error("Cannot locate MultiMix workspace root");
}

async function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: process.platform === "win32" && command.endsWith(".cmd"), stdio: "inherit", ...options });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  assertPaidE2EAllowed({ suite: "demo-material-packs", env: process.env, args });
  const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const workspaceRoot = findWorkspace(frontendRoot);
  const backendRoot = path.join(workspaceRoot, "MultiMix-Backend");
  const packsRoot = path.join(workspaceRoot, "demo_material_packs");
  const runId = process.env.DEMO_RUN_ID || crypto.randomUUID();
  const resultDir = path.join(frontendRoot, "test-results", "demo-material-packs", runId);
  const lifecycle = createE2ERunLifecycle({ suite: "demo-material-packs", runId, resultDir });
  const { databasePath, artifactDir } = lifecycle;
  const ports = { frontend: 3229, backend: 8298, fixture: 8398 };
  const children = [];
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  console.log(`Temporary SQLite retained until confirmed cleanup: ${databasePath}`);
  let runError;
  try {
    lifecycle.record("environment", "starting", { ...ports, mode: options.mode });
    fs.mkdirSync(resultDir, { recursive: true });
    await Promise.all(Object.values(ports).map(assertPortFree));
    const databaseUrl = `sqlite:///${databasePath.replaceAll("\\", "/")}`;
    const backendEnv = { ...process.env, MULTIMIX_ENV: "local", MULTIMIX_AUTH_PROVIDER: "local", MULTIMIX_DATABASE_URL: databaseUrl, MULTIMIX_ARTIFACT_DIR: artifactDir, MULTIMIX_SUPABASE_URL: "", MULTIMIX_SUPABASE_SERVICE_ROLE_KEY: "", MULTIMIX_MODULES_MONITORING_ENABLED: "false", MULTIMIX_MODULES_VIDEO_ORCHESTRATION_ENABLED: "true", MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${ports.frontend}` };
    const backend = startLogged(process.env.PYTHON ?? "python", ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(ports.backend)], { cwd: backendRoot, env: backendEnv, logPath: path.join(resultDir, "backend.log") });
    children.push(backend); await waitFor(`http://127.0.0.1:${ports.backend}/healthz`, backend.child, 90_000);
    const frontendEnv = { ...process.env, NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${ports.backend}`, NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" };
    const frontend = startLogged(npm, ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(ports.frontend)], { cwd: frontendRoot, env: frontendEnv, logPath: path.join(resultDir, "frontend.log") });
    children.push(frontend); await waitFor(`http://127.0.0.1:${ports.frontend}/app/assets`, frontend.child, 120_000);
    if (options.cleanupProbe) throw new Error("Intentional demo cleanup probe");
    await run(npx, ["playwright", "test", "e2e/demo-material-packs/demo-material-packs.spec.ts"], { cwd: frontendRoot, env: { ...frontendEnv, DEMO_PACKS_ROOT: packsRoot, DEMO_RUN_ID: runId, DEMO_MODE: options.mode, DEMO_SCENARIOS: options.scenarios.join(","), DEMO_BACKEND_URL: `http://127.0.0.1:${ports.backend}`, DEMO_RESULT_DIR: resultDir, PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${ports.frontend}`, PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright") } });
    writeRunIndex(resultDir, { runId, mode: options.mode, scenarios: options.scenarios });
    lifecycle.record("playwright", "passed");
  } catch (error) {
    runError = error;
    lifecycle.record("run", "failed", { errorName: error?.name ?? "Error" });
    throw error;
  } finally {
    for (const started of children.reverse()) await stopChild(started.child);
    for (const started of children) started.log.end();
    lifecycle.finish(runError ? "failed_retained" : "passed_pending_cleanup", { retainedForConfirmation: true });
    console.log(`E2E runtime retained: ${lifecycle.runDir}. Clean with npm run e2e:cleanup -- demo-material-packs/${runId} --confirm`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = error.message.includes("requires") || error.message.includes("Unknown") ? 2 : 1; });
