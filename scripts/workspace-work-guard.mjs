import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REGISTRY_NAME = ".multimix-work-claims.json";
const UPDATE_LOCK_NAME = ".multimix-work-claims.lock";
const REGISTRY_VERSION = 1;
const ACTIVE_PLAN_PREFIXES = [
  "docs/plans/active/",
  "MultiMix-Frontend/docs/plans/active/",
  "MultiMix-Backend/docs/plans/active/",
];

function registryPath(workspaceRoot) {
  return path.join(workspaceRoot, REGISTRY_NAME);
}

function updateLockPath(workspaceRoot) {
  return path.join(workspaceRoot, UPDATE_LOCK_NAME);
}

function normalizeRelativePath(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }

  const portable = value.trim().replaceAll("\\", "/");
  if (path.posix.isAbsolute(portable) || /^[A-Za-z]:\//.test(portable)) {
    throw new Error(`${label} must be relative to the MultiMix workspace`);
  }

  const normalized = path.posix.normalize(portable).replace(/^\.\//, "").replace(/\/$/, "");
  if (
    normalized === "" ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    throw new Error(`${label} must stay inside the MultiMix workspace`);
  }
  return normalized;
}

const AREA_CATALOG_PATH = fileURLToPath(new URL("./work-areas.json", import.meta.url));

// Free-form names let near-duplicates slip past the area conflict check, so new
// claims must pick from the fixed catalog. Existing claims are read as-is.
export function loadWorkAreas(catalogPath = AREA_CATALOG_PATH) {
  let catalog;
  try {
    catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read work area catalog ${catalogPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const areas = Object.keys(catalog?.areas ?? {});
  if (catalog?.version !== 1 || areas.length === 0) {
    throw new Error(`Work area catalog ${catalogPath} has an unsupported or empty format`);
  }
  return areas.sort();
}

function normalizeAreas(values = [], allowedAreas = loadWorkAreas()) {
  const areas = values.map((value) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("Work area cannot be empty");
    }
    const normalized = value.trim().toLowerCase();
    if (!allowedAreas.includes(normalized)) {
      throw new Error(
        `Work area '${value}' is not in scripts/work-areas.json. Choose one of: ${allowedAreas.join(", ")}`,
      );
    }
    return normalized;
  });
  return [...new Set(areas)].sort();
}

function normalizeContracts(values = []) {
  const contracts = values.map((value) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("Work contract cannot be empty");
    }
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._/-]*$/.test(normalized)) {
      throw new Error(
        `Work contract '${value}' must be a stable lowercase slug using letters, numbers, '.', '_', '/', or '-'`,
      );
    }
    return normalized;
  });
  return [...new Set(contracts)].sort();
}

function normalizePaths(values = []) {
  return [
    ...new Set(values.map((value) => normalizeRelativePath(value, "Work path"))),
  ].sort();
}

function normalizeTask(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Task name is required");
  }
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    throw new Error(
      "Task name must be a stable lowercase slug using letters, numbers, '.', '_', or '-'",
    );
  }
  return normalized;
}

function normalizeOwner(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Owner is required");
  }
  return value.trim();
}

function normalizeIssue(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Linear issue cannot be empty");
  }
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]*-[0-9]+$/.test(normalized)) {
    throw new Error("Linear issue must use an identifier such as TEAM-123");
  }
  return normalized;
}

function normalizePlan(planRoots, value, { allowArchived = false } = {}) {
  const plan = normalizeRelativePath(value, "Active plan");
  if (
    !ACTIVE_PLAN_PREFIXES.some((prefix) => plan.startsWith(prefix)) ||
    !plan.toLowerCase().endsWith(".md")
  ) {
    throw new Error(
      "Active plan must be a Markdown file under docs/plans/active/, MultiMix-Frontend/docs/plans/active/, or MultiMix-Backend/docs/plans/active/",
    );
  }
  const exists = (segments) => planRoots.some((root) => existsSync(planLocation(root, segments)));
  const segments = plan.split("/");
  if (exists(segments)) return plan;
  // Only a same-name move to docs/archive/plans/ counts; a deleted plan never does.
  if (allowArchived && exists(plan.replace("/plans/active/", "/archive/plans/").split("/"))) return plan;
  throw new Error(`Active plan does not exist: ${plan}`);
}

// A root is either a workspace-shaped directory, or a single repository
// checkout `{ repo, dir }` (e.g. a task worktree) that holds plans for that
// repository; `repo: "."` is the workspace root repository.
function planLocation(root, segments) {
  if (typeof root === "string") return path.join(root, ...segments);
  const isRepoPlan = segments[0] === "MultiMix-Frontend" || segments[0] === "MultiMix-Backend";
  if (root.repo === "." ? isRepoPlan : segments[0] !== root.repo) return "";
  return path.join(root.dir, ...(root.repo === "." ? segments : segments.slice(1)));
}

// Coordination state is always shared; plans may additionally be found in the
// checkout the command runs from or in a task's own worktrees.
function planSearchRoots(root, extraRoots = []) {
  return [root, ...extraRoots];
}

function emptyRegistry() {
  return { version: REGISTRY_VERSION, claims: [] };
}

function readRegistry(workspaceRoot) {
  const filePath = registryPath(workspaceRoot);
  if (!existsSync(filePath)) return emptyRegistry();

  let registry;
  try {
    registry = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `Cannot read ${REGISTRY_NAME}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    registry?.version !== REGISTRY_VERSION ||
    !Array.isArray(registry?.claims)
  ) {
    throw new Error(`${REGISTRY_NAME} has an unsupported or invalid format`);
  }
  return registry;
}

function writeRegistry(workspaceRoot, registry) {
  const filePath = registryPath(workspaceRoot);
  if (registry.claims.length === 0) {
    if (existsSync(filePath)) unlinkSync(filePath);
    return;
  }

  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`);
  renameSync(temporaryPath, filePath);
}

function withUpdateLock(workspaceRoot, callback) {
  const filePath = updateLockPath(workspaceRoot);
  let descriptor;
  let acquired = false;
  try {
    descriptor = openSync(filePath, "wx");
    acquired = true;
    writeFileSync(
      descriptor,
      `${JSON.stringify({
        owner: `${process.env.USERNAME ?? process.env.USER ?? "unknown"}:${process.pid}`,
        createdAt: new Date().toISOString(),
      })}\n`,
    );
    closeSync(descriptor);
    descriptor = undefined;
    return callback();
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Work registry is already being updated. Inspect ${UPDATE_LOCK_NAME} before retrying; do not delete an active lock.`,
      );
    }
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (acquired && existsSync(filePath)) unlinkSync(filePath);
  }
}

function pathsOverlap(left, right) {
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();
  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.startsWith(`${normalizedRight}/`) ||
    normalizedRight.startsWith(`${normalizedLeft}/`)
  );
}

function conflictReasons(candidate, current) {
  const reasons = [];
  if (candidate.issue && current.issue === candidate.issue) {
    reasons.push(`issue:${candidate.issue}`);
  }
  for (const area of candidate.areas) {
    if (current.areas.includes(area)) reasons.push(`area:${area}`);
  }
  for (const contract of candidate.contracts) {
    if ((current.contracts ?? []).includes(contract)) {
      reasons.push(`contract:${contract}`);
    }
  }
  for (const candidatePath of candidate.paths) {
    for (const currentPath of current.paths) {
      if (!pathsOverlap(candidatePath, currentPath)) continue;
      const sharedPath =
        candidatePath.length <= currentPath.length ? candidatePath : currentPath;
      reasons.push(`path:${sharedPath}`);
    }
  }
  return [...new Set(reasons)].sort();
}

function publicClaim(claim) {
  const visible = { ...claim, contracts: claim.contracts ?? [] };
  delete visible.token;
  return visible;
}

function assertTokenOwner(registry, token) {
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("A work token is required");
  }
  const claim = registry.claims.find((item) => item.token === token);
  if (!claim) throw new Error("Provided token does not own a registered task");
  return claim;
}

export function beginWorkGuard({
  workspaceRoot,
  task,
  owner = `${process.env.USERNAME ?? process.env.USER ?? "unknown"}:${process.pid}`,
  issue,
  plan,
  areas = [],
  paths = [],
  contracts = [],
  token = crypto.randomUUID(),
  extraPlanRoots = [],
}) {
  const root = path.resolve(workspaceRoot);
  const normalizedPlan = normalizePlan(planSearchRoots(root, extraPlanRoots), plan);
  const normalizedAreas = normalizeAreas(areas);
  const normalizedWorkPaths = normalizePaths(paths);
  const normalizedContracts = normalizeContracts(contracts);
  if (
    normalizedAreas.length === 0 &&
    normalizedWorkPaths.length === 0 &&
    normalizedContracts.length === 0
  ) {
    throw new Error("Register at least one work area, path, or contract");
  }
  const candidate = {
    task: normalizeTask(task),
    owner: normalizeOwner(owner),
    issue: normalizeIssue(issue),
    plan: normalizedPlan,
    areas: normalizedAreas,
    paths: normalizePaths([...normalizedWorkPaths, normalizedPlan]),
    contracts: normalizedContracts,
    token,
    createdAt: new Date().toISOString(),
  };
  if (typeof token !== "string" || token.trim() === "") {
    throw new Error("Work token cannot be empty");
  }

  return withUpdateLock(root, () => {
    const registry = readRegistry(root);
    if (registry.claims.some((claim) => claim.task === candidate.task)) {
      throw new Error(`Task name '${candidate.task}' is already registered`);
    }
    if (registry.claims.some((claim) => claim.token === candidate.token)) {
      throw new Error("Work token is already registered to another task");
    }

    const conflicts = registry.claims
      .map((claim) => ({
        claim,
        reasons: conflictReasons(candidate, claim),
      }))
      .filter(({ reasons }) => reasons.length > 0);
    if (conflicts.length > 0) {
      const details = conflicts
        .map(
          ({ claim, reasons }) =>
            `task '${claim.task}' owned by '${claim.owner}' (${reasons.join(", ")})`,
        )
        .join("; ");
      throw new Error(`Work claim conflicts with ${details}`);
    }

    registry.claims.push(candidate);
    writeRegistry(root, registry);
    return { ...candidate };
  });
}

export function workGuardStatus({ workspaceRoot }) {
  return readRegistry(path.resolve(workspaceRoot)).claims.map(publicClaim);
}

export function checkWorkGuard({ workspaceRoot, token, extraPlanRoots = [], allowArchived = false }) {
  const root = path.resolve(workspaceRoot);
  const registry = readRegistry(root);
  const claim = assertTokenOwner(registry, token);
  normalizePlan(planSearchRoots(root, extraPlanRoots), claim.plan, { allowArchived });
  return publicClaim(claim);
}

export function endWorkGuard({ workspaceRoot, token }) {
  const root = path.resolve(workspaceRoot);
  return withUpdateLock(root, () => {
    const registry = readRegistry(root);
    const claim = assertTokenOwner(registry, token);
    registry.claims = registry.claims.filter((item) => item.token !== token);
    writeRegistry(root, registry);
    return publicClaim(claim);
  });
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

function hasWorkspaceShape(candidate) {
  return (
    existsSync(path.join(candidate, "MultiMix-Frontend", "docs", "README.md")) &&
    existsSync(path.join(candidate, "MultiMix-Backend", "docs", "README.md"))
  );
}

function canonicalPath(value) {
  try {
    return realpathSync.native(value);
  } catch {
    return path.resolve(value);
  }
}

// Directory-shape lookup only: finds the checkout a command runs from, which is
// a private copy for Codex worktrees. Coordination must use resolveWorkspaceRoot.
export function findWorkspaceRoot(startPath) {
  let candidate = path.resolve(startPath);
  while (true) {
    if (hasWorkspaceShape(candidate)) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        "MultiMix workspace root was not found. Pass --workspace-root <path> explicitly.",
      );
    }
    candidate = parent;
  }
}

function gitCommonDirectory(startPath) {
  try {
    const output = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: startPath, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

// Every linked worktree and workspace-shaped copy shares one git common
// directory per repository, so the primary checkout that owns it is the single
// place for claims and locks. Falls back to the directory shape when the start
// path is not inside a MultiMix repository (e.g. isolated test fixtures).
export function resolveWorkspaceRoot(startPath) {
  const start = path.resolve(startPath);
  const commonDirectory = gitCommonDirectory(start);
  if (commonDirectory && path.basename(commonDirectory).toLowerCase() === ".git") {
    const repository = canonicalPath(path.dirname(commonDirectory));
    const name = path.basename(repository);
    if (name === "MultiMix-Frontend" || name === "MultiMix-Backend") {
      const workspace = path.dirname(repository);
      if (hasWorkspaceShape(workspace)) return workspace;
    }
  }
  return findWorkspaceRoot(start);
}

function defaultWorkspaceRoot() {
  return resolveWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
}

function localCheckoutRoot() {
  try {
    return findWorkspaceRoot(process.cwd());
  } catch {
    return undefined;
  }
}

function usage() {
  return [
    "Usage:",
    "  workspace-work-guard.mjs begin --task <slug> --plan <active-plan.md> [--owner <label>] [--issue <TEAM-123>] [--area <slug>]... [--path <workspace-path>]... [--contract <slug>]...",
    "  workspace-work-guard.mjs status",
    "  workspace-work-guard.mjs check --token <token>",
    "  workspace-work-guard.mjs end --token <token>",
  ].join("\n");
}

function runCli() {
  const [command, ...args] = process.argv.slice(2);
  const explicitRoot = option(args, "--workspace-root");
  const workspaceRoot = path.resolve(explicitRoot ?? defaultWorkspaceRoot());
  const localRoot = explicitRoot ? undefined : localCheckoutRoot();
  const extraPlanRoots = localRoot ? [localRoot] : [];

  if (command === "begin") {
    const claim = beginWorkGuard({
      workspaceRoot,
      task: option(args, "--task"),
      owner: option(args, "--owner"),
      issue: option(args, "--issue"),
      plan: option(args, "--plan"),
      areas: repeatedOptions(args, "--area"),
      paths: repeatedOptions(args, "--path"),
      contracts: repeatedOptions(args, "--contract"),
      token: option(args, "--token"),
      extraPlanRoots,
    });
    console.log(JSON.stringify(claim, null, 2));
    return;
  }
  if (command === "status") {
    console.log(JSON.stringify(workGuardStatus({ workspaceRoot }), null, 2));
    return;
  }

  const token = option(args, "--token");
  if (command === "check") {
    console.log(JSON.stringify(checkWorkGuard({ workspaceRoot, token, extraPlanRoots }), null, 2));
    return;
  }
  if (command === "end") {
    const ended = endWorkGuard({ workspaceRoot, token });
    console.log(`Released work claim '${ended.task}'.`);
    return;
  }
  throw new Error(usage());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
