import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
import { fileURLToPath } from "node:url";

import {
  beginWorkGuard,
  checkWorkGuard,
  endWorkGuard,
  findWorkspaceRoot,
  workGuardStatus,
} from "../workspace-work-guard.mjs";

const workGuardScript = fileURLToPath(
  new URL("../workspace-work-guard.mjs", import.meta.url),
);

function createWorkspace() {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), "multimix-work-guard-"));
  for (const repository of ["MultiMix-Frontend", "MultiMix-Backend"]) {
    const planDirectory = path.join(workspaceRoot, repository, "docs", "plans", "active");
    mkdirSync(planDirectory, { recursive: true });
    for (const name of ["task-a.md", "task-b.md", "task-c.md"]) {
      writeFileSync(path.join(planDirectory, name), `# ${name}\n`);
    }
  }
  return workspaceRoot;
}

function claim(overrides = {}) {
  return {
    task: "task-a",
    owner: "agent-a",
    issue: "LLY-100",
    plan: "MultiMix-Backend/docs/plans/active/task-a.md",
    areas: ["video-confirmation"],
    paths: ["MultiMix-Backend/app/services/video_studio"],
    contracts: ["api/video-project"],
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
        issue: "LLY-101",
        plan: "MultiMix-Frontend/docs/plans/active/task-b.md",
        areas: ["asset-library-ui"],
        paths: ["MultiMix-Frontend/app/assets/components/library"],
        contracts: ["type/asset-card"],
        token: "token-b",
      }),
    });

    assert.equal(first.token, "token-a");
    assert.equal(second.token, "token-b");
    assert.equal(first.issue, "LLY-100");
    assert.deepEqual(first.contracts, ["api/video-project"]);
    assert.doesNotThrow(() => checkWorkGuard({ workspaceRoot, token: "token-a" }));

    const status = workGuardStatus({ workspaceRoot });
    assert.equal(status.length, 2);
    assert.equal(
      status[0].paths.includes("MultiMix-Backend/docs/plans/active/task-a.md"),
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
    assert.equal(status[0].issue, "LLY-100");
    assert.deepEqual(status[0].contracts, ["api/video-project"]);

    endWorkGuard({ workspaceRoot, token: "token-a" });
    endWorkGuard({ workspaceRoot, token: "token-b" });
    assert.deepEqual(workGuardStatus({ workspaceRoot }), []);
    assert.equal(existsSync(path.join(workspaceRoot, ".multimix-work-claims.json")), false);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("rejects duplicate Linear issue ownership across otherwise independent work", () => {
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
            issue: "lly-100",
            plan: "MultiMix-Frontend/docs/plans/active/task-b.md",
            areas: ["asset-library-ui"],
            paths: ["MultiMix-Frontend/app/assets/components/library"],
            contracts: ["type/asset-card"],
            token: "token-b",
          }),
        }),
      /task-a.*agent-a.*issue:LLY-100/is,
    );
    assert.equal(workGuardStatus({ workspaceRoot }).length, 1);
    endWorkGuard({ workspaceRoot, token: "token-a" });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("rejects shared contract conflicts across different files and areas", () => {
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
            issue: "LLY-101",
            plan: "MultiMix-Frontend/docs/plans/active/task-b.md",
            areas: ["asset-library-ui"],
            paths: ["MultiMix-Frontend/app/assets/components/library"],
            contracts: ["API/Video-Project"],
            token: "token-b",
          }),
        }),
      /task-a.*agent-a.*contract:api\/video-project/is,
    );
    assert.equal(workGuardStatus({ workspaceRoot }).length, 1);
    endWorkGuard({ workspaceRoot, token: "token-a" });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("validates Linear issue identifiers and shared contract slugs", () => {
  const workspaceRoot = createWorkspace();
  try {
    assert.throws(
      () => beginWorkGuard({ workspaceRoot, ...claim({ issue: "not-an-issue" }) }),
      /Linear issue.*TEAM-123/i,
    );
    assert.throws(
      () => beginWorkGuard({ workspaceRoot, ...claim({ contracts: ["api:video project"] }) }),
      /contract.*stable lowercase slug/i,
    );
    assert.deepEqual(workGuardStatus({ workspaceRoot }), []);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("CLI registers Linear issue and repeated shared contracts", () => {
  const workspaceRoot = createWorkspace();
  try {
    const result = spawnSync(
      process.execPath,
      [
        workGuardScript,
        "begin",
        "--workspace-root",
        workspaceRoot,
        "--task",
        "task-a",
        "--owner",
        "agent-a",
        "--issue",
        "lly-100",
        "--plan",
        "MultiMix-Backend/docs/plans/active/task-a.md",
        "--contract",
        "API/Video-Project",
        "--contract",
        "state/video-project",
        "--token",
        "token-a",
      ],
      { encoding: "utf8" },
    );

    assert.equal(result.status, 0, result.stderr);
    const created = JSON.parse(result.stdout);
    assert.equal(created.issue, "LLY-100");
    assert.deepEqual(created.contracts, ["api/video-project", "state/video-project"]);
    endWorkGuard({ workspaceRoot, token: "token-a" });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

test("reads legacy claims without issue or contract fields", () => {
  const workspaceRoot = createWorkspace();
  try {
    writeFileSync(
      path.join(workspaceRoot, ".multimix-work-claims.json"),
      `${JSON.stringify(
        {
          version: 1,
          claims: [
            {
              task: "legacy-task",
              owner: "legacy-agent",
              plan: "MultiMix-Backend/docs/plans/active/task-a.md",
              areas: ["legacy-area"],
              paths: ["MultiMix-Backend/docs/plans/active/task-a.md"],
              token: "legacy-token",
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    const status = workGuardStatus({ workspaceRoot });
    assert.deepEqual(status[0].contracts, []);
    assert.doesNotThrow(() =>
      beginWorkGuard({
        workspaceRoot,
        ...claim({
          task: "task-b",
          owner: "agent-b",
          issue: "LLY-101",
          plan: "MultiMix-Frontend/docs/plans/active/task-b.md",
          areas: ["asset-library-ui"],
          paths: ["MultiMix-Frontend/app/assets/components/library"],
          contracts: ["type/asset-card"],
          token: "token-b",
        }),
      }),
    );
    endWorkGuard({ workspaceRoot, token: "legacy-token" });
    endWorkGuard({ workspaceRoot, token: "token-b" });
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
      /path:MultiMix-Backend\/docs\/plans\/active\/task-a\.md/is,
    );

    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({
            task: "task-b",
            owner: "agent-b",
            plan: "MultiMix-Backend/docs/plans/active/task-b.md",
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
            plan: "MultiMix-Backend/docs/plans/active/task-c.md",
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
          ...claim({ plan: "MultiMix-Backend/docs/archive/plans/task-a.md" }),
        }),
      /active plan/i,
    );
    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({ plan: "MultiMix-Backend/docs/plans/active/missing.md" }),
        }),
      /does not exist/i,
    );
    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({ areas: [], paths: [], contracts: [] }),
        }),
      /area, path, or contract/i,
    );

    beginWorkGuard({ workspaceRoot, ...claim() });
    assert.throws(
      () =>
        beginWorkGuard({
          workspaceRoot,
          ...claim({
            owner: "agent-b",
            plan: "MultiMix-Backend/docs/plans/active/task-b.md",
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

    rmSync(path.join(workspaceRoot, "MultiMix-Backend", "docs", "plans", "active", "task-a.md"));
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
    writeFileSync(path.join(frontendRoot, "docs", "README.md"), "# Frontend\n");
    writeFileSync(path.join(workspaceRoot, "MultiMix-Backend", "docs", "README.md"), "# Backend\n");

    assert.equal(findWorkspaceRoot(frontendScripts), workspaceRoot);
    assert.equal(findWorkspaceRoot(worktreeScripts), workspaceRoot);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});
