import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { repairNextGeneratedTypeReferences } from "../next-generated-types.mjs";

function makeFrontendRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "multimix-next-generated-types-"));
  fs.writeFileSync(
    path.join(root, "next-env.d.ts"),
    [
      '/// <reference types="next" />',
      '/// <reference path="./.next-video-pipeline-stale-run/types/routes.d.ts" />',
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    `${JSON.stringify({
      compilerOptions: { strict: true },
      include: [
        "**/*.ts",
        ".next/types/**/*.ts",
        ".next-build/types/**/*.ts",
        ".next-video-pipeline-stale-run/types/**/*.ts",
        ".next-agent-video-atomic-stale-run/types/**/*.ts",
        "next-env.d.ts",
      ],
    }, null, 2)}\n`,
  );
  return root;
}

test("repairs stale E2E Next type paths while retaining approved generated paths", () => {
  const frontendRoot = makeFrontendRoot();

  const result = repairNextGeneratedTypeReferences(frontendRoot);

  const nextEnv = fs.readFileSync(path.join(frontendRoot, "next-env.d.ts"), "utf8");
  const tsconfig = JSON.parse(fs.readFileSync(path.join(frontendRoot, "tsconfig.json"), "utf8"));
  assert.deepEqual(result, {
    nextEnvRepaired: true,
    removedTemporaryTypePaths: [
      ".next-video-pipeline-stale-run/types/**/*.ts",
      ".next-agent-video-atomic-stale-run/types/**/*.ts",
    ],
  });
  assert.match(nextEnv, /\.next-build\/types\/routes\.d\.ts/);
  assert.doesNotMatch(nextEnv, /\.next-video-pipeline-/);
  assert.deepEqual(tsconfig.include, [
    "**/*.ts",
    ".next/types/**/*.ts",
    ".next-build/types/**/*.ts",
    "next-env.d.ts",
  ]);
  assert.deepEqual(tsconfig.compilerOptions, { strict: true });
});

test("does not rewrite an already approved Next-generated configuration", () => {
  const frontendRoot = makeFrontendRoot();
  fs.writeFileSync(
    path.join(frontendRoot, "next-env.d.ts"),
    '/// <reference path="./.next/types/routes.d.ts" />\n',
  );
  fs.writeFileSync(
    path.join(frontendRoot, "tsconfig.json"),
    `${JSON.stringify({ include: [".next/types/**/*.ts", ".next-build/types/**/*.ts"] }, null, 2)}\n`,
  );

  const result = repairNextGeneratedTypeReferences(frontendRoot);

  assert.deepEqual(result, { nextEnvRepaired: false, removedTemporaryTypePaths: [] });
  assert.equal(
    fs.readFileSync(path.join(frontendRoot, "next-env.d.ts"), "utf8"),
    '/// <reference path="./.next/types/routes.d.ts" />\n',
  );
});

test("video pipeline runner repairs generated paths before taking its restore snapshot", () => {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const runner = fs.readFileSync(
    path.join(repositoryRoot, "scripts", "run-video-pipeline-production-e2e.mjs"),
    "utf8",
  );

  assert.match(runner, /import \{ repairNextGeneratedTypeReferences \} from "\.\/next-generated-types\.mjs"/);
  assert.match(runner, /repairNextGeneratedTypeReferences\(frontendRoot\);\r?\nconst workspaceSnapshots = snapshotFiles/);
  assert.match(runner, /fs\.rmSync\(path\.join\(frontendRoot, `\.next-video-pipeline-\$\{runId\}`\)/);
});
