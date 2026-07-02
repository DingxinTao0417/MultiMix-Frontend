#!/usr/bin/env node
// Keep AGENTS.md in sync with CLAUDE.md.
// CLAUDE.md is the source of truth; AGENTS.md is generated with only its title line changed.
//   node scripts/sync-agents-md.mjs         -> regenerate AGENTS.md from CLAUDE.md
//   node scripts/sync-agents-md.mjs --check  -> exit 1 if AGENTS.md is out of sync (no write)

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const claudePath = join(root, "CLAUDE.md");
const agentsPath = join(root, "AGENTS.md");

const normalize = (value) => value.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");

const claude = normalize(readFileSync(claudePath, "utf8"));
const lines = claude.split("\n");
if (lines[0] !== "# CLAUDE.md") {
  console.error("CLAUDE.md must start with '# CLAUDE.md'; aborting.");
  process.exit(1);
}
const expected = ["# AGENTS.md", ...lines.slice(1)].join("\n");

const check = process.argv.includes("--check");
let current = "";
try {
  current = normalize(readFileSync(agentsPath, "utf8"));
} catch {
  /* missing file: treated as out of sync below */
}

if (check) {
  if (current !== expected) {
    console.error("AGENTS.md is out of sync with CLAUDE.md. Run: npm run sync:agents");
    process.exit(1);
  }
  console.log("AGENTS.md is in sync with CLAUDE.md.");
} else {
  writeFileSync(agentsPath, expected);
  console.log("AGENTS.md regenerated from CLAUDE.md.");
}
