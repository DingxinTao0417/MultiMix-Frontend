import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const testDirectory = import.meta.dirname;
const testFiles = fs.readdirSync(testDirectory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join(testDirectory, entry.name))
  .sort();

if (testFiles.length === 0) throw new Error(`No script tests found in ${testDirectory}`);

const result = spawnSync(process.execPath, ["--test", ...testFiles], {
  cwd: path.resolve(testDirectory, "../.."),
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
