import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const runtimeRoot = path.join(os.homedir(), "Desktop", "multimix-test-results", "e2e-runtime");
const moduleUrl = new URL("../e2e-run-lifecycle.mjs", import.meta.url);

test("retained E2E runtime requires explicit cleanup confirmation", async () => {
  const { createE2ERunLifecycle, cleanupRetainedE2ERun } = await import(moduleUrl);
  const runId = `lifecycle-test-${Date.now()}`;
  const lifecycle = createE2ERunLifecycle({ suite: "lifecycle-test", runId, resultDir: path.join(os.tmpdir(), runId) });
  fs.mkdirSync(lifecycle.artifactDir, { recursive: true });
  fs.writeFileSync(lifecycle.databasePath, "sqlite-test");
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
  fs.writeFileSync(created.databasePath, "sqlite-test");
  created.finish("failed_retained");
  const resumed = resumeRetainedE2ERunLifecycle({ suite: "lifecycle-test", runId });
  assert.equal(resumed.databasePath, created.databasePath);
  assert.equal(resumed.artifactDir, created.artifactDir);
  resumed.finish("passed_pending_cleanup");
  cleanupRetainedE2ERun({ suite: "lifecycle-test", runId, confirmed: true });
  fs.rmSync(path.join(runtimeRoot, "lifecycle-test"), { recursive: true, force: true });
});
