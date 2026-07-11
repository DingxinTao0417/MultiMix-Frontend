import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = path.resolve(import.meta.dirname, "..", "..", ".github", "workflows", "display-coverage.yml");

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
