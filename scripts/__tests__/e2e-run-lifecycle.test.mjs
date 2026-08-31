import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const runtimeRoot = path.join(os.homedir(), "Desktop", "multimix-test-results", "e2e-runtime");
const moduleUrl = new URL("../e2e-run-lifecycle.mjs", import.meta.url);

function writeValidSqliteHeader(filePath) {
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from("SQLite format 3\0", "utf8"),
    Buffer.alloc(84),
  ]));
}

test("retained E2E runtime requires explicit cleanup confirmation", async () => {
  const { createE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `lifecycle-test-${Date.now()}`;
  const lifecycle = createE2ERunLifecycle({ suite: "lifecycle-test", runId, resultDir: path.join(os.tmpdir(), runId) });
  fs.mkdirSync(lifecycle.artifactDir, { recursive: true });
  writeValidSqliteHeader(lifecycle.databasePath);
  lifecycle.record("playwright", "failed", { reasonCode: "assertion_failed" });
  lifecycle.finish("failed_retained", { failure: { reasonCode: "assertion_failed" } });
  assert.throws(() => cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: false }), /--confirm/);
  assert.equal(fs.existsSync(lifecycle.databasePath), true);
  const cleaned = cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  assert.equal(fs.existsSync(cleaned.runDir), false);
  assert.equal(fs.existsSync(cleaned.receiptPath), true);
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});

test("a failed retained E2E run can reopen only with its original runtime", async () => {
  const { createE2ERunLifecycle, resumeRetainedE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `resume-test-${Date.now()}`;
  const created = createE2ERunLifecycle({ suite: "lifecycle-test", runId, resultDir: path.join(os.tmpdir(), runId) });
  fs.mkdirSync(created.artifactDir, { recursive: true });
  writeValidSqliteHeader(created.databasePath);
  created.finish("failed_retained");
  const resumed = resumeRetainedE2ERunLifecycle({ suite: "lifecycle-test", runId });
  assert.equal(resumed.databasePath, created.databasePath);
  assert.equal(resumed.artifactDir, created.artifactDir);
  resumed.finish("passed_pending_cleanup");
  cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});

test("a passed retained E2E run can reopen for deferred browser and media verification", async () => {
  const { createE2ERunLifecycle, resumeRetainedE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `resume-passed-test-${Date.now()}`;
  const created = createE2ERunLifecycle({ suite: "lifecycle-test", runId, resultDir: path.join(os.tmpdir(), runId) });
  fs.mkdirSync(created.artifactDir, { recursive: true });
  writeValidSqliteHeader(created.databasePath);
  created.finish("passed_pending_cleanup", { backendVerification: "completed" });

  const resumed = resumeRetainedE2ERunLifecycle({ suite: "lifecycle-test", runId });

  assert.equal(resumed.databasePath, created.databasePath);
  assert.equal(resumed.artifactDir, created.artifactDir);
  assert.equal(resumed.readState().status, "active");
  resumed.finish("passed_pending_cleanup", { browserVerification: "completed" });
  cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});

test("a retained E2E run cannot reopen after its original runtime is missing", async () => {
  const { createE2ERunLifecycle, resumeRetainedE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `resume-missing-runtime-test-${Date.now()}`;
  const created = createE2ERunLifecycle({ suite: "lifecycle-test", runId, resultDir: path.join(os.tmpdir(), runId) });
  fs.mkdirSync(created.artifactDir, { recursive: true });
  writeValidSqliteHeader(created.databasePath);
  created.finish("passed_pending_cleanup");
  fs.rmSync(created.databasePath);

  assert.throws(
    () => resumeRetainedE2ERunLifecycle({ suite: "lifecycle-test", runId }),
    /missing its retained SQLite or ArtifactStore/,
  );

  writeValidSqliteHeader(created.databasePath);
  cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});

test("a retained E2E run cannot resume from an empty or corrupt SQLite file", async () => {
  const { createE2ERunLifecycle, resumeRetainedE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `resume-invalid-sqlite-test-${Date.now()}`;
  const created = createE2ERunLifecycle({ suite: "lifecycle-test", runId, resultDir: path.join(os.tmpdir(), runId) });
  fs.mkdirSync(created.artifactDir, { recursive: true });
  fs.writeFileSync(created.databasePath, "");
  created.finish("failed_retained", { resumeSupported: true });

  assert.throws(
    () => resumeRetainedE2ERunLifecycle({ suite: "lifecycle-test", runId }),
    /valid SQLite database/,
  );

  writeValidSqliteHeader(created.databasePath);
  cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});

test("a retained E2E run marked non-resumable cannot reopen", async () => {
  const { createE2ERunLifecycle, resumeRetainedE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `resume-disabled-test-${Date.now()}`;
  const created = createE2ERunLifecycle({ suite: "lifecycle-test", runId, resultDir: path.join(os.tmpdir(), runId) });
  fs.mkdirSync(created.artifactDir, { recursive: true });
  writeValidSqliteHeader(created.databasePath);
  created.finish("failed_retained", { resumeSupported: false });

  assert.throws(
    () => resumeRetainedE2ERunLifecycle({ suite: "lifecycle-test", runId }),
    /marked non-resumable/,
  );

  cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});

test("a passed offline E2E runtime is cleaned automatically while a failed runtime is retained", async () => {
  const { createE2ERunLifecycle, finalizeE2ERun } = await import(moduleUrl);
  const passedRunId = `auto-clean-pass-${Date.now()}`;
  const passed = createE2ERunLifecycle({ suite: "lifecycle-test", runId: passedRunId, resultDir: path.join(os.tmpdir(), passedRunId) });
  fs.mkdirSync(passed.artifactDir, { recursive: true });
  writeValidSqliteHeader(passed.databasePath);

  const passedResult = finalizeE2ERun({ lifecycle: passed, failed: false });

  assert.equal(passedResult.retained, false);
  assert.equal(fs.existsSync(passed.runDir), false);

  const failedRunId = `auto-clean-fail-${Date.now()}`;
  const failed = createE2ERunLifecycle({ suite: "lifecycle-test", runId: failedRunId, resultDir: path.join(os.tmpdir(), failedRunId) });
  fs.mkdirSync(failed.artifactDir, { recursive: true });
  writeValidSqliteHeader(failed.databasePath);

  const failedResult = finalizeE2ERun({ lifecycle: failed, failed: true });

  assert.equal(failedResult.retained, true);
  assert.equal(fs.existsSync(failed.runDir), true);
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});

test("timed E2E stages retain non-negative durations and rank the slowest first", async () => {
  const { createE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `timing-test-${Date.now()}`;
  let now = 1_000;
  const lifecycle = createE2ERunLifecycle({
    suite: "lifecycle-test",
    runId,
    resultDir: path.join(os.tmpdir(), runId),
    now: () => now,
  });

  await lifecycle.measure("slow_stage", async () => {
    now += 900;
    return "slow-result";
  });
  await lifecycle.measure("fast_stage", async () => {
    now += 120;
  });

  assert.deepEqual(lifecycle.timingSummary(), [
    { stage: "slow_stage", status: "passed", duration_ms: 900 },
    { stage: "fast_stage", status: "passed", duration_ms: 120 },
  ]);
  lifecycle.finish("passed_pending_cleanup");
  cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});
