import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("vendored editor contains no source outside the declared runtime and test graph", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-vendor-reachability.mjs", "--assert-clean", "--json"],
    { cwd: workspaceRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.unreachableCount, 0);
  assert.ok(report.reachableCount > 0);
  assert.ok(report.externalRoots.length > 0);
});
