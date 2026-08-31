import assert from "node:assert/strict";
import test from "node:test";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, writeRunIndex } from "../run-demo-material-packs.mjs";

test("paid live evaluation requires an explicit scenario or all", () => {
  assert.throws(() => parseArgs([]), /requires --scenario or --all/);
});

test("all selects four paid live scenarios", () => {
  assert.deepEqual(parseArgs(["--all"]).scenarios, ["01", "02", "03", "04"]);
});

test("unknown scenario is rejected before processes start", () => {
  assert.throws(() => parseArgs(["--scenario", "05"]), /Unknown scenario/);
});

test("removed stable mode is rejected", () => {
  assert.throws(() => parseArgs(["--mode", "stable", "--all"]), /stable browser mode was removed/);
});

test("writeRunIndex creates machine and human readable summaries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo-run-index-"));
  try {
    writeRunIndex(directory, { runId: "run-1", mode: "paid-live", scenarios: ["01", "04"] });
    assert.match(fs.readFileSync(path.join(directory, "summary.md"), "utf8"), /Scenario 04/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "results.json"), "utf8")).scenarios, ["01", "04"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
