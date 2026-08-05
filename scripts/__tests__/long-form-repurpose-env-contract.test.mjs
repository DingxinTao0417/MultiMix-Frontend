import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runnerPath = path.join(scriptsRoot, "run-long-form-repurpose-e2e.mjs");

test("long-form E2E isolates backend settings with the current MULTIMIX prefix", () => {
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.doesNotMatch(source, /CHANGEIN_/);
  for (const variable of [
    "MULTIMIX_TEST_DATABASE_URL",
    "MULTIMIX_SUPABASE_URL",
    "MULTIMIX_SUPABASE_SERVICE_ROLE_KEY",
    "MULTIMIX_S3_ENDPOINT_URL",
  ]) {
    assert.match(source, new RegExp(variable));
  }
});
