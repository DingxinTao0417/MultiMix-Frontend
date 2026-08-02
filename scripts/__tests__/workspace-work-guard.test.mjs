import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  beginWorkGuard,
  checkWorkGuard,
  endWorkGuard,
  findWorkspaceRoot,
  workGuardStatus,
} from "../workspace-work-guard.mjs";

function createWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "multimix-work-guard-"));
  const planDirectory = path.join(workspaceRoot, "docs", "plans", "active");
  mkdirSync(planDirectory, { recursive: true });
  for (const name of ["task-a.md", "task-b.md", "task-c.md"]) {
    writeFileSync(path.join(planDirectory, name), `# ${name}\n`);
  }
  return workspaceRoot;
}

function claim(overrides = {}) {
  return {
    task: "task-a",
    owner: "agent-a",
    plan: "docs/plans/active/task-a.md",
    areas: ["video-confirmation"],
    paths: ["MultiMix-Backend/app/services/video_studio"],
    token: "token-a",
    ...overrides,
  };
}

test("allows non-overlapping work and hides tokens from status", () => {
  const workspaceRoot = createWorkspace();
  try {
    const first = beginWorkGuard({ workspaceRoot, ...claim() });
    const second = beginWorkGuard({
      workspaceRoot,
      ...claim({
        task: "task-b",
        owner: "agent-b",
        plan: "docs/plans/active/task-b.md",
        areas: ["asset-library-ui"],
        paths: ["MultiMix-Frontend/app/assets/components/library"],
        token: "token-b",
      }),
    });

    assert.equal(first.token, "token-a");
    assert.equal(second.token, "token-b");
    assert.doesNotThrow(() => checkWorkGuard({ workspaceRoot, token: "token-a" }));

    const status = workGuardStatus({ workspaceRoot });
    assert.equal(status.length, 2);
    assert.equal(
      status[0].paths.includes("docs/plans/active/task-a.md"),
      true,
    );
    assert.deepEqual(
      status.map(({ task, owner }) => ({ task, owner })),
      [
        { task: "task-a", owner: "agent-a" },
        { task: "task-b", owner: "agent-b" },
      ],
    );
    assert.equal(JSON.stringify(status).includes("token-a"), false);
    assert.equal(JSON.stringify(status).includes("token-b"), false);

    endWorkGuard({ workspaceRoot, token: "token-a" });
    endWorkGuard({ workspaceRoot, token: "token-b" });
    assert.deepEqual(workGuardStatus({ workspaceRoot }), []);
    assert.equal(existsSync(path.join(workspaceRoot, ".multimix-work-claims.json")), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("rejects semantic and parent-child path conflicts before writing", () => {
  const workspaceRoot = createWorkspace();
  try {
    beginWorkGuard({ workspaceRoot, ...claim() });

    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({
            task: "task-b",
            owner: "agent-b",
            areas: ["asset-library-ui"],
            paths: ["MultiMix-Frontend/app/assets"],
            token: "token-b",
          }),
        }),
      /path:docs\/plans\/active\/task-a\.md/is,
    );

    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({
            task: "task-b",
            owner: "agent-b",
            plan: "docs/plans/active/task-b.md",
            areas: ["Video-Confirmation"],
            paths: ["MultiMix-Frontend/app/assets"],
            token: "token-b",
          }),
        }),
      /task-a.*agent-a.*area:video-confirmation/is,
    );

    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({
            task: "task-c",
            owner: "agent-c",
            plan: "docs/plans/active/task-c.md",
            areas: ["render-jobs"],
            paths: [
              "multimix-backend\\app\\services\\video_studio\\jobs.py",
            ],
            token: "token-c",
          }),
        }),
      /task-a.*path:MultiMix-Backend\/app\/services\/video_studio/is,
    );

    assert.equal(workGuardStatus({ workspaceRoot }).length, 1);
    endWorkGuard({ workspaceRoot, token: "token-a" });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("validates plans, unique task names, and token ownership", () => {
  const workspaceRoot = createWorkspace();
  try {
    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({ plan: "docs/archive/plans/task-a.md" }),
        }),
      /active plan/i,
    );
    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({ plan: "docs/plans/active/missing.md" }),
        }),
      /does not exist/i,
    );
    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({ areas: [], paths: [] }),
        }),
      /area or path/i,
    );

    beginWorkGuard({ workspaceRoot, ...claim() });
    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({
            owner: "agent-b",
            plan: "docs/plans/active/task-b.md",
            areas: ["asset-library-ui"],
            paths: ["MultiMix-Frontend/app/assets"],
            token: "token-b",
          }),
        }),
      /task name.*already registered/i,
    );
    assert.throws(
      () => checkWorkGuard({ workspaceRoot, token: "wrong" }),
      /token does not own/i,
    );
    assert.throws(
      () => endWorkGuard({ workspaceRoot, token: "wrong" }),
      /token does not own/i,
    );

    rmSync(path.join(workspaceRoot, "docs", "plans", "active", "task-a.md"));
    assert.throws(
      () => checkWorkGuard({ workspaceRoot, token: "token-a" }),
      /plan does not exist/i,
    );
    endWorkGuard({ workspaceRoot, token: "token-a" });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("finds the split workspace root instead of the nested frontend docs root", () => {
  const workspaceRoot = createWorkspace();
  try {
    const frontendRoot = path.join(workspaceRoot, "MultiMix-Frontend");
    const frontendScripts = path.join(frontendRoot, "scripts");
    const worktreeScripts = path.join(
      frontendRoot,
      ".worktrees",
      "task-a",
      "scripts",
    );
    mkdirSync(path.join(frontendRoot, "docs"), { recursive: true });
    mkdirSync(path.join(workspaceRoot, "MultiMix-Backend"), { recursive: true });
    mkdirSync(frontendScripts, { recursive: true });
    mkdirSync(worktreeScripts, { recursive: true });
    writeFileSync(path.join(workspaceRoot, "docs", "README.md"), "# Workspace\n");
    writeFileSync(path.join(frontendRoot, "docs", "README.md"), "# Frontend\n");

    assert.equal(findWorkspaceRoot(frontendScripts), workspaceRoot);
    assert.equal(findWorkspaceRoot(worktreeScripts), workspaceRoot);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
