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

function makeSplitWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-split-docs-check-"));

  writeFile(
    root,
    "docs/README.md",
    `# MultiMix Docs

- Workspace rule: \`docs/authority/rule.md\`
- Workspace QA: \`docs/qa/conversation.md\`
- Active plan: \`docs/plans/active/plan.md\`
- Frontend guide: \`MultiMix-Frontend/docs/API.md\`
- Review standard: \`MultiMix-Backend/docs/qa/project-review-standard.md\`
- Security baseline: \`MultiMix-Backend/docs/qa/security-review-baseline.md\`
- Completion evidence: \`MultiMix-Backend/docs/qa/linear-issue-completion-evidence.md\`
`,
  );
  writeFile(root, "docs/authority/rule.md", `${HEADER}\n# Workspace rule\n`);
  writeFile(root, "docs/qa/conversation.md", `${HEADER}\n# Workspace QA\n`);
  writeFile(root, "docs/plans/active/README.md", "# Active plans\n");
  writeFile(root, "docs/plans/active/plan.md", `${HEADER}\n# Workspace plan\n`);
  writeFile(root, "docs/archive/plans/old.md", "# Old workspace plan\n");
  writeFile(root, "docs/specs/ui/prototypes/current/README.md", "# Current\n");
  writeFile(root, "docs/specs/ui/prototypes/current/index.html", "<a href=\"screens/start.html\">Start</a>");
  writeFile(root, "docs/specs/ui/prototypes/current/screens/start.html", "<main>Start</main>");

  writeFile(
    root,
    "MultiMix-Backend/docs/README.md",
    `# MultiMix Docs

- Review standard: \`MultiMix-Backend/docs/qa/project-review-standard.md\`
- Security baseline: \`MultiMix-Backend/docs/qa/security-review-baseline.md\`
- Completion evidence: \`MultiMix-Backend/docs/qa/linear-issue-completion-evidence.md\`
`,
  );
  writeFile(root, "MultiMix-Backend/docs/authority/rule.md", `${HEADER}\n# Rule\n`);
  writeFile(root, "MultiMix-Backend/docs/qa/conversation.md", `${HEADER}\n# QA\n`);
  writeFile(root, "MultiMix-Backend/docs/qa/project-review-standard.md", `${HEADER}\n# Review standard\n`);
  writeFile(root, "MultiMix-Backend/docs/qa/security-review-baseline.md", `${HEADER}\n# Security baseline\n`);
  writeFile(root, "MultiMix-Backend/docs/qa/linear-issue-completion-evidence.md", `${HEADER}\n# Completion evidence\n`);
  writeFile(root, "MultiMix-Backend/docs/plans/active/README.md", "# Active plans\n");
  writeFile(root, "MultiMix-Backend/docs/plans/active/plan.md", `${HEADER}\n# Plan\n`);
  writeFile(root, "MultiMix-Backend/docs/archive/plans/old.md", "# Old plan\n");
  writeFile(root, "MultiMix-Frontend/docs/README.md", "# Frontend Docs\n");
  writeFile(root, "MultiMix-Frontend/docs/API.md", `${HEADER}\n# Frontend API\n`);
  writeFile(root, "MultiMix-Frontend/docs/specs/ui/README.md", "# UI specs\n");
  writeFile(root, "MultiMix-Frontend/docs/specs/ui/agentic.md", `${HEADER}\n# UI\n`);
  writeFile(root, "MultiMix-Frontend/docs/specs/ui/prototypes/current/README.md", "# Current\n");
  writeFile(root, "MultiMix-Frontend/docs/specs/ui/prototypes/current/index.html", "<a href=\"screens/start.html\">Start</a>");
  writeFile(root, "MultiMix-Frontend/docs/specs/ui/prototypes/current/screens/start.html", "<main>Start</main>");

  return root;
}

test("passes a workspace documentation map with repository-specific docs", () => {
  const root = makeSplitWorkspace();

  const issues = checkDocs(root);

  assert.deepEqual(issues, []);
});

test("passes categorized workspace and repository documentation with status headers", () => {
  const root = makeSplitWorkspace();

  const issues = checkDocs(root);

  assert.deepEqual(issues, []);
});

test("flags loose files added directly under the workspace docs root", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "docs/new-rule.md", `${HEADER}\n# New rule\n`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "doc-root"), true);
});

test("flags current docs that are missing status metadata", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Backend/docs/authority/missing-header.md", "# Missing header\n");

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "doc-header"), true);
});

test("flags stale paths in current docs while allowing archive references", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Backend/docs/qa/conversation.md", `${HEADER}\nSee ../docs/retired-rule.md\n`);
  writeFile(root, "MultiMix-Backend/docs/archive/plans/history.md", "Historical reference: ../docs/retired-rule.md\n");

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "stale-reference"), true);
});

test("points noncanonical docs references to a canonical documentation destination", () => {
  const root = makeSplitWorkspace();
  writeFile(
    root,
    "MultiMix-Backend/docs/qa/conversation.md",
    `${HEADER}\nSee ../docs/authority/rule.md\n`,
  );

  const issues = checkDocs(root);
  const tier1Issue = issues.find(
    (issue) =>
      issue.code === "stale-reference" &&
        issue.message.includes("../docs/"),
  );

  assert.match(
    tier1Issue?.fix ?? "",
    /docs\/\.\.\.|MultiMix-Frontend\/docs|MultiMix-Backend\/docs/,
  );
});

test("flags missing Markdown references in the workspace documentation map", () => {
  const root = makeSplitWorkspace();
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

test("flags completed plans that remain in backend active plans", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Backend/docs/plans/active/plan.md", `> Status: completed
> Owner: docs
> Last verified: 2026-07-10

# Done
`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "active-plan"), true);
});

test("flags an all-checked plan that remains active", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Backend/docs/plans/active/plan.md", `> Status: active-plan
> Owner: docs
> Last verified: 2026-07-10

# Done

- [x] Implemented
- [x] Verified
`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "active-plan"), true);
});

test("flags an implementation-complete heading that remains active", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Backend/docs/plans/active/plan.md", `> Status: active-plan
> Owner: docs
> Last verified: 2026-07-28

# Plan

## 实施状态（2026-07-28 完成）

- Verification passed.
`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "active-plan"), true);
});

test("does not treat a partially completed execution heading as a completed plan", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Backend/docs/plans/active/plan.md", `> Status: active-plan
> Owner: docs
> Last verified: 2026-07-28

# Plan

## 执行状态（2026-07-28 完成 A 类删除）

- [x] Phase A
- [ ] Phase B
`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "active-plan"), false);
});

test("does not treat completion wording in explanatory prose as a completed plan", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Backend/docs/plans/active/plan.md", `> Status: active-plan
> Owner: docs
> Last verified: 2026-07-28

# Plan

- The checker recognizes the phrase “全部阶段完成” in a real completion statement.
- [ ] Implement the remaining work.
`);

  const issues = checkDocs(root);

  assert.equal(issues.some((issue) => issue.code === "active-plan"), false);
});

test("flags current frontend and backend docs without status metadata", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "MultiMix-Frontend/docs/API.md", "# Frontend API\n");
  writeFile(root, "MultiMix-Backend/docs/LEGACY_SYNC.md", "# Backend sync\n");

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
        issue.file === "MultiMix-Backend/docs/LEGACY_SYNC.md",
    ),
    true,
  );
});

test("requires review, security, and issue completion evidence in the workspace documentation map", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "docs/README.md", "# Docs\n");

  const issues = checkDocs(root);
  const missingReferences = issues
    .filter((issue) => issue.code === "missing-required-doc-reference")
    .map((issue) => issue.message);

  assert.equal(missingReferences.length, 3);
  assert.equal(
    missingReferences.some((message) => message.includes("MultiMix-Backend/docs/qa/project-review-standard.md")),
    true,
  );
  assert.equal(
    missingReferences.some((message) => message.includes("MultiMix-Backend/docs/qa/security-review-baseline.md")),
    true,
  );
  assert.equal(
    missingReferences.some((message) => message.includes("MultiMix-Backend/docs/qa/linear-issue-completion-evidence.md")),
    true,
  );
});

test("flags current workspace docs without status metadata", () => {
  const root = makeSplitWorkspace();
  writeFile(root, "docs/authority/missing-header.md", "# Missing workspace header\n");

  const issues = checkDocs(root);

  assert.equal(
    issues.some(
      (issue) =>
        issue.code === "doc-header" &&
        issue.file === "docs/authority/missing-header.md",
    ),
    true,
  );
});
