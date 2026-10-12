import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  beginWorkGuard,
  checkWorkGuard,
  endWorkGuard,
  resolveWorkspaceRoot,
  workGuardStatus,
} from "./workspace-work-guard.mjs";

// Task flow: every task develops and commits on its own branch in its own
// worktree (separate index, so commits never need a lock). Only landing on the
// primary checkout's main is serialized, with one short lock per repository.
export const REPOSITORIES = {
  frontend: "MultiMix-Frontend",
  backend: "MultiMix-Backend",
  root: ".",
};
export const LEGACY_SUBMIT_LOCK = ".multimix-submit-lock.json";
const TASKS_NAME = ".multimix-tasks.json";
const TASKS_LOCK_NAME = ".multimix-tasks.lock";
const AGENT_PREFIXES = ["claude", "codex"];
// Backend worktrees need no link: its pre-push hook already falls back to the
// primary checkout's .venv through the git common directory.
const SHARED_DEPENDENCIES = { frontend: "node_modules" };

export function mergeLockName(repo) {
  return `.multimix-merge-lock-${repo}.json`;
}

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    }).trim();
  } catch (error) {
    if (allowFailure) return undefined;
    const detail = error?.stderr?.toString().trim() || error?.message || String(error);
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${detail}`);
  }
}

function isAncestor(cwd, ancestor, descendant) {
  return git(cwd, ["merge-base", "--is-ancestor", ancestor, descendant], { allowFailure: true }) !== undefined;
}

function normalizeRepos(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Declare at least one --repo (${Object.keys(REPOSITORIES).join(", ")})`);
  }
  const repos = [...new Set(values.map((value) => String(value).trim().toLowerCase()))];
  for (const repo of repos) {
    if (!(repo in REPOSITORIES)) {
      throw new Error(`Unknown repo '${repo}'. Use one of: ${Object.keys(REPOSITORIES).join(", ")}`);
    }
  }
  return repos.sort();
}

function normalizeAgent(owner) {
  const agent = String(owner ?? "").trim().toLowerCase().split(/[-:]/)[0];
  if (!AGENT_PREFIXES.includes(agent)) {
    throw new Error(
      `--owner must start with ${AGENT_PREFIXES.map((item) => `${item}-`).join(" or ")}, got '${owner}'`,
    );
  }
  return agent;
}

function repoRoot(workspaceRoot, repo) {
  return path.join(workspaceRoot, REPOSITORIES[repo]);
}

export function worktreePath(workspaceRoot, repo, task) {
  return path.join(repoRoot(workspaceRoot, repo), ".worktrees", task);
}

function ownerLabel() {
  return `${process.env.USERNAME ?? process.env.USER ?? "unknown"}:${process.pid}`;
}

// Exclusive create is the lock; the file is always removed when the callback
// settles, so a held lock means another process is inside the critical section.
function withExclusiveFile(filePath, owner, busy, callback) {
  let descriptor;
  try {
    descriptor = openSync(filePath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      let current;
      try {
        current = JSON.parse(readFileSync(filePath, "utf8"));
      } catch {
        current = undefined;
      }
      throw new Error(busy(current));
    }
    throw error;
  }
  try {
    writeFileSync(descriptor, `${JSON.stringify({ owner, createdAt: new Date().toISOString() })}\n`);
    closeSync(descriptor);
    descriptor = undefined;
    return callback();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (existsSync(filePath)) unlinkSync(filePath);
  }
}

function readTasks(workspaceRoot) {
  const filePath = path.join(workspaceRoot, TASKS_NAME);
  if (!existsSync(filePath)) return { version: 1, tasks: [] };
  const data = JSON.parse(readFileSync(filePath, "utf8"));
  if (data?.version !== 1 || !Array.isArray(data.tasks)) {
    throw new Error(`${TASKS_NAME} has an unsupported or invalid format`);
  }
  return data;
}

function updateTasks(workspaceRoot, mutate) {
  return withExclusiveFile(
    path.join(workspaceRoot, TASKS_LOCK_NAME),
    ownerLabel(),
    () => `Task registry is being updated. Inspect ${TASKS_LOCK_NAME} before retrying; do not delete an active lock.`,
    () => {
      const data = readTasks(workspaceRoot);
      const result = mutate(data);
      const filePath = path.join(workspaceRoot, TASKS_NAME);
      if (data.tasks.length === 0) {
        if (existsSync(filePath)) unlinkSync(filePath);
      } else {
        const temporaryPath = `${filePath}.${process.pid}.tmp`;
        writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
        renameSync(temporaryPath, filePath);
      }
      return result;
    },
  );
}

function findTask(workspaceRoot, token) {
  if (typeof token !== "string" || token.trim() === "") throw new Error("A task token is required");
  const entry = readTasks(workspaceRoot).tasks.find((item) => item.token === token);
  if (!entry) throw new Error("Provided token does not own a started task");
  return entry;
}

function linkSharedDependencies(workspaceRoot, repo, worktree) {
  const shared = SHARED_DEPENDENCIES[repo];
  if (!shared) return undefined;
  const source = path.join(repoRoot(workspaceRoot, repo), shared);
  const target = path.join(worktree, shared);
  if (!existsSync(source) || existsSync(target)) return undefined;
  symlinkSync(source, target, "junction");
  return shared;
}

// Always drop the dependency link before removing a worktree so removal can
// never descend into the primary checkout's shared dependencies.
function unlinkSharedDependencies(worktree, linked) {
  if (!linked) return;
  const target = path.join(worktree, linked);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (stat?.isSymbolicLink()) unlinkSync(target);
}

function isRegisteredWorktree(workspaceRoot, repo, worktree) {
  const listing = git(repoRoot(workspaceRoot, repo), ["worktree", "list", "--porcelain"]);
  const wanted = path.resolve(worktree).toLowerCase();
  return listing
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .some((line) => path.resolve(line.slice("worktree ".length)).toLowerCase() === wanted);
}

function branchExists(workspaceRoot, repo, branch) {
  return Boolean(
    git(repoRoot(workspaceRoot, repo), ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], {
      allowFailure: true,
    }),
  );
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// Windows can briefly hold a just-used directory (indexer, antivirus, editor
// watchers), so `worktree remove` may fail once and then succeed.
export const REMOVE_RETRY_DELAYS_MS = [200, 600, 1200];

function removeWorktreeDirectory(workspaceRoot, repo, worktree, { retryDelays = REMOVE_RETRY_DELAYS_MS } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retryDelays.length; attempt += 1) {
    // A failed removal can still unregister the worktree and empty it, leaving
    // only the directory; treat that as removed rather than retrying git.
    if (!isRegisteredWorktree(workspaceRoot, repo, worktree)) return;
    try {
      git(repoRoot(workspaceRoot, repo), ["worktree", "remove", worktree]);
      return;
    } catch (error) {
      lastError = error;
      const transient = /permission denied|device or resource busy|ebusy|being used by another process/i.test(
        error instanceof Error ? error.message : String(error),
      );
      if (!transient || attempt === retryDelays.length) break;
      sleep(retryDelays[attempt]);
    }
  }
  if (!isRegisteredWorktree(workspaceRoot, repo, worktree)) return;
  throw lastError;
}

// Only an empty leftover directory is removed; anything inside it is reported
// instead of deleted, since it is no longer a git worktree we own.
function removeLeftoverDirectory(worktree) {
  if (!existsSync(worktree)) return;
  if (readdirSync(worktree).length > 0) {
    throw new Error(`${worktree} is no longer a git worktree but is not empty; inspect it before running finish again`);
  }
  rmdirSync(worktree);
}

// Every step is safe to repeat, so a cleanup interrupted after landing can be
// completed by running finish again: removed worktrees and deleted branches are
// skipped instead of failing.
function removeWorktree(workspaceRoot, repo, worktree, linked, branch, options) {
  if (isRegisteredWorktree(workspaceRoot, repo, worktree)) {
    if (existsSync(worktree)) {
      unlinkSharedDependencies(worktree, linked);
      removeWorktreeDirectory(workspaceRoot, repo, worktree, options);
    } else {
      git(repoRoot(workspaceRoot, repo), ["worktree", "prune"]);
    }
  }
  removeLeftoverDirectory(worktree);
  // -d only: an unmerged branch is never deleted here.
  if (branchExists(workspaceRoot, repo, branch)) {
    git(repoRoot(workspaceRoot, repo), ["branch", "-d", branch]);
  }
}

export function startTask({
  workspaceRoot,
  task,
  owner,
  plan,
  repos,
  areas = [],
  paths = [],
  contracts = [],
  issue,
  base = "main",
  token = crypto.randomUUID(),
  extraPlanRoots = [],
}) {
  const root = path.resolve(workspaceRoot);
  const normalizedRepos = normalizeRepos(repos);
  const agent = normalizeAgent(owner);

  const claim = beginWorkGuard({
    workspaceRoot: root, task, owner, plan, areas, paths, contracts, issue, token, extraPlanRoots,
  });
  const branch = `${agent}/${claim.task}`;
  const created = [];
  try {
    for (const repo of normalizedRepos) {
      const primary = repoRoot(root, repo);
      const worktree = worktreePath(root, repo, claim.task);
      if (existsSync(worktree)) throw new Error(`Worktree already exists: ${worktree}`);
      if (git(primary, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true })) {
        throw new Error(`Branch '${branch}' already exists in ${REPOSITORIES[repo]}`);
      }
      mkdirSync(path.dirname(worktree), { recursive: true });
      git(primary, ["worktree", "add", "-b", branch, worktree, base]);
      const record = { repo, worktree };
      created.push(record);
      record.linked = linkSharedDependencies(root, repo, worktree);
    }
    return updateTasks(root, (data) => {
      const entry = {
        task: claim.task,
        owner: claim.owner,
        token: claim.token,
        branch,
        base,
        repos: created.map(({ repo, worktree, linked }) => ({
          repo,
          worktree: path.relative(root, worktree).replaceAll("\\", "/"),
          ...(linked ? { linked } : {}),
        })),
        startedAt: new Date().toISOString(),
      };
      data.tasks.push(entry);
      return entry;
    });
  } catch (error) {
    for (const { repo, worktree, linked } of created.reverse()) {
      try {
        removeWorktree(root, repo, worktree, linked, branch);
      } catch {
        // Leave anything that cannot be removed cleanly for manual review.
      }
    }
    endWorkGuard({ workspaceRoot: root, token: claim.token });
    throw error;
  }
}

// Lands one repository on the primary checkout. Requirements: primary is on
// base with an empty index, no legacy submit lock exists, and the task branch
// already contains base (the later task resolves conflicts in its own
// worktree). Only fast-forwards; git itself refuses one that would overwrite
// uncommitted files in the primary checkout.
export function landRepository({ workspaceRoot, repo, branch, owner, base = "main" }) {
  const root = path.resolve(workspaceRoot);
  if (existsSync(path.join(root, LEGACY_SUBMIT_LOCK))) {
    throw new Error(`Legacy ${LEGACY_SUBMIT_LOCK} is still held; wait for its owner to finish before landing`);
  }
  return withExclusiveFile(
    path.join(root, mergeLockName(repo)),
    owner,
    (current) =>
      `${REPOSITORIES[repo]} is being landed by ${current?.owner ?? "another task"} since ${current?.createdAt ?? "unknown"}; retry after it finishes`,
    () => {
      const primary = repoRoot(root, repo);
      const current = git(primary, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
      if (current !== base) {
        throw new Error(`${REPOSITORIES[repo]} primary checkout is on '${current ?? "detached HEAD"}', expected '${base}'`);
      }
      if (git(primary, ["diff", "--cached", "--name-only"])) {
        throw new Error(`${REPOSITORIES[repo]} primary checkout has staged changes; landing refuses to mix them in`);
      }
      const baseHead = git(primary, ["rev-parse", base]);
      const branchHead = git(primary, ["rev-parse", branch]);
      if (baseHead === branchHead || isAncestor(primary, branch, base)) {
        return { repo, status: "already-landed", head: baseHead };
      }
      if (!isAncestor(primary, base, branch)) {
        throw new Error(
          `${branch} does not contain the latest ${REPOSITORIES[repo]} ${base}. In the task worktree run 'git merge ${base}', resolve conflicts, commit, then finish again`,
        );
      }
      git(primary, ["merge", "--ff-only", branch]);
      return { repo, status: "fast-forwarded", from: baseHead, head: git(primary, ["rev-parse", base]) };
    },
  );
}

export function finishTask({ workspaceRoot, token, keep = false, retryDelays = REMOVE_RETRY_DELAYS_MS }) {
  const root = path.resolve(workspaceRoot);
  const entry = findTask(root, token);
  // The plan may only exist on the task branch until it lands.
  const taskPlanRoots = entry.repos.map(({ repo, worktree }) => ({
    repo: REPOSITORIES[repo],
    dir: path.join(root, worktree),
  }));
  checkWorkGuard({ workspaceRoot: root, token, extraPlanRoots: taskPlanRoots });

  // Only check worktrees git still knows. Running git in a leftover directory
  // that is no longer a worktree would read the primary checkout instead and
  // report other people's uncommitted files as this task's.
  for (const { repo, worktree } of entry.repos) {
    const absolute = path.join(root, worktree);
    if (!existsSync(absolute) || !isRegisteredWorktree(root, repo, absolute)) continue;
    const dirty = git(absolute, ["status", "--porcelain"]);
    if (dirty) {
      throw new Error(`${worktree} has uncommitted changes; commit or discard them before finishing:\n${dirty}`);
    }
  }

  const landed = [];
  for (const { repo, worktree } of entry.repos) {
    // `branch -d` only ever deletes a branch that is fully merged, so a missing
    // branch whose worktree is also gone means an earlier finish already landed
    // and cleaned this repository.
    if (
      !branchExists(root, repo, entry.branch) &&
      !isRegisteredWorktree(root, repo, path.join(root, worktree))
    ) {
      landed.push({ repo, status: "already-cleaned" });
      continue;
    }
    try {
      landed.push(
        landRepository({ workspaceRoot: root, repo, branch: entry.branch, owner: entry.owner, base: entry.base }),
      );
    } catch (error) {
      const done = landed.map((item) => `${item.repo}:${item.status}`).join(", ") || "none";
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\nAlready landed: ${done}. Worktrees and claim are kept; fix the issue and run finish again.`,
      );
    }
  }

  if (!keep) {
    const cleaned = [];
    for (const { repo, worktree, linked } of entry.repos) {
      try {
        removeWorktree(root, repo, path.join(root, worktree), linked, entry.branch, { retryDelays });
        cleaned.push(repo);
      } catch (error) {
        const pending = entry.repos.map((item) => item.repo).filter((item) => !cleaned.includes(item));
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\nAll repositories are landed; cleanup is pending for: ${pending.join(", ")}. The claim and task record are kept; run finish again to complete the cleanup.`,
        );
      }
    }
    endWorkGuard({ workspaceRoot: root, token });
    updateTasks(root, (data) => {
      data.tasks = data.tasks.filter((item) => item.token !== token);
    });
  }
  return { task: entry.task, branch: entry.branch, landed, cleanedUp: !keep };
}

// Keeps the worktree and branch for later handling but ends the task: the claim
// (if still held) and the task record both go away. Use this instead of a bare
// `work:guard end`, which would leave the task record behind and block both
// `finish` and a restart under the same name.
export function releaseTask({ workspaceRoot, token }) {
  const root = path.resolve(workspaceRoot);
  const entry = findTask(root, token);
  const claimed = workGuardStatus({ workspaceRoot: root }).some((claim) => claim.task === entry.task);
  if (claimed) endWorkGuard({ workspaceRoot: root, token });
  updateTasks(root, (data) => {
    data.tasks = data.tasks.filter((item) => item.token !== token);
  });
  return {
    task: entry.task,
    branch: entry.branch,
    releasedClaim: claimed,
    keptWorktrees: entry.repos.map(({ repo, worktree }) => ({ repo, worktree })),
  };
}

export function taskStatus({ workspaceRoot }) {
  const root = path.resolve(workspaceRoot);
  const claimedTasks = new Set(workGuardStatus({ workspaceRoot: root }).map((claim) => claim.task));
  return {
    // Tokens authorize finish/release, so status never exposes them.
    tasks: readTasks(root).tasks.map((entry) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { token, ...visible } = entry;
      return { ...visible, claimed: claimedTasks.has(entry.task) };
    }),
    landingLocks: Object.keys(REPOSITORIES)
      .map((repo) => {
        const filePath = path.join(root, mergeLockName(repo));
        return existsSync(filePath) ? { repo, ...JSON.parse(readFileSync(filePath, "utf8")) } : undefined;
      })
      .filter(Boolean),
    legacySubmitLock: existsSync(path.join(root, LEGACY_SUBMIT_LOCK)),
  };
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function repeatedOptions(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1] !== undefined) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function usage() {
  return [
    "Usage:",
    "  workspace-task.mjs start --task <slug> --owner <claude-*|codex-*> --plan <active-plan.md> --repo <frontend|backend|root>... [--area <slug>]... [--path <workspace-path>]... [--contract <slug>]... [--issue <TEAM-123>]",
    "  workspace-task.mjs finish --token <token> [--keep]",
    "  workspace-task.mjs release --token <token>",
    "  workspace-task.mjs status",
  ].join("\n");
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  const workspaceRoot = path.resolve(
    option(args, "--workspace-root") ?? resolveWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url))),
  );
  if (command === "start") {
    const entry = startTask({
      workspaceRoot,
      task: option(args, "--task"),
      owner: option(args, "--owner"),
      plan: option(args, "--plan"),
      issue: option(args, "--issue"),
      repos: repeatedOptions(args, "--repo"),
      areas: repeatedOptions(args, "--area"),
      paths: repeatedOptions(args, "--path"),
      contracts: repeatedOptions(args, "--contract"),
    });
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  if (command === "finish") {
    const result = finishTask({ workspaceRoot, token: option(args, "--token"), keep: args.includes("--keep") });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === "release") {
    console.log(JSON.stringify(releaseTask({ workspaceRoot, token: option(args, "--token") }), null, 2));
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(taskStatus({ workspaceRoot }), null, 2));
    return;
  }
  throw new Error(usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
