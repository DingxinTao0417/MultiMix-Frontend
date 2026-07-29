import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("next-env uses an approved Next-generated type directory", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "next-env.d.ts"), "utf8");
  const tsconfig = JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, "tsconfig.json"), "utf8"),
  );
  const nextConfig = fs.readFileSync(path.join(repositoryRoot, "next.config.mjs"), "utf8");

  assert.match(source, /reference path="\.\/\.next(?:-build)?\/types\/routes\.d\.ts"/);
  assert.doesNotMatch(source, /\.next-[a-z-]+-\d{8}/);
  assert.ok(tsconfig.include.includes(".next/types/**/*.ts"));
  assert.ok(tsconfig.include.includes(".next-build/types/**/*.ts"));
  assert.match(nextConfig, /devDistDir.*\.next/s);
  assert.match(nextConfig, /:\s*"\.next-build"/);
});
