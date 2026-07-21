import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createRunPaths,
  safeRemoveRunDatabase,
  safeRemoveRunDatabaseWithRetries,
} from "../demo-e2e/environment-manager.mjs";

test("safeRemoveRunDatabase rejects a path without the current run id", () => {
  assert.throws(() => safeRemoveRunDatabase(path.join(os.tmpdir(), "other.sqlite3"), "run-123"), /does not contain current run id/);
});

test("createRunPaths places the database in the OS temp directory", () => {
  const paths = createRunPaths("multimix-demo", "run-123");
  assert.equal(path.dirname(paths.databasePath), os.tmpdir());
  assert.match(paths.databasePath, /run-123/);
});

test("safeRemoveRunDatabase removes sqlite sidecar files for the current run", () => {
  const runId = `run-${process.pid}-${Date.now()}`;
  const databasePath = path.join(os.tmpdir(), `multimix-demo-${runId}.sqlite3`);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    fs.writeFileSync(`${databasePath}${suffix}`, "test");
  }

  safeRemoveRunDatabase(databasePath, runId);

  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    assert.equal(fs.existsSync(`${databasePath}${suffix}`), false);
  }
});

test("safeRemoveRunDatabaseWithRetries keeps the same path guard", async () => {
  await assert.rejects(
    safeRemoveRunDatabaseWithRetries(path.join(os.tmpdir(), "other.sqlite3"), "run-123"),
    /does not contain current run id/,
  );
});
