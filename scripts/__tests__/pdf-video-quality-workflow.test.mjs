import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");
const runner = fs.readFileSync(path.join(root, "scripts", "run-pdf-video-quality.mjs"), "utf8");
const spec = fs.readFileSync(path.join(root, "e2e", "pdf-video-quality.spec.ts"), "utf8");

test("isolated runner initializes schema before starting the backend", () => {
  const schema = runner.indexOf("from app.db import create_schema; create_schema()");
  const uvicorn = runner.indexOf('"-m", "uvicorn"');
  assert.ok(schema > -1, "runner must initialize the one-time SQLite schema");
  assert.ok(schema < uvicorn, "schema initialization must occur before uvicorn starts");
});

test("runner reserves dedicated ports and cleans all local test artifacts", () => {
  assert.match(runner, /const backendPort = 8299/);
  assert.match(runner, /const frontendPort = 3317/);
  assert.match(runner, /await removeRunDatabaseWithRetry\(databasePath, runId\)/);
  assert.match(runner, /stopChild\(child\)/);
  assert.match(runner, /CHANGEIN_SUPABASE_URL: ""/);
  assert.match(runner, /CHANGEIN_SUPABASE_SERVICE_ROLE_KEY: ""/);
  assert.match(runner, /CHANGEIN_MG_MODAL_APP_NAME: "multimix-remotion"/);
  assert.match(runner, /CHANGEIN_MG_MODAL_FUNCTION_NAME: "render_mg"/);
  assert.match(runner, /CHANGEIN_REDIS_URL: "redis:\/\/127\.0\.0\.1:1\/0"/);
  assert.doesNotMatch(runner, /8199|3117|3200/);
});

test("browser flow uses the upload button and file chooser", () => {
  assert.match(spec, /multimix-auth-switch/);
  assert.match(spec, /waitForEvent\("filechooser"\)/);
  assert.match(spec, /getByRole\("button", \{ name: "上传 PDF 或文档" \}\)\.click\(\)/);
  assert.match(spec, /chooser\.setFiles\(pdfPath\)/);
});

test("browser flow enters the editor before waiting for export readiness", () => {
  const projectReady = spec.indexOf("waitForVideoProject(page)");
  const enterEditor = spec.indexOf('getByRole("button", { name: "编辑", exact: true })');
  const readyExport = spec.indexOf(
    'getByRole("button", { name: "导出视频", exact: true })',
    enterEditor,
  );
  assert.ok(projectReady > -1);
  assert.ok(enterEditor > projectReady, "the flow must enter the editor after the project appears");
  assert.ok(readyExport > enterEditor, "the flow must wait for the editor-ready export state");
});

test("browser flow waits for a persisted MG overlay before inspecting the editor", () => {
  const editButton = spec.indexOf('getByRole("button", { name: "编辑", exact: true })');
  const waitForOverlay = spec.indexOf("waitForRenderedMgOverlay(", editButton);
  const reload = spec.indexOf("await page.reload()", waitForOverlay);
  const clickEditor = spec.indexOf("await editButton.click()", editButton);
  assert.ok(waitForOverlay > editButton, "the project API must be checked after the main project is ready");
  assert.ok(reload > waitForOverlay, "the workspace must refresh the project snapshot after MG persistence");
  assert.ok(clickEditor > reload, "the editor must open only after the refreshed project includes an overlay");
  assert.match(spec, /track-overlay/);
});

test("browser flow reports the visible editor export error without timing out", () => {
  assert.match(spec, /name: "导出失败，重试", exact: true/);
  assert.match(spec, /Export failed in editor:/);
});

test("export flow treats non-blocking quality reminders as progress, not failures", () => {
  const start = spec.indexOf("async function exportVerifiedVideo");
  const end = spec.indexOf("\ntest(\"uploads a real PDF", start);
  const exportFlow = spec.slice(start, end);
  assert.match(exportFlow, /不阻止导出/);
  assert.match(exportFlow, /continue;/);
});

test("verified export flow waits for a fresh download click and never starts a second render", () => {
  const start = spec.indexOf("async function exportVerifiedVideo");
  const end = spec.indexOf("\ntest(\"uploads a real PDF", start);
  const exportFlow = spec.slice(start, end);
  assert.match(exportFlow, /name: "导出视频", exact: true/);
  assert.match(exportFlow, /name: "下载成片", exact: true/);
  assert.match(exportFlow, /exportButton\.isEnabled\(\{ timeout: 500 \}\)/);
  assert.match(exportFlow, /downloadButton\.isEnabled\(\{ timeout: 500 \}\)/);
  assert.doesNotMatch(exportFlow, /name: \/导出\//);
  assert.doesNotMatch(exportFlow, /name: "再次导出"/);
});

test("runner retries Windows temp database cleanup after child shutdown", () => {
  assert.match(runner, /async function removeRunDatabaseWithRetry/);
  assert.match(runner, /await removeRunDatabaseWithRetry\(databasePath, runId\)/);
});
