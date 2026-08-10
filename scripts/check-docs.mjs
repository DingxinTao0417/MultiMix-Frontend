import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GOVERNED_MARKDOWN_DIRS = [
  "MultiMix-Frontend/docs",
  "MultiMix-Backend/docs",
];

const ARCHIVE_DIRS = [
  "MultiMix-Frontend/docs/archive",
  "MultiMix-Backend/docs/archive",
];

const ACTIVE_PLAN_DIRS = [
  "MultiMix-Frontend/docs/plans/active",
  "MultiMix-Backend/docs/plans/active",
];

const STALE_LOCATIONS = [
  "docs",
];

const STALE_REFERENCES = [
  {
    token: "../docs/",
    replacement: "the relevant MultiMix-Frontend/docs/ or MultiMix-Backend/docs/ destination",
  },
];

const COMPLETED_PLAN_PATTERNS = [
  /^>\s*Status:\s*(completed|archived|done)\b/im,
  /^>\s*状态：.*(已完成|已归档|完成)/m,
  /^##\s+(实施状态|执行状态)（\d{4}-\d{2}-\d{2}\s+完成）\s*$/m,
  /^\*\*全部阶段完成(?:[，。！!]|[\r\n])/m,
];

const DOCUMENTATION_MAP_REFERENCE_PATTERN =
  /`((?:docs|MultiMix-Frontend\/docs|MultiMix-Backend\/docs)\/[^`\r\n]+\.md)`/g;

const REQUIRED_DOCUMENTATION_MAP_REFERENCES = [
  "MultiMix-Backend/docs/qa/project-review-standard.md",
  "MultiMix-Backend/docs/qa/security-review-baseline.md",
  "MultiMix-Backend/docs/qa/linear-issue-completion-evidence.md",
];

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function relativePath(root, target) {
  return toPosixPath(path.relative(root, target));
}

function exists(target) {
  return fs.existsSync(target);
}

function isMarkdown(target) {
  return target.toLowerCase().endsWith(".md");
}

function isReadme(relativeFile) {
  return path.basename(relativeFile).toLowerCase() === "readme.md";
}

function isInside(relativeFile, relativeDir) {
  return relativeFile === relativeDir || relativeFile.startsWith(`${relativeDir}/`);
}

function listFiles(root) {
  if (!exists(root)) {
    return [];
  }

  const results = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(target);
      } else if (entry.isFile()) {
        results.push(target);
      }
    }
  }

  return results.sort((a, b) => a.localeCompare(b));
}

function readText(target) {
  return fs.readFileSync(target, "utf8");
}

function issue(code, file, message, fix) {
  return { code, file, message, fix };
}

function checkWorkspaceDocsRemoved(workspaceRoot, issues) {
  const docsRoot = path.join(workspaceRoot, "docs");
  if (exists(docsRoot)) {
    issues.push(
      issue(
        "doc-root",
        "docs",
        "Workspace-root docs are retired.",
        "Move the content to MultiMix-Frontend/docs or MultiMix-Backend/docs, then remove docs/.",
      ),
    );
  }
}

function checkStaleLocations(workspaceRoot, issues) {
  for (const staleLocation of STALE_LOCATIONS) {
    const fullPath = path.join(workspaceRoot, ...staleLocation.split("/"));
    if (exists(fullPath)) {
      issues.push(
        issue(
          "stale-location",
          staleLocation,
          "A retired docs path exists again.",
          "Move the content to the current docs taxonomy and delete the retired path.",
        ),
      );
    }
  }
}

function checkMarkdownHeaders(workspaceRoot, files, issues) {
  for (const file of files) {
    const relativeFile = relativePath(workspaceRoot, file);
    if (!isMarkdown(relativeFile) || isReadme(relativeFile)) {
      continue;
    }

    const governed = GOVERNED_MARKDOWN_DIRS.some((dir) => isInside(relativeFile, dir));
    const archived = ARCHIVE_DIRS.some((dir) => isInside(relativeFile, dir));
    if (!governed || archived) {
      continue;
    }

    const content = readText(file);
    const hasStatus = /^>\s*Status:/m.test(content);
    const hasOwner = /^>\s*Owner:/m.test(content);
    const hasLastVerified = /^>\s*Last verified:/m.test(content);

    if (!hasStatus || !hasOwner || !hasLastVerified) {
      issues.push(
        issue(
          "doc-header",
          relativeFile,
          "Current docs need a small status header.",
          "Add '> Status:', '> Owner:', and '> Last verified: YYYY-MM-DD' near the top so future readers know whether it is current.",
        ),
      );
    }
  }
}

function checkStaleReferences(workspaceRoot, files, issues) {
  for (const file of files) {
    const relativeFile = relativePath(workspaceRoot, file);
    if (ARCHIVE_DIRS.some((dir) => isInside(relativeFile, dir))) {
      continue;
    }

    const content = readText(file);
    for (const staleRef of STALE_REFERENCES) {
      if (content.includes(staleRef.token)) {
        issues.push(
          issue(
            "stale-reference",
            relativeFile,
            `References retired path '${staleRef.token}'.`,
            `Replace it with '${staleRef.replacement}' unless this belongs in docs/archive.`,
          ),
        );
      }
    }
  }
}

function checkDocumentationMapReferences(workspaceRoot, issues) {
  const relativeFile = "MultiMix-Backend/docs/README.md";
  const mapFile = path.join(workspaceRoot, "MultiMix-Backend", "docs", "README.md");
  if (!exists(mapFile)) {
    return;
  }

  const content = readText(mapFile);
  const references = new Set(
    [...content.matchAll(DOCUMENTATION_MAP_REFERENCE_PATTERN)].map((match) => match[1]),
  );
  for (const reference of references) {
    const target = path.join(workspaceRoot, ...reference.split("/"));
    if (!exists(target)) {
      issues.push(
        issue(
          "missing-doc-reference",
          relativeFile,
          `References missing current document '${reference}'.`,
          "Update the documentation map to an existing current document or move the reference into the Archive section.",
        ),
      );
    }
  }

  for (const requiredReference of REQUIRED_DOCUMENTATION_MAP_REFERENCES) {
    if (references.has(requiredReference)) {
      continue;
    }
    issues.push(
      issue(
        "missing-required-doc-reference",
        relativeFile,
        `Missing required current document entry '${requiredReference}'.`,
        `Add a backticked '${requiredReference}' entry to MultiMix-Backend/docs/README.md.`,
      ),
    );
  }
}

function checkActivePlans(workspaceRoot, files, issues) {
  for (const file of files) {
    const relativeFile = relativePath(workspaceRoot, file);
    const activePlan = ACTIVE_PLAN_DIRS.some((dir) => isInside(relativeFile, dir));
    if (!activePlan || !isMarkdown(relativeFile) || isReadme(relativeFile)) {
      continue;
    }

    const content = readText(file);
    const hasCheckedItem = /^\s*-\s*\[[xX]\]/m.test(content);
    const hasUncheckedItem = /^\s*-\s*\[ \]/m.test(content);
    const completedChecklist = hasCheckedItem && !hasUncheckedItem;
    if (
      completedChecklist ||
      COMPLETED_PLAN_PATTERNS.some((pattern) => pattern.test(content))
    ) {
      issues.push(
        issue(
          "active-plan",
          relativeFile,
          "A completed or archived plan is still under docs/plans/active.",
          "Move completed plans to docs/archive/plans and keep docs/plans/active for open execution plans only.",
        ),
      );
    }
  }
}

function checkCurrentPrototype(workspaceRoot, issues) {
  const currentRoot = path.join(workspaceRoot, "MultiMix-Frontend", "docs", "specs", "ui", "prototypes", "current");
  if (!exists(currentRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(currentRoot, { withFileTypes: true })) {
    const relativeEntry = `MultiMix-Frontend/docs/specs/ui/prototypes/current/${entry.name}`;
    if (entry.isDirectory() && entry.name !== "screens") {
      issues.push(
        issue(
          "prototype-current",
          relativeEntry,
          "Current prototype should only keep the selected clickable draft and its screens.",
          "Move exploration variants to docs/specs/ui/prototypes/explorations/<date-topic>/.",
        ),
      );
    }

    if (entry.isFile() && !["README.md", "index.html"].includes(entry.name)) {
      issues.push(
        issue(
          "prototype-current",
          relativeEntry,
          "Unexpected file in current prototype root.",
          "Keep only README.md, index.html, and screens/ here; move variants to explorations.",
        ),
      );
    }
  }
}

export function checkDocs(workspaceRoot) {
  const root = path.resolve(workspaceRoot);
  const issues = [];
  const files = [
    ...listFiles(path.join(root, "MultiMix-Frontend", "docs")),
    ...listFiles(path.join(root, "MultiMix-Backend", "docs")),
  ];

  checkWorkspaceDocsRemoved(root, issues);
  checkStaleLocations(root, issues);
  checkMarkdownHeaders(root, files, issues);
  checkStaleReferences(root, files, issues);
  checkDocumentationMapReferences(root, issues);
  checkActivePlans(root, files, issues);
  checkCurrentPrototype(root, issues);

  return issues;
}

export function formatIssues(issues) {
  if (issues.length === 0) {
    return "Docs check passed.";
  }

  const lines = ["Docs check failed.", ""];
  for (const item of issues) {
    lines.push(`- [${item.code}] ${item.file}: ${item.message}`);
    lines.push(`  Fix: ${item.fix}`);
  }

  return lines.join("\n");
}

function getDefaultWorkspaceRoot() {
  const scriptPath = fileURLToPath(import.meta.url);
  const frontendRoot = path.resolve(path.dirname(scriptPath), "..");
  const workspaceRoot = path.resolve(frontendRoot, "..");

  if (
    exists(path.join(workspaceRoot, "MultiMix-Frontend", "docs", "README.md")) &&
    exists(path.join(workspaceRoot, "MultiMix-Backend", "docs", "README.md"))
  ) {
    return workspaceRoot;
  }

  return null;
}

function isCliEntry() {
  return process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
}

if (isCliEntry()) {
  const explicitRoot = process.argv[2] || process.env.MULTIMIX_WORKSPACE_ROOT;
  const workspaceRoot = explicitRoot ? path.resolve(explicitRoot) : getDefaultWorkspaceRoot();
  if (!workspaceRoot) {
    console.log(
      "Docs check skipped: split frontend/backend docs were not found next to this frontend checkout. Pass MULTIMIX_WORKSPACE_ROOT or a CLI path to check it explicitly.",
    );
    process.exitCode = 0;
  } else {
    const issues = checkDocs(workspaceRoot);
    console.log(formatIssues(issues));
    process.exitCode = issues.length === 0 ? 0 : 1;
  }
}
