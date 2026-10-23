import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { createPlan, normalizeFile } from "../verification-plan.mjs";
import { collectChanges, runPlan } from "../verify-changes.mjs";

const ids = (plan) => plan.checks.map((check) => check.id);
test("empty and escaping scopes cannot pass without checks", () => {
  assert.throws(() => createPlan({ files: [] }), /No changes/);
  for (const file of ["../x", "/x", "C:\\x", "--help", "x/../y", "."]) {
    assert.throws(() => normalizeFile(file), /relative/);
  }
});
test("documentation needs its contracts without a frontend build", () => {
  const plan = createPlan({ files: ["docs/specs/example.md"] });
  assert.deepEqual(ids(plan), ["agent-entries", "docs", "preview-contract"]);
  assert.equal(plan.evidenceClaim, "focused");
});
test("local source uses related tests and static checks", () => {
  const plan = createPlan({ files: ["app/assets/components/example.tsx"] });
  assert.deepEqual(ids(plan), ["typecheck", "lint", "vitest"]);
  assert.deepEqual(plan.checks.at(-1).args.slice(0, 2), ["related", "--run"]);
});
test("changed test modules are selected directly", () => {
  const plan = createPlan({ files: ["app/assets/__tests__/example.test.tsx"] });
  assert.equal(plan.checks.at(-1).args[0], "run");
});
test("unknown shared and deleted inputs expand to the offline release checks", () => {
  for (const options of [
    { files: ["lib/api.ts"] },
    { files: ["package-lock.json"] },
    { files: ["app/assets/components/removed.tsx"], missing: ["app/assets/components/removed.tsx"] },
  ]) {
    const plan = createPlan(options);
    assert.equal(plan.level, "L2");
    for (const id of ["typecheck", "lint", "vitest", "demo-units", "script-tests", "build"]) {
      assert.ok(ids(plan).includes(id));
    }
  }
});
test("duplicate inputs and dependencies execute only once", () => {
  const plan = createPlan({ files: ["AGENTS.md", "AGENTS.md", "package.json"] });
  assert.equal(new Set(ids(plan)).size, plan.checks.length);
  assert.equal(plan.changed.length, 2);
});
test("script test edits can run directly; helpers require the script suite", () => {
  assert.equal(createPlan({ files: ["scripts/__tests__/a.test.mjs"] }).checks[0].args[0], "--test");
  assert.deepEqual(ids(createPlan({ files: ["scripts/helper.mjs"] })), ["script-tests"]);
});
test("protected preview changes keep all three gates and avoid duplicate components", () => {
  const plan = createPlan({ files: ["app/globals.css"] });
  for (const id of ["preview-contract", "stage-style", "display"]) assert.ok(ids(plan).includes(id));
  const units = plan.checks.find((check) => check.id === "vitest");
  assert.ok(units.args.includes("app/assets/__tests__/display-area-cases.test.tsx"));
  assert.equal(units.args.filter((arg) => arg === "--exclude").length, 2);
  assert.deepEqual(plan.checks.find((check) => check.id === "display").args, ["scripts/run-display-coverage.mjs"]);
});
test("display-only component changes are covered by the full isolated display entry", () => {
  const plan = createPlan({ files: ["app/assets/__tests__/display-area-cases.test.tsx"] });
  assert.ok(!ids(plan).includes("vitest"));
  assert.ok(ids(plan).includes("display"));
});
test("full verification without a diff remains available", () => {
  assert.ok(ids(createPlan({ files: [], full: true })).includes("build"));
});
test("failed, signalled, and spawn-error checks stop dependent checks", () => {
  for (const result of [{ status: 7 }, { status: null, signal: "SIGTERM" }, { error: new Error("unavailable") }]) {
    let calls = 0;
    const report = runPlan({ checks: [{ id: "a", tool: "node", args: ["a"] }, { id: "b", tool: "node", args: ["b"] }] },
      { root: process.cwd(), run: () => { calls++; return result; } });
    assert.equal(calls, 1);
    assert.equal(report.status, "failed");
    assert.notEqual(report.exitCode, 0);
    assert.equal(report.reusable, false);
  }
});
test("every planned check must actually run before success", () => {
  assert.throws(() => runPlan({ checks: [] }, { root: process.cwd() }), /checks/);
  const report = runPlan({ checks: [{ id: "a", tool: "node", args: ["a"] }] },
    { root: process.cwd(), run: () => ({ status: 0 }) });
  assert.equal(report.status, "passed");
  assert.equal(report.results.length, 1);
});
test("change collection unions commits, staged, unstaged, untracked and renamed paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-verification-"));
  const git = (...args) => execFileSync("git", ["-c", "safe.directory=" + root.replaceAll("\\", "/"),
    "-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd: root, stdio: "pipe" });
  try {
    git("init", "-q", "-b", "main");
    for (const file of ["old.ts", "staged.ts", "unstaged.ts"]) fs.writeFileSync(path.join(root, file), "before");
    git("add", ".");
    git("commit", "-qm", "baseline");
    git("checkout", "-qb", "task");
    fs.writeFileSync(path.join(root, "committed.ts"), "new");
    git("add", ".");
    git("commit", "-qm", "task");
    git("mv", "old.ts", "new name.ts");
    fs.writeFileSync(path.join(root, "staged.ts"), "after");
    git("add", "staged.ts");
    fs.writeFileSync(path.join(root, "unstaged.ts"), "after");
    fs.writeFileSync(path.join(root, "untracked.ts"), "new");
    assert.deepEqual(collectChanges(root, "main", ["extra.ts"]).sort(),
      ["committed.ts", "extra.ts", "new name.ts", "old.ts", "staged.ts", "unstaged.ts", "untracked.ts"]);
    assert.throws(() => collectChanges(root, "missing-ref"), /./);
  } finally {
    const absolute = path.resolve(root);
    assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});


test("the document checker runs its own regressions and contracts without unrelated browser scripts", () => {
  const plan = createPlan({ files: ["scripts/check-docs.mjs", "scripts/__tests__/check-docs.test.mjs"] });
  assert.deepEqual(ids(plan), ["agent-entries", "docs", "preview-contract", "script-tests"]);
  assert.deepEqual(plan.checks.at(-1).args, ["--test", "scripts/__tests__/check-docs.test.mjs"]);
});
