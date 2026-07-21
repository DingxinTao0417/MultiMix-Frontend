import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const frontendRoot = path.resolve(import.meta.dirname, "..", "..");
const vendorRoot = path.join(frontendRoot, "editor-engine", "vendor");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name) ? [target] : [];
  });
}

test("editor vendor contains no hard-coded local debug ingestion", () => {
  const offenders = sourceFiles(vendorRoot).filter((filePath) => (
    fs.readFileSync(filePath, "utf8").includes("127.0.0.1:7245/ingest")
  ));
  assert.deepEqual(
    offenders.map((filePath) => path.relative(frontendRoot, filePath)),
    [],
  );
});
