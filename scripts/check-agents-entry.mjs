// Verify every CLAUDE.md entry stays a thin importer of its sibling AGENTS.md.
// AGENTS.md is the single rule source; CLAUDE.md only adds Claude Code specifics.
//   node scripts/check-agents-entry.mjs   -> exit 1 if any checked pair drifts
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const IMPORT_LINE = "@AGENTS.md";
export const MAX_ENTRY_LINES = 60;

function readLines(filePath) {
  return readFileSync(filePath, "utf8").split(/\r?\n/);
}

// H1 titles legitimately differ between the two files, so only H2+ are compared.
function sectionHeadings(lines) {
  return lines.filter((line) => /^#{2,6}\s+\S/.test(line)).map((line) => line.trim());
}

export function checkEntryPair(directory, label = directory) {
  const errors = [];
  const agentsPath = path.join(directory, "AGENTS.md");
  const claudePath = path.join(directory, "CLAUDE.md");

  if (!existsSync(agentsPath)) return [`${label}: AGENTS.md is missing`];
  if (!existsSync(claudePath)) return [`${label}: CLAUDE.md is missing`];

  const agentsLines = readLines(agentsPath);
  const claudeLines = readLines(claudePath);

  if (agentsLines.every((line) => line.trim() === "")) {
    errors.push(`${label}: AGENTS.md is empty`);
  }
  if (agentsLines.some((line) => line.trim() === "@CLAUDE.md")) {
    errors.push(`${label}: AGENTS.md must not import CLAUDE.md (circular import)`);
  }
  if (!claudeLines.some((line) => line.trim() === IMPORT_LINE)) {
    errors.push(`${label}: CLAUDE.md must contain a line "${IMPORT_LINE}"`);
  }
  if (claudeLines.length > MAX_ENTRY_LINES) {
    errors.push(`${label}: CLAUDE.md has ${claudeLines.length} lines (max ${MAX_ENTRY_LINES}); keep rules in AGENTS.md`);
  }

  const agentsHeadings = new Set(sectionHeadings(agentsLines));
  for (const heading of sectionHeadings(claudeLines)) {
    if (agentsHeadings.has(heading)) {
      errors.push(`${label}: CLAUDE.md duplicates AGENTS.md section "${heading}"`);
    }
  }
  return errors;
}

// The frontend pair is always checked. Workspace-level pairs are checked only when
// present, so a standalone frontend checkout (CI) still passes.
export function checkAll(frontendRoot) {
  const workspaceRoot = path.resolve(frontendRoot, "..");
  const targets = [{ directory: frontendRoot, label: "MultiMix-Frontend", required: true }];
  if (existsSync(path.join(workspaceRoot, "AGENTS.md"))) {
    targets.push({ directory: workspaceRoot, label: "workspace root", required: true });
    const backend = path.join(workspaceRoot, "MultiMix-Backend");
    if (existsSync(path.join(backend, "AGENTS.md"))) {
      targets.push({ directory: backend, label: "MultiMix-Backend", required: true });
    }
  }
  const errors = targets.flatMap((target) => checkEntryPair(target.directory, target.label));
  return { checked: targets.map((target) => target.label), errors };
}

const scriptPath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(scriptPath), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { checked, errors } = checkAll(frontendRoot);
  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    console.error("Agent entry check failed. Edit AGENTS.md only; keep CLAUDE.md as an importer.");
    process.exit(1);
  }
  console.log(`Agent entries are thin importers of AGENTS.md (${checked.join(", ")}).`);
}
