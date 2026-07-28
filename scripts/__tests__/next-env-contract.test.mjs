import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("next-env uses the stable production type directory", () => {
  const source = fs.readFileSync(path.join(repositoryRoot, "next-env.d.ts"), "utf8");

  assert.match(source, /reference path="\.\/\.next-build\/types\/routes\.d\.ts"/);
  assert.doesNotMatch(source, /\.next-[a-z-]+-\d{8}/);
});
