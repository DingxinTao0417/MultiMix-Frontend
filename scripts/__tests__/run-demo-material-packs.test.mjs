import assert from "node:assert/strict";
import test from "node:test";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, writeRunIndex } from "../run-demo-material-packs.mjs";

test("live mode requires an explicit scenario or all", () => {
  assert.throws(() => parseArgs(["--mode", "live"]), /requires --scenario or --all/);
});

test("stable all selects four scenarios", () => {
  assert.deepEqual(parseArgs(["--mode", "stable", "--all"]).scenarios, ["01", "02", "03", "04"]);
});

test("unknown scenario is rejected before processes start", () => {
  assert.throws(() => parseArgs(["--mode", "stable", "--scenario", "05"]), /Unknown scenario/);
});

test("writeRunIndex creates machine and human readable summaries", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "demo-run-index-"));
  try {
    writeRunIndex(directory, { runId: "run-1", mode: "stable", scenarios: ["01", "04"] });
    assert.match(fs.readFileSync(path.join(directory, "summary.md"), "utf8"), /Scenario 04/);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, "results.json"), "utf8")).scenarios, ["01", "04"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
