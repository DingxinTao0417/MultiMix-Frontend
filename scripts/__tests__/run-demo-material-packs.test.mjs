import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs } from "../run-demo-material-packs.mjs";

test("live mode requires an explicit scenario or all", () => {
  assert.throws(() => parseArgs(["--mode", "live"]), /requires --scenario or --all/);
});

test("stable all selects four scenarios", () => {
  assert.deepEqual(parseArgs(["--mode", "stable", "--all"]).scenarios, ["01", "02", "03", "04"]);
});

test("unknown scenario is rejected before processes start", () => {
  assert.throws(() => parseArgs(["--mode", "stable", "--scenario", "05"]), /Unknown scenario/);
});
