import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { assertPortFree, startLogged, stopChild, waitFor } from "./demo-e2e/environment-manager.mjs";
import { createOfflineE2EEnv } from "./offline-e2e-env.mjs";

const frontend = path.resolve(import.meta.dirname, "..");
const backend = path.resolve(frontend, "..", "MultiMix-Backend");
const source = "C:/Users/24566/Desktop/multimix-test-results/e2e-runtime/video-pipeline-production/20261001-scene-source-noasset-r3";
const runtime = path.join(backend, ".tmp", "activity-observation-20261001");
const dbPath = path.join(runtime, "runtime.sqlite3");
const artifacts = path.join(runtime, "artifacts");
const evidence = path.join(frontend, "test-results", "activity-observation-20261001");
const distName = ".next-activity-observation-20261001";
const dist = path.join(frontend, distName);
const python = path.join(backend, ".venv", "Scripts", "python.exe");
const generatedFiles = ["next-env.d.ts", "tsconfig.json"].map((name) => {
  const file = path.join(frontend, name);
  return [file, fs.readFileSync(file)];
});
const children = [];
function run(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit", shell: command.endsWith(".cmd") });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Process exited ${result.status}`);
}
function start(command, args, cwd, env, name) {
  const started = startLogged(command, args, { cwd, env, logPath: path.join(evidence, name) });
  children.push(started);
  return started.child;
}

if (fs.existsSync(runtime) || fs.existsSync(dist)) throw new Error("Use a clean, unique activity runtime");
await assertPortFree(8433);
await assertPortFree(3433);
fs.mkdirSync(evidence, { recursive: true });
fs.mkdirSync(runtime, { recursive: true });
try {
  run(python, ["-c", "import sqlite3,sys; source=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.close(); source.close()",
    path.join(source, "runtime.sqlite3"), dbPath], backend, process.env);
  fs.cpSync(path.join(source, "artifacts"), artifacts, { recursive: true });
  const backendEnv = { ...createOfflineE2EEnv(), MULTIMIX_ENV: "local", MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_DATABASE_URL: `sqlite:///${dbPath.replaceAll("\\", "/")}`, MULTIMIX_ARTIFACT_DIR: artifacts,
    MULTIMIX_DATABASE_SCHEMA_BOOTSTRAP_ENABLED: "false", MULTIMIX_VIDEO_ORCHESTRATION_INLINE: "false",
    MULTIMIX_CORS_ORIGINS: "http://127.0.0.1:3433" };
  const api = start(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8433"], backend, backendEnv, "backend.log");
  await waitFor("http://127.0.0.1:8433/healthz", api);
  const frontendEnv = { ...process.env, NEXT_DEV_DIST_DIR: distName,
    NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8433", NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" };
  const web = start("npm.cmd", ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", "3433"], frontend, frontendEnv, "frontend.log");
  await waitFor("http://127.0.0.1:3433/app/assets", web, 180000);
  run("npx.cmd", ["playwright", "test", "e2e/video-activity-observation.spec.ts", "--workers=1", "--reporter=list"], frontend,
    { ...frontendEnv, PLAYWRIGHT_BASE_URL: "http://127.0.0.1:3433", ACTIVITY_BACKEND_URL: "http://127.0.0.1:8433",
      ACTIVITY_EVIDENCE_DIR: evidence, PLAYWRIGHT_OUTPUT_DIR: path.join(evidence, "playwright") });
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  for (const [file, bytes] of generatedFiles) fs.writeFileSync(file, bytes);
  if (path.dirname(runtime) !== path.join(backend, ".tmp") || path.basename(runtime) !== "activity-observation-20261001") {
    throw new Error("Unexpected runtime cleanup target");
  }
  fs.rmSync(runtime, { recursive: true, force: true });
  if (path.dirname(dist) !== frontend || path.basename(dist) !== distName) throw new Error("Unexpected dist target");
  fs.rmSync(dist, { recursive: true, force: true });
  console.log("Activity runtime and owned processes cleaned");
}
