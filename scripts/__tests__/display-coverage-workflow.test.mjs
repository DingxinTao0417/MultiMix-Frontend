import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = path.resolve(import.meta.dirname, "..", "..", ".github", "workflows", "display-coverage.yml");
const runner = path.resolve(import.meta.dirname, "..", "run-display-coverage.mjs");
const nextConfig = path.resolve(import.meta.dirname, "..", "..", "next.config.mjs");
const displaySpec = path.resolve(import.meta.dirname, "..", "..", "e2e", "display-area.spec.ts");

test("frontend does not own the private-backend display workflow", () => {
  assert.equal(fs.existsSync(workflow), false);
});

test("local display coverage uses and cleans an isolated Next development directory", () => {
  const runnerSource = fs.readFileSync(runner, "utf8");
  const nextConfigSource = fs.readFileSync(nextConfig, "utf8");

  assert.match(nextConfigSource, /process\.env\.NEXT_DEV_DIST_DIR/);
  assert.match(runnerSource, /nextDistDirName = `\.next-display-coverage-\$\{runId\}`/);
  assert.match(runnerSource, /NEXT_DEV_DIST_DIR:\s*nextDistDirName/);
  assert.match(runnerSource, /fs\.rmSync\(nextDistDir/);
  assert.match(runnerSource, /snapshotWorkspaceFiles/);
  assert.match(runnerSource, /restoreWorkspaceFiles/);
  assert.match(runnerSource, /NEXT_PUBLIC_MULTIMIX_AUTH_MODE:\s*"dev-admin"/);
});

test("display coverage retains an auditable isolated runtime and forwards snapshot updates", () => {
  const runnerSource = fs.readFileSync(runner, "utf8");

  assert.match(runnerSource, /process\.env\.DISPLAY_COVERAGE_RUN_ID/);
  assert.match(runnerSource, /--update-snapshots/);
  assert.match(runnerSource, /createE2ERunLifecycle\(\{ suite: "display-coverage", runId, resultDir \}\)/);
  assert.match(runnerSource, /passed_pending_cleanup/);
  assert.match(runnerSource, /failed_retained/);
});

test("display coverage prewarms the editor before Playwright starts", () => {
  const runnerSource = fs.readFileSync(runner, "utf8");

  assert.match(runnerSource, /\/editor\?embed=1&mode=preview/);
  assert.match(runnerSource, /await waitFor\([^;]*\/editor\?embed=1&mode=preview[^;]*180_000\)/s);
});

test("player screenshots keep strict environment-specific baselines", () => {
  const specSource = fs.readFileSync(displaySpec, "utf8");

  assert.match(specSource, /function environmentSnapshotName/);
  assert.match(specSource, /process\.env\.CI/);
  assert.match(specSource, /-ci\.png/);
  assert.match(specSource, /environmentSnapshotName\("video-preview-shell\.png"\)/);
  assert.match(specSource, /environmentSnapshotName\("video-preview-storyboard-shell\.png"\)/);
  assert.doesNotMatch(specSource, /function integerBoundingClip/);
});

test("export recovery mode restarts the API, resumes one durable job, and cleans its isolated runtime", () => {
  const runnerSource = fs.readFileSync(runner, "utf8");
  const specSource = fs.readFileSync(displaySpec, "utf8");

  assert.match(runnerSource, /--export-recovery/);
  assert.match(runnerSource, /DISPLAY_EXPORT_RECOVERY_HOLD_DISPATCH/);
  assert.match(runnerSource, /app\.tests\.fixtures\.display_coverage\.export_recovery:app/);
  assert.match(runnerSource, /app\.tests\.fixtures\.display_coverage\.export_recovery/);
  assert.match(runnerSource, /stopChild\(backend\)[\s\S]*backend-restarted\.log/);
  assert.match(runnerSource, /cleanupRetainedE2ERun/);
  assert.match(runnerSource, /DISPLAY_EXPORT_RECOVERY_SIGNAL_PATH/);
  assert.match(runnerSource, /DISPLAY_EXPORT_RECOVERY_RESULT_PATH/);

  assert.match(specSource, /recovers the same export after API and worker restart/);
  assert.match(specSource, /multimix-editor-export-start/);
  assert.match(specSource, /exports\/current/);
  assert.match(specSource, /exportRequests/);
  assert.match(specSource, /job_id/);
  assert.match(specSource, /attempts/);
});
