import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORIES = ["MultiMix-Frontend", "MultiMix-Backend"];
const LOCK_NAME = ".multimix-submit-lock.json";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function git(repo, args, options = {}) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: options.encoding ?? "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function untrackedSnapshot(repo) {
  const raw = git(repo, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = raw.toString("utf8").split("\0").filter(Boolean).sort();
  return paths.map((relativePath) => {
    const absolutePath = path.join(repo, relativePath);
    return {
      path: relativePath.replaceAll("\\", "/"),
      hash: existsSync(absolutePath) ? sha256(readFileSync(absolutePath)) : "missing",
    };
  });
}

function repositorySnapshot(workspaceRoot, name) {
  const repo = path.join(workspaceRoot, name);
  if (!existsSync(path.join(repo, ".git"))) throw new Error(`Missing Git repository: ${repo}`);
  return {
    name,
    head: git(repo, ["rev-parse", "HEAD"]).toString("utf8").trim(),
    staged: sha256(git(repo, ["diff", "--cached", "--binary", "--no-ext-diff"])),
    unstaged: sha256(git(repo, ["diff", "--binary", "--no-ext-diff"])),
    untracked: untrackedSnapshot(repo),
  };
}

export function snapshotWorkspace(workspaceRoot) {
  const authorityFiles = [];
  const addFile = (absolutePath) => {
    authorityFiles.push({
      path: path.relative(workspaceRoot, absolutePath).replaceAll("\\", "/"),
      hash: sha256(readFileSync(absolutePath)),
    });
  };
  const walk = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.isFile()) addFile(absolutePath);
    }
  };
  const rootAgents = path.join(workspaceRoot, "AGENTS.md");
  if (existsSync(rootAgents)) addFile(rootAgents);
  walk(path.join(workspaceRoot, "docs"));
  authorityFiles.sort((left, right) => left.path.localeCompare(right.path));
  return {
    repositories: REPOSITORIES.map((name) => repositorySnapshot(workspaceRoot, name)),
    authorityFiles,
  };
}

function lockPath(workspaceRoot) {
  return path.join(workspaceRoot, LOCK_NAME);
}

function readLock(workspaceRoot) {
  const filePath = lockPath(workspaceRoot);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function assertOwner(lock, token) {
  if (!lock) throw new Error("Workspace is not locked");
  if (lock.token !== token) throw new Error("Provided token does not own the workspace submit lock");
}

function writeLock(workspaceRoot, lock) {
  const filePath = lockPath(workspaceRoot);
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(lock, null, 2)}\n`);
  renameSync(temporaryPath, filePath);
}

export function beginGuard({ workspaceRoot, token = crypto.randomUUID(), owner = `${process.env.USERNAME ?? process.env.USER ?? "unknown"}:${process.pid}` }) {
  const filePath = lockPath(workspaceRoot);
  let descriptor;
  try {
    descriptor = openSync(filePath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      const current = readLock(workspaceRoot);
      throw new Error(`Workspace is already locked by ${current?.owner ?? "another writer"}`);
    }
    throw error;
  }
  const lock = {
    version: 1,
    token,
    owner,
    createdAt: new Date().toISOString(),
    checkpointedAt: null,
    snapshot: snapshotWorkspace(workspaceRoot),
  };
  writeFileSync(descriptor, `${JSON.stringify(lock, null, 2)}\n`);
  closeSync(descriptor);
  return lock;
}

export function verifyGuard({ workspaceRoot, token }) {
  const lock = readLock(workspaceRoot);
  assertOwner(lock, token);
  const current = snapshotWorkspace(workspaceRoot);
  if (JSON.stringify(current) !== JSON.stringify(lock.snapshot)) {
    throw new Error(`Workspace changed after the submit snapshot:\n${JSON.stringify({ expected: lock.snapshot, current }, null, 2)}`);
  }
  return lock;
}

export function checkpointGuard({ workspaceRoot, token }) {
  const lock = readLock(workspaceRoot);
  assertOwner(lock, token);
  const updated = {
    ...lock,
    checkpointedAt: new Date().toISOString(),
    snapshot: snapshotWorkspace(workspaceRoot),
  };
  writeLock(workspaceRoot, updated);
  return updated;
}

export function guardStatus({ workspaceRoot }) {
  return readLock(workspaceRoot);
}

export function endGuard({ workspaceRoot, token }) {
  const lock = readLock(workspaceRoot);
  assertOwner(lock, token);
  unlinkSync(lockPath(workspaceRoot));
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function defaultWorkspaceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  const workspaceRoot = path.resolve(option(args, "--workspace-root") ?? defaultWorkspaceRoot());
  const token = option(args, "--token");
  if (command === "begin") {
    console.log(JSON.stringify(beginGuard({ workspaceRoot, token }), null, 2));
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(guardStatus({ workspaceRoot }), null, 2));
    return;
  }
  if (!token) throw new Error(`${command ?? "command"} requires --token <token>`);
  if (command === "verify") console.log(JSON.stringify(verifyGuard({ workspaceRoot, token }), null, 2));
  else if (command === "checkpoint") console.log(JSON.stringify(checkpointGuard({ workspaceRoot, token }), null, 2));
  else if (command === "end") {
    endGuard({ workspaceRoot, token });
    console.log("Workspace submit lock released.");
  } else {
    throw new Error("Usage: workspace-submit-guard.mjs <begin|verify|checkpoint|status|end> [--token <token>] [--workspace-root <path>]");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
