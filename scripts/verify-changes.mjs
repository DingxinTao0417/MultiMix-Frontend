import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createPlan, normalizeFile } from "./verification-plan.mjs";

export function collectChanges(root, base = "main", extra = []) {
  if (!base || base.startsWith("-")) throw new Error("Expected a Git base reference");
  const git = (args) => execFileSync("git",
    ["-c", "safe.directory=" + fs.realpathSync(root).replaceAll("\\", "/"), ...args],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).split("\0").filter(Boolean);
  return [...new Set([
    ...git(["diff", "--name-only", "-z", "--no-renames", base + "...HEAD"]),
    ...git(["diff", "HEAD", "--name-only", "-z", "--no-renames"]),
    ...git(["ls-files", "--others", "--exclude-standard", "-z"]),
    ...extra.map(normalizeFile),
  ].map(normalizeFile))].sort();
}

export function resolveCommand(check, root) {
  if (check.tool === "node") return check.args;
  const require = createRequire(path.join(root, "package.json"));
  const targets = {
    vitest: ["vitest/package.json", "vitest.mjs"],
    tsc: ["typescript/package.json", "bin/tsc"],
    eslint: ["eslint/package.json", "bin/eslint.js"],
    next: ["next/package.json", "dist/bin/next"],
  };
  const target = targets[check.tool];
  if (!target) throw new Error("Unknown verification tool: " + check.tool);
  return [path.join(path.dirname(require.resolve(target[0])), target[1]), ...check.args];
}

export function runPlan(plan, { root, run = spawnSync } = {}) {
  if (!plan.checks.length) throw new Error("No checks to execute");
  const report = { ...plan, startedAt: new Date().toISOString(), reusable: false, results: [] };
  for (const check of plan.checks) {
    const started = performance.now();
    let result;
    let args = [];
    try {
      args = resolveCommand(check, root);
      result = run(process.execPath, args, { cwd: root, env: process.env, stdio: "inherit", shell: false });
    } catch (error) { result = { error }; }
    const exitCode = result.error ? 1 : (result.status ?? 1);
    report.results.push({ id: check.id, args, exitCode,
      durationMs: Math.round(performance.now() - started), status: exitCode ? "failed" : "passed",
      ...(result.signal ? { signal: result.signal } : {}) });
    if (exitCode) return { ...report, exitCode, status: "failed" };
  }
  return { ...report, status: "passed", exitCode: 0 };
}

export function main(args = process.argv.slice(2)) {
  let full = false;
  let display = false;
  let planOnly = false;
  let base = "main";
  const extra = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--full") full = true;
    else if (args[i] === "--display") display = true;
    else if (args[i] === "--plan") planOnly = true;
    else if (["--base", "--file"].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith("-")) {
      const flag = args[i++];
      if (flag === "--base") base = args[i];
      else extra.push(normalizeFile(args[i]));
    } else throw new Error("Usage: npm run verify -- [--plan] [--full] [--display] [--base ref] [--file path]...");
  }
  const root = path.resolve(import.meta.dirname, "..");
  const files = collectChanges(root, base, extra);
  const missing = files.filter((file) => !fs.existsSync(path.join(root, file)));
  const plan = createPlan({ files, missing, full, display });
  console.log(JSON.stringify(plan, null, 2));
  if (planOnly) return 0;
  const report = runPlan(plan, { root });
  const output = path.join(root, "test-results", "verification", crypto.randomUUID() + ".json");
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log("Verification record: " + output);
  return report.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
