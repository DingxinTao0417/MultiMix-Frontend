import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ESLint } from "eslint";
import picomatch from "picomatch";
import ts from "typescript";
import { loadConfigFromFile } from "vite";
import { configDefaults } from "vitest/config";

const root = path.resolve(import.meta.dirname, "../..");
const livePaths = ["app/assets/components/example.tsx", "app/assets/__tests__/example.test.tsx"];
const artifactPaths = [".tmp/saved-source/example.test.tsx", "test-results/evidence/example.test.tsx"];

test("Vitest discovers current tests but never historical source copies", async () => {
  const loaded = await loadConfigFromFile(
    { command: "serve", mode: "test" }, path.join(root, "vitest.config.mts"), root,
  );
  const options = loaded.config.test;
  const included = picomatch(options.include ?? configDefaults.include);
  const excluded = picomatch(options.exclude ?? configDefaults.exclude, { dot: true });
  for (const candidate of [livePaths[1], "editor-engine/vendor/buildProject.test.ts"]) {
    assert.ok(included(candidate) && !excluded(candidate), `${candidate} must remain a live test`);
  }
  for (const candidate of artifactPaths) assert.ok(excluded(candidate), `${candidate} is evidence, not a live test`);
});

test("ESLint checks live components and tests but ignores source backups", async () => {
  const eslint = new ESLint({ cwd: root });
  for (const candidate of livePaths) assert.equal(await eslint.isPathIgnored(path.join(root, candidate)), false, candidate);
  for (const candidate of artifactPaths) assert.equal(await eslint.isPathIgnored(path.join(root, candidate)), true, candidate);
});

test("TypeScript checks live source and tests without compiling archived evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-source-discovery-"));
  try {
    for (const candidate of [...livePaths, ...artifactPaths]) {
      const target = path.join(directory, candidate);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "export {};\n");
    }
    const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, directory);
    assert.deepEqual(parsed.errors, []);
    const files = parsed.fileNames.map((file) => path.relative(directory, file).replaceAll("\\", "/"));
    for (const candidate of livePaths) assert.ok(files.includes(candidate), `${candidate} must be typechecked`);
    for (const candidate of artifactPaths) assert.ok(!files.includes(candidate), `${candidate} must not be compiled`);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
