import fs from "node:fs";
import path from "node:path";

const DEFAULT_NEXT_TYPES_REFERENCE = '/// <reference path="./.next-build/types/routes.d.ts" />';
const NEXT_TYPES_REFERENCE = /^\/\/\/ <reference path="\.\/\.next(?:-[^/]+)?\/types\/routes\.d\.ts" \/>\r?$/m;
const APPROVED_NEXT_TYPES_REFERENCE = /^\/\/\/ <reference path="\.\/\.next(?:-build)?\/types\/routes\.d\.ts" \/>\r?$/m;
const TEMPORARY_NEXT_TYPES_PATH = /^\.next-(?!build(?:\/|$)).+\/types\/\*\*\/\*\.ts$/;

export function repairNextGeneratedTypeReferences(frontendRoot) {
  const nextEnvPath = path.join(frontendRoot, "next-env.d.ts");
  const tsconfigPath = path.join(frontendRoot, "tsconfig.json");
  const nextEnv = fs.readFileSync(nextEnvPath, "utf8");
  const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, "utf8"));
  const nextEnvRepaired = NEXT_TYPES_REFERENCE.test(nextEnv)
    && !APPROVED_NEXT_TYPES_REFERENCE.test(nextEnv);
  const repairedNextEnv = nextEnvRepaired
    ? nextEnv.replace(NEXT_TYPES_REFERENCE, DEFAULT_NEXT_TYPES_REFERENCE)
    : nextEnv;
  const include = Array.isArray(tsconfig.include) ? tsconfig.include : [];
  const removedTemporaryTypePaths = include.filter((entry) => TEMPORARY_NEXT_TYPES_PATH.test(entry));

  if (nextEnvRepaired) fs.writeFileSync(nextEnvPath, repairedNextEnv, "utf8");
  if (removedTemporaryTypePaths.length > 0) {
    fs.writeFileSync(
      tsconfigPath,
      `${JSON.stringify({
        ...tsconfig,
        include: include.filter((entry) => !TEMPORARY_NEXT_TYPES_PATH.test(entry)),
      }, null, 2)}\n`,
      "utf8",
    );
  }

  return { nextEnvRepaired, removedTemporaryTypePaths };
}
