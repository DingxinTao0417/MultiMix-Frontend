import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertPortOwnedByChild,
  createRunPaths,
  safeRemoveRunDatabase,
  safeRemoveRunDatabaseWithRetries,
  waitForPortFree,
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

test("assertPortOwnedByChild requires one listener in the started process tree", () => {
  const child = { pid: 4201 };
  const processTreePids = () => new Set([4201, 4202]);

  const verified = assertPortOwnedByChild(8427, child, {
    listeningPids: () => [4201],
    processTreePids,
  });
  assert.deepEqual(verified, { port: 8427, rootPid: 4201, listenerPid: 4201 });

  const descendant = assertPortOwnedByChild(8427, child, {
    listeningPids: () => [4202],
    processTreePids,
  });
  assert.deepEqual(descendant, { port: 8427, rootPid: 4201, listenerPid: 4202 });

  assert.throws(
    () => assertPortOwnedByChild(8427, child, {
      listeningPids: () => [4201, 4202],
      processTreePids,
    }),
    /exactly one listener/,
  );
  assert.throws(
    () => assertPortOwnedByChild(8427, child, {
      listeningPids: () => [4203],
      processTreePids,
    }),
    /does not belong to expected child process tree/,
  );
});

test("waitForPortFree waits until a stopped listener releases the port", async () => {
  let attempts = 0;
  await waitForPortFree(8427, {
    timeoutMs: 100,
    intervalMs: 1,
    assertFree: async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Test port 8427 is already in use");
    },
  });
  assert.equal(attempts, 3);
});
