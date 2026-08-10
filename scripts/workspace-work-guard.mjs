import crypto from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
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

function normalizeAreas(values = []) {
  const areas = values.map((value) => {
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("Work area cannot be empty");
    }
    const normalized = value.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9._/-]*$/.test(normalized)) {
      throw new Error(
        `Work area '${value}' must be a stable lowercase slug using letters, numbers, '.', '_', '/', or '-'`,
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

function normalizePlan(workspaceRoot, value, { requireExists = true } = {}) {
  const plan = normalizeRelativePath(value, "Active plan");
  if (
    !ACTIVE_PLAN_PREFIXES.some((prefix) => plan.startsWith(prefix)) ||
    !plan.toLowerCase().endsWith(".md")
  ) {
    throw new Error(
      "Active plan must be a Markdown file under MultiMix-Frontend/docs/plans/active/ or MultiMix-Backend/docs/plans/active/",
    );
  }
  if (requireExists && !existsSync(path.join(workspaceRoot, ...plan.split("/")))) {
    throw new Error(`Active plan does not exist: ${plan}`);
  }
  return plan;
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
}) {
  const root = path.resolve(workspaceRoot);
  const normalizedPlan = normalizePlan(root, plan);
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

export function checkWorkGuard({ workspaceRoot, token }) {
  const root = path.resolve(workspaceRoot);
  const registry = readRegistry(root);
  const claim = assertTokenOwner(registry, token);
  normalizePlan(root, claim.plan);
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

export function findWorkspaceRoot(startPath) {
  let candidate = path.resolve(startPath);
  while (true) {
    if (
      existsSync(path.join(candidate, "MultiMix-Frontend", "docs", "README.md")) &&
      existsSync(path.join(candidate, "MultiMix-Backend", "docs", "README.md"))
    ) {
      return candidate;
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new Error(
        "MultiMix workspace root was not found. Pass --workspace-root <path> explicitly.",
      );
    }
    candidate = parent;
  }
}

function defaultWorkspaceRoot() {
  return findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));
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
  const workspaceRoot = path.resolve(
    option(args, "--workspace-root") ?? defaultWorkspaceRoot(),
  );

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
    console.log(JSON.stringify(checkWorkGuard({ workspaceRoot, token }), null, 2));
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
