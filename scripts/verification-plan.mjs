import path from "node:path";

export const DISPLAY_TESTS = [
  "app/assets/__tests__/display-area-readiness.test.tsx",
  "app/assets/__tests__/display-area-cases.test.tsx",
];

export function normalizeFile(file) {
  const value = String(file).replaceAll("\\", "/").replace(/^\.\//, "");
  if (!value || value === "." || value.startsWith("-") || path.posix.isAbsolute(value)
    || /^[A-Za-z]:/.test(value) || value.includes("\0") || value.split("/").includes("..")) {
    throw new Error("Expected a repository-relative file path");
  }
  return value;
}

export function createPlan({ files, missing = [], full = false, display = false }) {
  const changed = [...new Set(files.map(normalizeFile))].sort();
  if (!full && !changed.length) throw new Error("No changes selected; use --full for a full check");
  const protectedFiles = changed.some((file) =>
    file === "app/globals.css" || /video-preview-player|product-preview|product-workspace/.test(file)
    || /video-preview-contract|product-stage-style/.test(file)
    || file === "e2e/display-area.spec.ts" || /^e2e\/.*\.png$/.test(file)
    || file === "scripts/run-display-coverage.mjs" || DISPLAY_TESTS.includes(file));
  const withDisplay = display || protectedFiles;
  const nodes = new Map();
  const add = (id, tool, args) => nodes.set(id, { id, tool, args });
  const docs = changed.some((file) => file.endsWith(".md") || file.startsWith("docs/")
    || file === "scripts/check-docs.mjs");
  const scripts = changed.filter((file) => file.startsWith("scripts/"));
  const sourceFiles = changed.filter((file) => /\.[cm]?[jt]sx?$/.test(file)
    && !file.startsWith("scripts/") && !file.startsWith("e2e/"));
  const known = (file) => file.endsWith(".md") || file.startsWith("docs/")
    || file.startsWith("scripts/")
    || /^app\/assets\/(components|__tests__)\/.*\.[jt]sx?$/.test(file);
  const broad = full || missing.length > 0 || changed.some((file) => !known(file));
  const reasons = [];
  if (full) reasons.push("Explicit full verification");
  if (missing.length) reasons.push("Deleted or renamed inputs require broad verification");
  if (!full && changed.some((file) => !known(file))) reasons.push("Shared or unknown impact: broaden checks");
  if (docs || broad) add("agent-entries", "node", ["scripts/check-agents-entry.mjs"]);
  if (docs || broad) add("docs", "node", ["scripts/check-docs.mjs"]);
  if (docs || broad || withDisplay) add("preview-contract", "node", ["scripts/check-video-preview-contract.mjs"]);
  if (broad || sourceFiles.length) {
    add("typecheck", "tsc", ["--noEmit"]);
    add("lint", "eslint", broad ? ["."] : sourceFiles);
  }
  const exclusions = withDisplay ? DISPLAY_TESTS.flatMap((file) => ["--exclude", file]) : [];
  if (broad) {
    add("vitest", "vitest", ["run", ...exclusions]);
    add("demo-units", "vitest", ["run", "--config", "vitest.demo-e2e.config.ts"]);
  } else {
    const related = sourceFiles.filter((file) => !(withDisplay && DISPLAY_TESTS.includes(file)));
    if (related.length) add("vitest", "vitest",
      [...(related.every((file) => /\.test\.[jt]sx?$/.test(file)) ? ["run"] : ["related", "--run"]),
        ...related, ...exclusions]);
  }
  if (broad || scripts.length) {
    const knownScriptTests = {
      "scripts/check-docs.mjs": ["scripts/__tests__/check-docs.test.mjs"],
    };
    const selected = scripts.map((file) =>
      /^scripts\/__tests__\/[^/]+\.test\.mjs$/.test(file) ? [file] : knownScriptTests[file]);
    if (!broad && selected.every(Boolean)) {
      add("script-tests", "node", ["--test", ...new Set(selected.flat())]);
    } else add("script-tests", "node", ["scripts/__tests__/run-all-script-tests.mjs"]);
  }
  if (withDisplay) {
    add("stage-style", "node", ["scripts/check-product-stage-style.mjs"]);
    add("display", "node", ["scripts/run-display-coverage.mjs"]);
  }
  if (broad) add("build", "next", ["build"]);
  if (!nodes.size) throw new Error("No applicable checks; expand the verification scope");
  const level = broad || withDisplay ? "L2" : "L1";
  return {
    version: 1, level, evidenceClaim: level === "L2" ? "related-regression" : "focused",
    changed, reasons, checks: [...nodes.values()], full, withDisplay,
    limitation: "Offline checks do not establish real-model or production acceptance",
  };
}
