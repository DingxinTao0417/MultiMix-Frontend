import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = fs.readFileSync(
  path.resolve(import.meta.dirname, "../../.github/workflows/ci.yml"),
  "utf8",
);

test("frontend PR and main checks run without private backend material", () => {
  assert.match(workflow, /push:\s*\n\s*branches: \[main\]/);
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /checks:\s*\n\s*runs-on: ubuntu-latest/);
  assert.match(workflow, /npm run test:fast/);
  assert.doesNotMatch(workflow, /MULTIMIX_BACKEND_READ_TOKEN/);
  assert.doesNotMatch(workflow, /repository: DingxinTao0417\/MultiMix-Backend/);
  assert.doesNotMatch(workflow, /npm run test:display-e2e/);
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});

test("untrusted frontend changes cannot gain backend access through this workflow", () => {
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /repository: .*MultiMix-Backend/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
});
