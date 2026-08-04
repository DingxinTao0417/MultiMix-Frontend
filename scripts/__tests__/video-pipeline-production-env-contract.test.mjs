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

test("production video E2E isolates backend settings with the current MULTIMIX prefix", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.doesNotMatch(source, /CHANGEIN_/);
  for (const variable of [
    "MULTIMIX_AUTH_PROVIDER",
    "MULTIMIX_DATABASE_URL",
    "MULTIMIX_ARTIFACT_DIR",
    "MULTIMIX_LLM_BASE_URL",
    "MULTIMIX_QWEN_FALLBACK_ENABLED",
    "MULTIMIX_VISION_SERVICE_URL",
    "MULTIMIX_CORS_ORIGINS",
  ]) {
    assert.match(source, new RegExp(variable));
  }
});

test("production video E2E can disable BGM without dereferencing an absent catalog", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.doesNotMatch(source, /stagedBgm\.manifestRef/);
  assert.doesNotMatch(source, /stagedBgm\.defaultCatalogId/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_MANIFEST_REF:\s*effectiveBgm\.manifestRef/);
  assert.match(source, /MULTIMIX_VIDEO_BGM_DEFAULT_CATALOG_ID:\s*effectiveBgm\.defaultCatalogId/);
});
