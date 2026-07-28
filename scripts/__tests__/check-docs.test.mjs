import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { checkDocs } from "../check-docs.mjs";

const HEADER = `> Status: current
> Owner: docs
> Last verified: 2026-07-10
`;

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-docs-check-"));

  writeFile(root, "docs/README.md", "# Docs\n");
  writeFile(root, "docs/authority/rule.md", `${HEADER}\n# Rule\n`);
  writeFile(root, "docs/qa/conversation.md", `${HEADER}\n# QA\n`);
  writeFile(root, "docs/plans/active/README.md", "# Active plans\n");
  writeFile(root, "docs/plans/active/plan.md", `${HEADER}\n# Plan\n`);
  writeFile(root, "docs/specs/ui/README.md", "# UI specs\n");
  writeFile(root, "docs/specs/ui/agentic.md", `${HEADER}\n# UI\n`);
  writeFile(root, "docs/specs/ui/prototypes/current/README.md", "# Current\n");
  writeFile(root, "docs/specs/ui/prototypes/current/index.html", "<a href=\"screens/start.html\">Start</a>");
  writeFile(root, "docs/specs/ui/prototypes/current/screens/start.html", "<main>Start</main>");
  writeFile(root, "docs/archive/plans/old.md", "# Old plan\n");

  return root;
}

test("passes a categorized docs tree with status headers", () => {
  const root = makeWorkspace();

  const issues = checkDocs(root);

  assert.deepEqual(issues, []);
});

test("flags loose files added directly under docs root", () => {
  const root = makeWorkspace();
  writeFile(root, "docs/new-rule.md", `${HEADER}\n# New rule\n`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "doc-root"), true);
});

test("flags current docs that are missing status metadata", () => {
  const root = makeWorkspace();
  writeFile(root, "docs/authority/missing-header.md", "# Missing header\n");

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "doc-header"), true);
});

test("flags stale paths in current docs while allowing archive references", () => {
  const root = makeWorkspace();
  writeFile(root, "docs/qa/conversation.md", `${HEADER}\nSee docs/ui-redesign-demos/index.html\n`);
  writeFile(root, "docs/archive/plans/history.md", "Historical reference: docs/ui-redesign-demos/index.html\n");

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "stale-reference"), true);
});

test("flags missing Markdown references in the workspace documentation map", () => {
  const root = makeWorkspace();
  writeFile(
    root,
    "docs/README.md",
    "# Docs\n\n- Missing plan: `docs/plans/active/missing-plan.md`\n",
  );

  const issues = checkDocs(root);

  assert.equal(
    issues.some(
      (issue) =>
        issue.code === "missing-doc-reference" &&
        issue.file === "docs/README.md",
    ),
    true,
  );
});

test("flags completed plans that remain in docs/plans/active", () => {
  const root = makeWorkspace();
  writeFile(root, "docs/plans/active/plan.md", `> Status: completed
> Owner: docs
> Last verified: 2026-07-10

# Done
`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "active-plan"), true);
});

test("flags an all-checked plan that remains active", () => {
  const root = makeWorkspace();
  writeFile(root, "docs/plans/active/plan.md", `> Status: active-plan
> Owner: docs
> Last verified: 2026-07-10

# Done

- [x] Implemented
- [x] Verified
`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "active-plan"), true);
});

test("flags current frontend and backend docs without status metadata", () => {
  const root = makeWorkspace();
  writeFile(root, "MultiMix-Frontend/docs/API.md", "# Frontend API\n");
  writeFile(root, "MultiMix-Backend/docs/CHANGEIN_SYNC.md", "# Backend sync\n");

  const issues = checkDocs(root);

  assert.equal(
    issues.some(
      (issue) =>
        issue.code === "doc-header" &&
        issue.file === "MultiMix-Frontend/docs/API.md",
    ),
    true,
  );
  assert.equal(
    issues.some(
      (issue) =>
        issue.code === "doc-header" &&
        issue.file === "MultiMix-Backend/docs/CHANGEIN_SYNC.md",
    ),
    true,
  );
});
