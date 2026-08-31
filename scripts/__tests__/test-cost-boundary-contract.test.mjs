import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("every offline browser runner builds its backend environment through the shared sanitizer", () => {
  for (const relativePath of [
    "scripts/run-display-coverage.mjs",
    "scripts/run-product-positioning-e2e.mjs",
    "scripts/run-admin-product-metrics-e2e.mjs",
    "scripts/run-video-bgm-e2e.mjs",
    "scripts/run-agent-video-atomic-e2e.mjs",
  ]) {
    const runner = source(relativePath);
    assert.match(runner, /createOfflineE2EEnv/);
    assert.doesNotMatch(runner, /const clearedExternalEnv\s*=/);
  }
});

test("provider-backed demo and production video suites require explicit paid opt-in", () => {
  for (const relativePath of [
    "scripts/run-demo-material-packs.mjs",
    "scripts/run-video-pipeline-production-e2e.mjs",
  ]) {
    assert.match(source(relativePath), /assertPaidE2EAllowed/);
  }
});

test("the production paid gate runs before canonical provider credentials are loaded", () => {
  const runner = source("scripts/run-video-pipeline-production-e2e.mjs");
  const gate = runner.indexOf("assertPaidE2EAllowed(");
  const envLoad = runner.indexOf("const baseCanonicalEnv = parseEnvFile");
  assert.ok(gate > 0);
  assert.ok(envLoad > gate);
});

test("production resume is advertised only after local SQLite and remote checkpoint validation", () => {
  const runner = source("scripts/run-video-pipeline-production-e2e.mjs");
  assert.match(runner, /assertSqliteDatabaseUsable\(databasePath\)/);
  assert.match(
    runner,
    /resumeSupported:\s*retainRemoteCheckpoint\s*&&\s*remoteCheckpointReady\s*&&\s*localResumeReady/,
  );
});

test("production polling fails fast on authentication loss and repeated transport errors", () => {
  const spec = source("e2e/video-pipeline-production.spec.ts");
  assert.match(spec, /generation polling lost authentication/);
  assert.match(spec, /consecutiveTransportErrors\s*>=\s*3/);
});

test("PDF document invariants live in the production suite instead of a duplicate paid runner", () => {
  const spec = source("e2e/video-pipeline-production.spec.ts");
  assert.match(spec, /full_page_visuals_created/);
  assert.match(spec, /document_embedded_image_count/);
  assert.match(spec, /derived_visual_asset_ids/);
  assert.match(spec, /document_embedded_image/);
  assert.match(spec, /source_context_text/);
  assert.match(spec, /pdf_page_visual/);
  assert.equal(fs.existsSync(path.join(root, "e2e/pdf-video-quality.spec.ts")), false);
  assert.equal(fs.existsSync(path.join(root, "scripts/run-pdf-video-quality.mjs")), false);
  assert.doesNotMatch(source("package.json"), /test:e2e:pdf-video-quality/);
});

test("package and CI expose one default fast offline test tier without copied backend lists", () => {
  const packageSource = source("package.json");
  const workflow = source(".github/workflows/ci.yml");
  assert.match(packageSource, /"test:scripts"/);
  assert.match(packageSource, /"test:fast"/);
  assert.doesNotMatch(packageSource, /"check:backend"/);
  assert.doesNotMatch(packageSource, /"test:e2e:runs"/);
  assert.doesNotMatch(packageSource, /"test:e2e:cleanup-run"/);
  assert.match(packageSource, /"e2e:runs"/);
  assert.match(packageSource, /"e2e:cleanup"/);
  assert.match(workflow, /npm run test:fast/);
  assert.doesNotMatch(workflow, /npm run test\s*$/m);
});
