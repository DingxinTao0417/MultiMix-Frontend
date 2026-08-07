import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runnerPath = path.join(scriptsRoot, "run-video-pipeline-production-e2e.mjs");
const productionSpecPath = path.resolve(scriptsRoot, "..", "e2e", "video-pipeline-production.spec.ts");

test("production video E2E isolates backend settings with the current MULTIMIX prefix", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.doesNotMatch(source, /CHANGEIN_/);
  for (const variable of [
    "MULTIMIX_AUTH_PROVIDER",
    "MULTIMIX_DATABASE_URL",
    "MULTIMIX_ARTIFACT_DIR",
    "MULTIMIX_TEST_LLM_SNAPSHOT_DIR",
    "MULTIMIX_LLM_BASE_URL",
    "MULTIMIX_QWEN_FALLBACK_ENABLED",
    "MULTIMIX_VISION_SERVICE_URL",
    "MULTIMIX_CORS_ORIGINS",
  ]) {
    assert.match(source, new RegExp(variable));
  }
});

test("production video E2E uses configured vision service and fails closed for an unconfigured local provider", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(
    source,
    /process\.env\.VIDEO_PIPELINE_VISION_SERVICE_URL\s*\?\?\s*canonicalEnv\.MULTIMIX_VISION_SERVICE_URL/,
  );
  assert.match(source, /Local vision service requires a configured Qwen\/DashScope API key/);
  assert.match(source, /VISION_QWEN_API_KEY:\s*effectiveVisionApiKey/);
  assert.match(source, /VISION_QWEN_BASE_URL:\s*effectiveVisionBaseUrl/);
});

test("production video E2E can disable BGM without dereferencing an absent catalog", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.doesNotMatch(source, /stagedBgm\.manifestRef/);
  assert.doesNotMatch(source, /stagedBgm\.defaultCatalogId/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_MANIFEST_REF:\s*effectiveBgm\.manifestRef/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_DEFAULT_CATALOG_ID:\s*effectiveBgm\.defaultCatalogId/);
});

test("production video E2E writes a timing ledger for runner and browser stages", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /VIDEO_PIPELINE_TIMING_PATH:/);
  for (const stage of [
    "schema_initialization",
    "vision_service_startup",
    "backend_startup",
    "frontend_startup",
    "playwright",
    "candidate_video_verification",
    "qa_report",
  ]) {
    assert.match(source, new RegExp(`lifecycle\\.measure\\("${stage}"`));
  }
  assert.match(source, /E2E stage timings \(slowest first\)/);
  assert.match(source, /Browser pipeline timings \(slowest first\)/);
});

test("production video E2E rejects a final MP4 outside the accepted target duration", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /durationReference/);
  assert.match(source, /!Number\.isFinite\(duration\)\s*\|\|\s*duration <= 0/s);
  assert.match(source, /duration < minimumDurationSeconds\s*\|\|\s*duration > maximumDurationSeconds/s);
  assert.match(source, /duration_seconds=.*expected=/);
});

test("production video browser flow records its major user-visible pipeline waits", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /VIDEO_PIPELINE_TIMING_PATH/);
  for (const stage of [
    "workspace_entry",
    "document_upload",
    "director_generation",
    "video_project_ready",
    "final_browse_recovery",
    "export_preflight",
    "export_preview_ready",
    "export_browser_render",
    "export_download",
  ]) {
    assert.match(source, new RegExp(`measureE2EStage\\("${stage}"`));
  }
});

test("production video E2E reports durable director substage timings separately", () => {
  const runnerSource = fs.readFileSync(runnerPath, "utf8");
  const specSource = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(specSource, /director_phase_/);
  assert.match(specSource, /director_scene_/);
  assert.match(specSource, /timing_events/);
  assert.match(specSource, /progress_events/);
  assert.match(runnerSource, /Director substage timings \(slowest first\)/);
  assert.match(runnerSource, /Director per-scene timings \(slowest first\)/);
  assert.match(runnerSource, /director_phase_/);
});

test("production video E2E observes, but does not require, reviewed product media", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.match(source, /productPresentation/);
  assert.match(source, /productSceneCount/);
  assert.doesNotMatch(source, /the two distinct reviewed product captures must both be used/);
  assert.doesNotMatch(
    source,
    /beforeScenes\.some\(\s*\(scene\) => scene\.primary_visual\?\.source_type === "product_asset"/s,
  );
  assert.doesNotMatch(
    source,
    /previousVisual\?\.source_type === "product_asset"[\s\S]*?continue;/,
  );
  assert.match(source, /const primaryVisualRefs = beforeScenes\.map/);
  assert.match(source, /new Set\(primaryVisualRefs\)\.size/);
});

test("production video E2E retries a transient transport failure while waiting for MG", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const pendingIndex = source.indexOf("const pending = plannedMgScenes.filter");
  const pollStart = source.lastIndexOf("await expect", pendingIndex);
  const mgTerminalPoll = source.slice(pollStart, pendingIndex);

  assert.ok(pendingIndex > -1, "MG terminal poll should remain present");
  assert.match(mgTerminalPoll, /try\s*\{\s*response = await page\.request\.get/s);
  assert.match(mgTerminalPoll, /return `transport-error:/);
});

test("production video E2E validates planned MG without requiring an MG quantity minimum", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");

  assert.doesNotMatch(
    source,
    /director ignored the explicit request for at least one MG scene/,
  );
  assert.match(
    source,
    /if \(plannedMgScenes\.length === 0\) \{\s*projectAsset = current;\s*return "not-needed";/s,
  );
  assert.match(source, /mg-not-dispatched:/);
  assert.match(source, /all enabled MG scenes reached a failed terminal state:/);
  assert.doesNotMatch(
    source,
    /expect\(mgOverlayTrack\?\.elements\?\.length\)\.toBeGreaterThan\(0\)/,
  );
  assert.match(source, /const renderedMgSceneIds = new Set/);
  assert.match(source, /expect\(mgOverlaySceneIds\)\.toEqual\(renderedMgSceneIds\)/);
});

test("production video E2E waits for user-visible completion before UI convergence", () => {
  const source = fs.readFileSync(productionSpecPath, "utf8");
  const functionStart = source.indexOf("async function waitForProjectReady");
  const functionEnd = source.indexOf("function scenesFromAsset", functionStart);
  const readinessWait = source.slice(functionStart, functionEnd);
  const productPoll = readinessWait.indexOf("project.product_status === \"completed\"");
  const pageReload = readinessWait.indexOf("await page.reload");

  assert.ok(functionStart > -1 && functionEnd > functionStart);
  assert.match(readinessWait, /productDeadline = Date\.now\(\) \+ videoJobTimeoutMs/);
  assert.match(readinessWait, /project\.product_status === "failed"/);
  assert.match(readinessWait, /video_product_not_completed_before_timeout/);
  assert.ok(productPoll > -1 && productPoll < pageReload);
});
