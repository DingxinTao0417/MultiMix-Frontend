import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("frontend dependency security scan has one reusable local and CI entrypoint", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(frontendRoot, "package.json"), "utf8"),
  );
  const workflow = fs.readFileSync(
    path.join(frontendRoot, ".github", "workflows", "ci.yml"),
    "utf8",
  );

  assert.equal(
    packageJson.scripts["security:dependencies"],
    "npm audit --omit=dev --audit-level=high",
  );
  assert.match(workflow, /run: npm run security:dependencies/);
  assert.doesNotMatch(workflow, /run: npm audit --omit=dev --audit-level=high/);
});
