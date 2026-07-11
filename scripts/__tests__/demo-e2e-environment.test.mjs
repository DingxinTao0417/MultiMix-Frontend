import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRunPaths, safeRemoveRunDatabase } from "../demo-e2e/environment-manager.mjs";

test("safeRemoveRunDatabase rejects a path without the current run id", () => {
  assert.throws(() => safeRemoveRunDatabase(path.join(os.tmpdir(), "other.sqlite3"), "run-123"), /does not contain current run id/);
});

test("createRunPaths places the database in the OS temp directory", () => {
  const paths = createRunPaths("multimix-demo", "run-123");
  assert.equal(path.dirname(paths.databasePath), os.tmpdir());
  assert.match(paths.databasePath, /run-123/);
});
