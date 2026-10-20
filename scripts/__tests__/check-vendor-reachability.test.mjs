import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const frontendRoot = path.resolve(import.meta.dirname, "../..");
const script = fs.readFileSync(path.join(frontendRoot, "scripts/check-vendor-reachability.mjs"), "utf8");

function inspectFixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-vendor-graph-"));
  try {
    fs.mkdirSync(path.join(root, "scripts"));
    fs.writeFileSync(path.join(root, "scripts/check-vendor-reachability.mjs"), script);
    fs.symlinkSync(path.join(frontendRoot, "node_modules"), path.join(root, "node_modules"), "junction");
    for (const [name, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      fs.writeFileSync(path.join(root, name), source);
    }
    return JSON.parse(execFileSync(process.execPath, ["scripts/check-vendor-reachability.mjs", "--json"], {
      cwd: root,
      encoding: "utf8",
    }));
  } finally {
    // Remove the fixture link first; never clean the real dependency directory.
    fs.unlinkSync(path.join(root, "node_modules"));
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("comments and documentation strings do not keep unused vendor code alive", () => {
  const report = inspectFixture({
    "app.ts": `// import { ghost } from "./editor-engine/vendor/ghost";
/* export * from "./editor-engine/vendor/ghost"; */
const example = 'import { ghost } from "./editor-engine/vendor/ghost"';`,
    "editor-engine/vendor/ghost.ts": "export const ghost = true;",
  });
  assert.deepEqual(report.unreachablePaths, ["editor-engine/vendor/ghost.ts"]);
});

test("real static, dynamic, worker, CommonJS and type imports remain reachable", () => {
  const report = inspectFixture({
    "app.ts": `import type { Root } from "./editor-engine/vendor/root";
import("./editor-engine/vendor/dynamic");
require("./editor-engine/vendor/common");
new URL("./editor-engine/vendor/worker.ts", import.meta.url);`,
    "editor-engine/vendor/root.ts": 'export type { Root } from "./leaf";',
    "editor-engine/vendor/leaf.ts": "export type Root = string;",
    "editor-engine/vendor/dynamic.ts": "export {};",
    "editor-engine/vendor/common.js": "module.exports = {};",
    "editor-engine/vendor/worker.ts": "export {};",
  });
  assert.equal(report.reachableCount, 5);
  assert.deepEqual(report.unreachablePaths, []);
});

test("CSS imports and url imports retain their resources without reviving comments", () => {
  const report = inspectFixture({
    "app.css": `@import "./editor-engine/vendor/live.css";
@import url(./editor-engine/vendor/url.css);
/* @import "./editor-engine/vendor/ghost.css"; */`,
    "editor-engine/vendor/live.css": "body { color: black; }",
    "editor-engine/vendor/url.css": "body { color: white; }",
    "editor-engine/vendor/ghost.css": "body { color: red; }",
  });
  assert.deepEqual(report.unreachablePaths, ["editor-engine/vendor/ghost.css"]);
});

test("other task worktrees cannot keep current vendor code alive", () => {
  const report = inspectFixture({
    ".worktrees/other-task/app.ts": 'import "../../editor-engine/vendor/ghost";',
    "editor-engine/vendor/ghost.ts": "export {};",
  });
  assert.deepEqual(report.externalRoots, []);
  assert.deepEqual(report.unreachablePaths, ["editor-engine/vendor/ghost.ts"]);
});

test("vendored editor contains no source outside the declared runtime and test graph", () => {
  const result = spawnSync(
    process.execPath,
    ["scripts/check-vendor-reachability.mjs", "--assert-clean", "--json"],
    { cwd: frontendRoot, encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.unreachableCount, 0);
  assert.ok(report.reachableCount > 0);
  assert.ok(report.externalRoots.length > 0);
});


test("product graph traverses real Next entries and distinguishes test-only consumers", () => {
  const report = inspectFixture({
    "app/layout.tsx": 'import "../editor-engine/vendor/live.css";',
    "app/editor/page.tsx": 'import "@/lib/bridge";',
    "lib/bridge.ts": 'import("../editor-engine/vendor/live");',
    "lib/orphan.ts": 'import "../editor-engine/vendor/unmounted";',
    "lib/bridge.test.ts": 'import "../editor-engine/vendor/test-only";',
    "editor-engine/vendor/live.ts": 'export type { Shape } from "./types";',
    "editor-engine/vendor/types.ts": 'export type Shape = string;',
    "editor-engine/vendor/live.css": 'body { color: white; }',
    "editor-engine/vendor/test-only.ts": 'export {};',
    "editor-engine/vendor/unmounted.ts": 'export {};',
  });
  assert.deepEqual(report.product.reachablePaths, ["editor-engine/vendor/live.css", "editor-engine/vendor/live.ts", "editor-engine/vendor/types.ts"]);
  assert.deepEqual(report.product.testOnlyPaths, ["editor-engine/vendor/test-only.ts"]);
  assert.deepEqual(report.product.retainedOnlyPaths, ["editor-engine/vendor/unmounted.ts"]);
  assert.equal(report.unreachableCount, 0);
});
