import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LEGACY_SUBMIT_LOCK,
  finishTask,
  landRepository,
  mergeLockName,
  releaseTask,
  startTask,
  taskStatus,
  worktreePath,
} from "../workspace-task.mjs";
import { endWorkGuard, workGuardStatus } from "../workspace-work-guard.mjs";

const IDENTITY = ["-c", "user.name=test", "-c", "user.email=test@example.com"];

function git(cwd, args) {
  return execFileSync("git", [...IDENTITY, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function commitFile(cwd, file, content, message = `edit ${file}`) {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), content);
  git(cwd, ["add", file]);
  git(cwd, ["commit", "-q", "-m", message]);
  return git(cwd, ["rev-parse", "HEAD"]);
}

function initRepository(repository, ignore) {
  mkdirSync(path.join(repository, "docs", "plans", "active"), { recursive: true });
  writeFileSync(path.join(repository, "docs", "README.md"), "# Docs\n");
  writeFileSync(path.join(repository, "docs", "plans", "active", "plan.md"), "# Plan\n");
  writeFileSync(path.join(repository, "docs", "plans", "active", "plan-b.md"), "# Plan B\n");
  writeFileSync(path.join(repository, ".gitignore"), ignore);
  git(repository, ["init", "-q", "-b", "main"]);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-q", "-m", "init"]);
}

function createWorkspace() {
  const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "multimix-task-")));
  const frontend = path.join(root, "MultiMix-Frontend");
  const backend = path.join(root, "MultiMix-Backend");
  initRepository(frontend, "node_modules/\n.worktrees/\n");
  initRepository(backend, ".venv/\n.worktrees/\n");
  mkdirSync(path.join(frontend, "node_modules", "pkg"), { recursive: true });
  writeFileSync(path.join(frontend, "node_modules", "pkg", "index.js"), "module.exports = 1;\n");
  return { root, frontend, backend };
}

const PLAN = "MultiMix-Frontend/docs/plans/active/plan.md";
const BACKEND_PLAN = "MultiMix-Backend/docs/plans/active/plan.md";

function start(root, overrides = {}) {
  return startTask({
    workspaceRoot: root,
    task: "task-a",
    owner: "claude-code:task-a",
    plan: PLAN,
    repos: ["frontend"],
    areas: ["brand-assets"],
    paths: ["MultiMix-Frontend/public/brand"],
    ...overrides,
  });
}

test("start creates a branch worktree with shared dependencies and a claim", () => {
  const { root, frontend } = createWorkspace();
  try {
    const entry = start(root);
    const worktree = worktreePath(root, "frontend", "task-a");

    assert.equal(entry.branch, "claude/task-a");
    assert.equal(taskStatus({ workspaceRoot: root }).tasks[0].claimed, true);
    assert.deepEqual(entry.repos, [
      { repo: "frontend", worktree: "MultiMix-Frontend/.worktrees/task-a", linked: "node_modules" },
    ]);
    assert.equal(git(worktree, ["rev-parse", "--abbrev-ref", "HEAD"]), "claude/task-a");
    assert.ok(lstatSync(path.join(worktree, "node_modules")).isSymbolicLink());
    assert.ok(existsSync(path.join(worktree, "node_modules", "pkg", "index.js")));
    assert.equal(git(worktree, ["status", "--porcelain"]), "", "linked dependencies must stay ignored");
    assert.equal(workGuardStatus({ workspaceRoot: root })[0].task, "task-a");
    assert.equal(JSON.stringify(taskStatus({ workspaceRoot: root })).includes(entry.token), false);
    assert.equal(git(frontend, ["rev-parse", "--abbrev-ref", "HEAD"]), "main");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("start rejects unknown repos and owners and leaves no claim behind", () => {
  const { root } = createWorkspace();
  try {
    assert.throws(() => start(root, { repos: ["web"] }), /Unknown repo 'web'/);
    assert.throws(() => start(root, { owner: "someone" }), /--owner must start with claude- or codex-/);
    assert.throws(() => start(root, { areas: ["not-an-area"] }), /not in scripts\/work-areas\.json/);
    assert.deepEqual(workGuardStatus({ workspaceRoot: root }), []);
    assert.deepEqual(taskStatus({ workspaceRoot: root }).tasks, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a failed worktree step rolls back the claim and created worktrees", () => {
  const { root, frontend, backend } = createWorkspace();
  try {
    // A pre-existing backend branch makes the second repo fail after the
    // frontend worktree was already created.
    git(backend, ["branch", "codex/task-a"]);
    assert.throws(
      () => start(root, { owner: "codex-task-a", repos: ["frontend", "backend"], plan: BACKEND_PLAN }),
      /Branch 'codex\/task-a' already exists in MultiMix-Backend/,
    );
    assert.equal(existsSync(worktreePath(root, "frontend", "task-a")), false);
    assert.equal(git(frontend, ["branch", "--list", "codex/task-a"]), "");
    assert.ok(existsSync(path.join(frontend, "node_modules", "pkg", "index.js")), "shared deps survive rollback");
    assert.deepEqual(workGuardStatus({ workspaceRoot: root }), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("two tasks commit in parallel and land without waiting for each other", () => {
  const { root, frontend, backend } = createWorkspace();
  try {
    const ui = start(root);
    const api = start(root, {
      task: "task-b",
      owner: "codex-task-b",
      plan: BACKEND_PLAN,
      repos: ["backend"],
      areas: ["subtitle"],
      paths: ["MultiMix-Backend/app/subtitle"],
    });

    // Commits happen in separate indexes; neither needs a lock.
    const uiHead = commitFile(worktreePath(root, "frontend", "task-a"), "public/brand/logo.svg", "<svg/>\n");
    const apiHead = commitFile(worktreePath(root, "backend", "task-b"), "app/subtitle/core.py", "x = 1\n");

    const apiResult = finishTask({ workspaceRoot: root, token: api.token });
    const uiResult = finishTask({ workspaceRoot: root, token: ui.token });

    assert.equal(apiResult.landed[0].status, "fast-forwarded");
    assert.equal(uiResult.landed[0].status, "fast-forwarded");
    assert.equal(git(frontend, ["rev-parse", "main"]), uiHead);
    assert.equal(git(backend, ["rev-parse", "main"]), apiHead);
    assert.ok(existsSync(path.join(frontend, "public", "brand", "logo.svg")), "primary working tree updated");

    // Cleanup removed worktrees, branches, claims and task records but never
    // touched the shared dependencies the worktree linked to.
    assert.equal(existsSync(worktreePath(root, "frontend", "task-a")), false);
    assert.equal(git(frontend, ["branch", "--list", "claude/task-a"]), "");
    assert.equal(git(backend, ["branch", "--list", "codex/task-b"]), "");
    assert.ok(existsSync(path.join(frontend, "node_modules", "pkg", "index.js")));
    assert.deepEqual(workGuardStatus({ workspaceRoot: root }), []);
    assert.deepEqual(taskStatus({ workspaceRoot: root }), {
      tasks: [],
      landingLocks: [],
      legacySubmitLock: false,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the later task must merge main into its branch before landing", () => {
  const { root, frontend } = createWorkspace();
  try {
    const first = start(root);
    const second = start(root, {
      task: "task-b",
      owner: "claude-code:task-b",
      plan: "MultiMix-Frontend/docs/plans/active/plan-b.md",
      areas: ["workspace-shell"],
      paths: ["MultiMix-Frontend/app/components"],
    });
    const firstWorktree = worktreePath(root, "frontend", "task-a");
    const secondWorktree = worktreePath(root, "frontend", "task-b");
    commitFile(firstWorktree, "public/brand/logo.svg", "<svg/>\n");
    commitFile(secondWorktree, "app/components/nav.tsx", "export {};\n");

    finishTask({ workspaceRoot: root, token: first.token });
    assert.throws(
      () => finishTask({ workspaceRoot: root, token: second.token }),
      /does not contain the latest MultiMix-Frontend main.*git merge main.*Worktrees and claim are kept/s,
    );
    assert.ok(existsSync(secondWorktree), "a refused landing keeps the worktree");
    assert.equal(workGuardStatus({ workspaceRoot: root }).length, 1, "and keeps the claim");

    git(secondWorktree, ["merge", "-q", "--no-edit", "main"]);
    const result = finishTask({ workspaceRoot: root, token: second.token });
    assert.equal(result.landed[0].status, "fast-forwarded");
    assert.ok(existsSync(path.join(frontend, "public", "brand", "logo.svg")));
    assert.ok(existsSync(path.join(frontend, "app", "components", "nav.tsx")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("landing is serialized per repository but not across repositories", () => {
  const { root, frontend, backend } = createWorkspace();
  try {
    git(frontend, ["branch", "claude/x"]);
    git(backend, ["branch", "codex/y"]);
    writeFileSync(path.join(root, mergeLockName("frontend")), `${JSON.stringify({ owner: "claude-other", createdAt: "now" })}\n`);

    assert.throws(
      () => landRepository({ workspaceRoot: root, repo: "frontend", branch: "claude/x", owner: "claude-x" }),
      /MultiMix-Frontend is being landed by claude-other/,
    );
    assert.equal(
      landRepository({ workspaceRoot: root, repo: "backend", branch: "codex/y", owner: "codex-y" }).status,
      "already-landed",
    );
    assert.ok(existsSync(path.join(root, mergeLockName("frontend"))), "another holder's lock is never removed");
    assert.equal(existsSync(path.join(root, mergeLockName("backend"))), false, "own lock is released");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a legacy workspace submit lock blocks landing during the transition", () => {
  const { root } = createWorkspace();
  try {
    const entry = start(root);
    commitFile(worktreePath(root, "frontend", "task-a"), "public/brand/logo.svg", "<svg/>\n");
    writeFileSync(path.join(root, LEGACY_SUBMIT_LOCK), `${JSON.stringify({ owner: "codex-old" })}\n`);

    assert.throws(() => finishTask({ workspaceRoot: root, token: entry.token }), /Legacy \.multimix-submit-lock\.json is still held/);
    assert.equal(taskStatus({ workspaceRoot: root }).legacySubmitLock, true);
    assert.ok(existsSync(path.join(root, LEGACY_SUBMIT_LOCK)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("landing protects the primary checkout's staged and uncommitted work", () => {
  const { root, frontend } = createWorkspace();
  try {
    const entry = start(root);
    const worktree = worktreePath(root, "frontend", "task-a");
    commitFile(worktree, "public/brand/logo.svg", "<svg/>\n");

    // Staged files in primary belong to someone else's commit in progress.
    writeFileSync(path.join(frontend, "other.txt"), "theirs\n");
    git(frontend, ["add", "other.txt"]);
    assert.throws(() => finishTask({ workspaceRoot: root, token: entry.token }), /has staged changes/);
    git(frontend, ["reset", "-q", "other.txt"]);

    // An untracked primary file at a path the branch adds: git refuses to
    // overwrite it, and the foreign file is left intact.
    mkdirSync(path.join(frontend, "public", "brand"), { recursive: true });
    writeFileSync(path.join(frontend, "public", "brand", "logo.svg"), "foreign draft\n");
    assert.throws(() => finishTask({ workspaceRoot: root, token: entry.token }), /merge --ff-only/);
    assert.equal(readFileSync(path.join(frontend, "public", "brand", "logo.svg"), "utf8"), "foreign draft\n");
    assert.equal(existsSync(path.join(root, mergeLockName("frontend"))), false, "lock released after failure");

    // Unrelated untracked primary files do not block landing.
    rmSync(path.join(frontend, "public", "brand", "logo.svg"));
    const result = finishTask({ workspaceRoot: root, token: entry.token });
    assert.equal(result.landed[0].status, "fast-forwarded");
    assert.equal(readFileSync(path.join(frontend, "other.txt"), "utf8"), "theirs\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("finish refuses uncommitted task changes and wrong tokens", () => {
  const { root } = createWorkspace();
  try {
    const entry = start(root);
    writeFileSync(path.join(worktreePath(root, "frontend", "task-a"), "draft.txt"), "wip\n");
    assert.throws(() => finishTask({ workspaceRoot: root, token: entry.token }), /has uncommitted changes/);
    assert.throws(() => finishTask({ workspaceRoot: root, token: "wrong" }), /does not own a started task/);
    assert.equal(workGuardStatus({ workspaceRoot: root }).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a plan that exists only on the task branch stays valid until the task lands", () => {
  const { root, frontend } = createWorkspace();
  try {
    const entry = start(root);
    const worktree = worktreePath(root, "frontend", "task-a");
    commitFile(worktree, "public/brand/logo.svg", "<svg/>\n");

    // Main archives the plan while the task branch still carries it.
    const primaryPlan = path.join(frontend, "docs", "plans", "active", "plan.md");
    git(frontend, ["rm", "-q", "docs/plans/active/plan.md"]);
    git(frontend, ["commit", "-q", "-m", "archive plan on main"]);
    assert.equal(existsSync(primaryPlan), false);
    assert.ok(existsSync(path.join(worktree, "docs", "plans", "active", "plan.md")));

    // The later task merges main but keeps the plan on its branch.
    git(worktree, ["merge", "-q", "--no-edit", "-s", "ours", "main"]);
    const result = finishTask({ workspaceRoot: root, token: entry.token });
    assert.equal(result.landed[0].status, "fast-forwarded");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("finish --keep lands but keeps the worktree, branch and claim", () => {
  const { root, frontend } = createWorkspace();
  try {
    const entry = start(root);
    const worktree = worktreePath(root, "frontend", "task-a");
    const head = commitFile(worktree, "public/brand/logo.svg", "<svg/>\n");

    const result = finishTask({ workspaceRoot: root, token: entry.token, keep: true });
    assert.equal(result.cleanedUp, false);
    assert.equal(git(frontend, ["rev-parse", "main"]), head);
    assert.ok(existsSync(worktree));
    assert.equal(workGuardStatus({ workspaceRoot: root }).length, 1);

    const again = finishTask({ workspaceRoot: root, token: entry.token });
    assert.equal(again.landed[0].status, "already-landed");
    assert.equal(existsSync(worktree), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a bare work:guard end leaves the task visibly unclaimed and release clears it", () => {
  const { root, frontend } = createWorkspace();
  try {
    const entry = start(root);
    const worktree = worktreePath(root, "frontend", "task-a");
    const head = commitFile(worktree, "public/brand/logo.svg", "<svg/>\n");

    // The 2026-10-12 orphan: claim released on its own, task record left behind.
    endWorkGuard({ workspaceRoot: root, token: entry.token });
    const orphan = taskStatus({ workspaceRoot: root }).tasks;
    assert.equal(orphan.length, 1);
    assert.equal(orphan[0].claimed, false, "status must flag the missing claim");
    assert.throws(() => finishTask({ workspaceRoot: root, token: entry.token }), /does not own a registered task/);

    const released = releaseTask({ workspaceRoot: root, token: entry.token });
    assert.deepEqual(released, {
      task: "task-a",
      branch: "claude/task-a",
      releasedClaim: false,
      keptWorktrees: [{ repo: "frontend", worktree: "MultiMix-Frontend/.worktrees/task-a" }],
    });
    assert.deepEqual(taskStatus({ workspaceRoot: root }).tasks, []);
    // Nothing of the work is touched: worktree, branch and commit stay, main does not move.
    assert.ok(existsSync(worktree));
    assert.equal(git(frontend, ["rev-parse", "claude/task-a"]), head);
    assert.notEqual(git(frontend, ["rev-parse", "main"]), head);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release ends a claimed task but keeps its worktree, branch and uncommitted files", () => {
  const { root, frontend } = createWorkspace();
  try {
    const entry = start(root);
    const worktree = worktreePath(root, "frontend", "task-a");
    writeFileSync(path.join(worktree, "draft.txt"), "keep me\n");

    const released = releaseTask({ workspaceRoot: root, token: entry.token });
    assert.equal(released.releasedClaim, true);
    assert.deepEqual(workGuardStatus({ workspaceRoot: root }), []);
    assert.deepEqual(taskStatus({ workspaceRoot: root }).tasks, []);
    assert.equal(readFileSync(path.join(worktree, "draft.txt"), "utf8"), "keep me\n");
    assert.equal(git(frontend, ["rev-parse", "--verify", "--quiet", "refs/heads/claude/task-a"]).length, 40);
    assert.ok(lstatSync(path.join(worktree, "node_modules")).isSymbolicLink(), "dependency link left for the holder");

    assert.throws(() => releaseTask({ workspaceRoot: root, token: entry.token }), /does not own a started task/);
    // The kept worktree occupies the name, so a restart fails clearly instead of silently reusing it.
    assert.throws(() => start(root), /Worktree already exists/);
    assert.deepEqual(workGuardStatus({ workspaceRoot: root }), [], "a failed restart leaves no claim");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release refuses tokens that do not own a task", () => {
  const { root } = createWorkspace();
  try {
    start(root);
    assert.throws(() => releaseTask({ workspaceRoot: root, token: "wrong" }), /does not own a started task/);
    assert.throws(() => releaseTask({ workspaceRoot: root, token: "" }), /task token is required/);
    assert.equal(taskStatus({ workspaceRoot: root }).tasks.length, 1);
    assert.equal(workGuardStatus({ workspaceRoot: root }).length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
