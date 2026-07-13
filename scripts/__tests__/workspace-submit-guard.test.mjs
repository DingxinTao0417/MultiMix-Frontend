import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  beginGuard,
  checkpointGuard,
  endGuard,
  guardStatus,
  verifyGuard,
} from "../workspace-submit-guard.mjs";

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function createRepo(workspaceRoot, name) {
  const repo = path.join(workspaceRoot, name);
  execFileSync(process.execPath, ["-e", `require('fs').mkdirSync(${JSON.stringify(repo)}, { recursive: true })`]);
  git(repo, "init", "-b", "main");
  git(repo, "config", "user.name", "Guard Test");
  git(repo, "config", "user.email", "guard@example.com");
  writeFileSync(path.join(repo, "tracked.txt"), "initial\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-m", "initial");
  return repo;
}

test("guards the split workspace against second writers and late changes", () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "multimix-submit-guard-"));
  try {
    const frontend = createRepo(workspaceRoot, "MultiMix-Frontend");
    createRepo(workspaceRoot, "MultiMix-Backend");
    writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "initial guardrail\n");

    const started = beginGuard({ workspaceRoot, token: "token-a", owner: "test-a" });
    assert.equal(started.token, "token-a");
    assert.equal(guardStatus({ workspaceRoot }).owner, "test-a");
    assert.doesNotThrow(() => verifyGuard({ workspaceRoot, token: "token-a" }));

    assert.throws(
      () => beginGuard({ workspaceRoot, token: "token-b", owner: "test-b" }),
      /already locked/,
    );

    writeFileSync(path.join(frontend, "tracked.txt"), "late change\n");
    assert.throws(
      () => verifyGuard({ workspaceRoot, token: "token-a" }),
      /workspace changed/i,
    );

    const checkpoint = checkpointGuard({ workspaceRoot, token: "token-a" });
    assert.equal(checkpoint.token, "token-a");
    assert.doesNotThrow(() => verifyGuard({ workspaceRoot, token: "token-a" }));

    git(frontend, "add", "tracked.txt");
    git(frontend, "commit", "-m", "intended change");
    assert.throws(
      () => verifyGuard({ workspaceRoot, token: "token-a" }),
      /workspace changed/i,
    );
    checkpointGuard({ workspaceRoot, token: "token-a" });
    assert.doesNotThrow(() => verifyGuard({ workspaceRoot, token: "token-a" }));

    writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "late root guardrail change\n");
    assert.throws(
      () => verifyGuard({ workspaceRoot, token: "token-a" }),
      /workspace changed/i,
    );
    checkpointGuard({ workspaceRoot, token: "token-a" });

    assert.throws(() => endGuard({ workspaceRoot, token: "wrong" }), /token does not own/);
    endGuard({ workspaceRoot, token: "token-a" });
    assert.equal(guardStatus({ workspaceRoot }), null);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
