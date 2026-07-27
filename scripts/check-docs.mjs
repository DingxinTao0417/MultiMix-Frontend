import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DOC_ROOT_ALLOWED_FILES = new Set(["README.md"]);
const DOC_ROOT_ALLOWED_DIRS = new Set(["archive", "authority", "plans", "qa", "specs"]);

const GOVERNED_MARKDOWN_DIRS = [
  "docs/authority",
  "docs/qa",
  "docs/plans/active",
  "docs/specs",
  "MultiMix-Frontend/docs",
  "MultiMix-Backend/docs",
];

const ARCHIVE_DIRS = [
  "docs/archive",
  "MultiMix-Backend/docs/archive",
];

const ACTIVE_PLAN_DIRS = [
  "docs/plans/active",
  "MultiMix-Backend/docs/plans/active",
];

const STALE_LOCATIONS = [
  "docs/superpowers",
  "docs/ui-redesign-demos",
  "docs/multimix-ui-vision.html",
  "docs/MULTIMIX_ASSET_UNDERSTANDING_AND_SEGMENT_REFERENCING.md",
  "docs/MULTIMIX_MG_OVERLAY_AUTOMATION_AND_RENDERING.md",
  "docs/MULTIMIX_CONVERSATION_ORCHESTRATION_RULES.md",
  "docs/AGENT_PRE_GENERATION_CONVERSATION_REGRESSION_TESTS.md",
  "docs/MULTIMIX_TIER1_UPGRADE_DESIGN.md",
];

const STALE_REFERENCES = [
  {
    token: "docs/ui-redesign-demos",
    replacement: "docs/specs/ui/prototypes/current or docs/specs/ui/prototypes/explorations",
  },
  {
    token: "docs/multimix-ui-vision.html",
    replacement: "docs/archive/design/2026-07-04-multimix-ui-vision.html",
  },
  {
    token: "docs/MULTIMIX_ASSET_UNDERSTANDING_AND_SEGMENT_REFERENCING",
    replacement: "docs/authority/asset-understanding-and-segment-referencing.md",
  },
  {
    token: "docs/MULTIMIX_MG_OVERLAY_AUTOMATION_AND_RENDERING",
    replacement: "docs/authority/mg-overlay-automation-and-rendering.md",
  },
  {
    token: "docs/MULTIMIX_CONVERSATION_ORCHESTRATION_RULES",
    replacement: "docs/authority/conversation-orchestration-rules.md",
  },
  {
    token: "docs/AGENT_PRE_GENERATION_CONVERSATION_REGRESSION_TESTS",
    replacement: "docs/qa/conversation-regression-tests.md",
  },
  {
    token: "docs/MULTIMIX_TIER1_UPGRADE_DESIGN",
    replacement: "docs/plans/active/tier1-upgrade-design.md",
  },
  {
    token: "docs/superpowers",
    replacement: "docs/plans, docs/authority, docs/qa, or docs/specs/ui",
  },
];

const COMPLETED_PLAN_PATTERNS = [
  /^>\s*Status:\s*(completed|archived|done)\b/im,
  /^>\s*状态：.*(已完成|已归档|完成)/m,
  /全部阶段完成/,
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

function checkDocsRoot(workspaceRoot, issues) {
  const docsRoot = path.join(workspaceRoot, "docs");
  if (!exists(docsRoot)) {
    issues.push(
      issue(
        "doc-root",
        "docs",
        "Missing workspace docs directory.",
        "Create docs/ with README.md plus authority, plans, qa, specs, and archive directories.",
      ),
    );
    return;
  }

  for (const entry of fs.readdirSync(docsRoot, { withFileTypes: true })) {
    if (entry.isFile() && !DOC_ROOT_ALLOWED_FILES.has(entry.name)) {
      issues.push(
        issue(
          "doc-root",
          `docs/${entry.name}`,
          "Loose files are not allowed directly under docs/.",
          "Move it into docs/authority, docs/plans/active, docs/qa, docs/specs/ui, or docs/archive and update docs/README.md.",
        ),
      );
    }

    if (entry.isDirectory() && !DOC_ROOT_ALLOWED_DIRS.has(entry.name)) {
      issues.push(
        issue(
          "doc-root",
          `docs/${entry.name}`,
          "Unknown top-level docs directory.",
          "Use one of: docs/authority, docs/plans, docs/qa, docs/specs, docs/archive.",
        ),
      );
    }
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
  const currentRoot = path.join(workspaceRoot, "docs", "specs", "ui", "prototypes", "current");
  if (!exists(currentRoot)) {
    return;
  }

  for (const entry of fs.readdirSync(currentRoot, { withFileTypes: true })) {
    const relativeEntry = `docs/specs/ui/prototypes/current/${entry.name}`;
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
  const docsRoot = path.join(root, "docs");
  const issues = [];
  const files = [
    ...listFiles(docsRoot),
    ...listFiles(path.join(root, "MultiMix-Frontend", "docs")),
    ...listFiles(path.join(root, "MultiMix-Backend", "docs")),
  ];

  checkDocsRoot(root, issues);
  checkStaleLocations(root, issues);
  checkMarkdownHeaders(root, files, issues);
  checkStaleReferences(root, files, issues);
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

  if (exists(path.join(workspaceRoot, "docs", "README.md"))) {
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
      "Docs check skipped: workspace docs root was not found next to this frontend checkout. Pass MULTIMIX_WORKSPACE_ROOT or a CLI path to check it explicitly.",
    );
    process.exitCode = 0;
  } else {
    const issues = checkDocs(workspaceRoot);
    console.log(formatIssues(issues));
    process.exitCode = issues.length === 0 ? 0 : 1;
  }
}
