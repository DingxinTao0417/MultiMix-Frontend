import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = path.resolve(import.meta.dirname, "..", "..", ".github", "workflows", "display-coverage.yml");
const runner = path.resolve(import.meta.dirname, "..", "run-display-coverage.mjs");
const nextConfig = path.resolve(import.meta.dirname, "..", "..", "next.config.mjs");

test("display coverage workflow runs both repositories and retains safe failure evidence", () => {
  const source = fs.readFileSync(workflow, "utf8");
  assert.match(source, /DingxinTao0417\/MultiMix-Backend/);
  assert.match(source, /npm run test:display-coverage/);
  assert.match(source, /playwright-report|test-results/);
  assert.match(source, /workflow_dispatch/);
  assert.match(source, /schedule/);
  assert.match(source, /if: failure\(\)/);
  assert.doesNotMatch(source, /\.sqlite\*.*upload|\.env\*.*upload/i);
});

test("local display coverage uses and cleans an isolated Next development directory", () => {
  const runnerSource = fs.readFileSync(runner, "utf8");
  const nextConfigSource = fs.readFileSync(nextConfig, "utf8");

  assert.match(nextConfigSource, /process\.env\.NEXT_DEV_DIST_DIR/);
  assert.match(runnerSource, /NEXT_DEV_DIST_DIR:\s*"\.next-display-coverage"/);
  assert.match(runnerSource, /fs\.rmSync\(path\.join\(frontendRoot, "\.next-display-coverage"\)/);
  assert.match(runnerSource, /snapshotWorkspaceFiles/);
  assert.match(runnerSource, /restoreWorkspaceFiles/);
  assert.match(runnerSource, /NEXT_PUBLIC_MULTIMIX_AUTH_MODE:\s*"dev-admin"/);
});

test("display coverage can pin an auditable temp path and forward snapshot updates", () => {
  const runnerSource = fs.readFileSync(runner, "utf8");

  assert.match(runnerSource, /process\.env\.DISPLAY_COVERAGE_RUN_ID/);
  assert.match(runnerSource, /--update-snapshots/);
  assert.match(runnerSource, /multimix-display-coverage-/);
  assert.match(runnerSource, /safeRemoveRunDatabaseWithRetries\(databasePath, runId\)/);
});
