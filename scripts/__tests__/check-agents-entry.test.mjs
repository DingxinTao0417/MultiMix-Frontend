import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkAll, checkEntryPair, MAX_ENTRY_LINES } from "../check-agents-entry.mjs";

function makeDir(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "agents-entry-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function writePair(directory, { agents, claude }) {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "AGENTS.md"), agents);
  writeFileSync(path.join(directory, "CLAUDE.md"), claude);
}

const VALID_AGENTS = "# AGENTS.md\n\n## 规则一\n\n- 内容\n";
const VALID_CLAUDE = "# Claude Entry\n\n@AGENTS.md\n\n## Claude 专属提醒\n\n- 补充\n";

test("accepts a thin importer with its own distinct sections", (t) => {
  const directory = makeDir(t);
  writePair(directory, { agents: VALID_AGENTS, claude: VALID_CLAUDE });
  assert.deepEqual(checkEntryPair(directory), []);
});

test("rejects CLAUDE.md without the import line", (t) => {
  const directory = makeDir(t);
  writePair(directory, { agents: VALID_AGENTS, claude: "# Claude Entry\n\n- 只有文字\n" });
  const errors = checkEntryPair(directory);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /@AGENTS\.md/);
});

test("rejects CLAUDE.md that duplicates an AGENTS.md section", (t) => {
  const directory = makeDir(t);
  writePair(directory, { agents: VALID_AGENTS, claude: `${VALID_CLAUDE}\n## 规则一\n\n- 复制\n` });
  const errors = checkEntryPair(directory);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /duplicates AGENTS\.md section "## 规则一"/);
});

test("rejects an oversized CLAUDE.md", (t) => {
  const directory = makeDir(t);
  const filler = Array.from({ length: MAX_ENTRY_LINES }, (_, index) => `- 行 ${index}`).join("\n");
  writePair(directory, { agents: VALID_AGENTS, claude: `${VALID_CLAUDE}\n${filler}\n` });
  assert.match(checkEntryPair(directory).join("\n"), /max 60/);
});

test("rejects a circular import and an empty AGENTS.md", (t) => {
  const circular = makeDir(t);
  writePair(circular, { agents: "# AGENTS.md\n\n@CLAUDE.md\n", claude: VALID_CLAUDE });
  assert.match(checkEntryPair(circular).join("\n"), /circular import/);

  const empty = makeDir(t);
  writePair(empty, { agents: "\n\n", claude: VALID_CLAUDE });
  assert.match(checkEntryPair(empty).join("\n"), /AGENTS\.md is empty/);
});

test("reports a missing file instead of throwing", (t) => {
  const directory = makeDir(t);
  writeFileSync(path.join(directory, "CLAUDE.md"), VALID_CLAUDE);
  assert.deepEqual(checkEntryPair(directory, "demo"), ["demo: AGENTS.md is missing"]);
});

test("checkAll covers workspace and backend when present", (t) => {
  const workspace = makeDir(t);
  const frontend = path.join(workspace, "MultiMix-Frontend");
  writePair(workspace, { agents: VALID_AGENTS, claude: VALID_CLAUDE });
  writePair(frontend, { agents: VALID_AGENTS, claude: VALID_CLAUDE });
  writePair(path.join(workspace, "MultiMix-Backend"), { agents: VALID_AGENTS, claude: VALID_CLAUDE });
  const result = checkAll(frontend);
  assert.deepEqual(result.checked, ["MultiMix-Frontend", "workspace root", "MultiMix-Backend"]);
  assert.deepEqual(result.errors, []);
});

test("checkAll skips workspace pairs for a standalone frontend checkout", (t) => {
  const parent = makeDir(t);
  const frontend = path.join(parent, "MultiMix-Frontend");
  writePair(frontend, { agents: VALID_AGENTS, claude: VALID_CLAUDE });
  const result = checkAll(frontend);
  assert.deepEqual(result.checked, ["MultiMix-Frontend"]);
  assert.deepEqual(result.errors, []);
});

test("checkAll surfaces drift in the workspace root", (t) => {
  const workspace = makeDir(t);
  const frontend = path.join(workspace, "MultiMix-Frontend");
  writePair(workspace, { agents: VALID_AGENTS, claude: "# Claude Entry\n\n- 无导入\n" });
  writePair(frontend, { agents: VALID_AGENTS, claude: VALID_CLAUDE });
  const result = checkAll(frontend);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^workspace root:/);
});
