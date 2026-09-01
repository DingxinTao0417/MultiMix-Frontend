import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.join(workspaceRoot, "editor-engine", "vendor");
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".glsl"];
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".next-build",
  "coverage",
  "node_modules",
]);

function normalize(filePath) {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function walk(directory, { skipVendor = false } = {}) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (skipVendor && normalize(absolute) === normalize(vendorRoot)) continue;
    if (entry.isDirectory()) files.push(...walk(absolute, { skipVendor }));
    else files.push(absolute);
  }
  return files;
}

function importSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\sfrom\s*)?["']([^"']+)["']/g,
    /(?:import|require)\(\s*["']([^"']+)["']\s*\)/g,
    /new\s+URL\(\s*["']([^"']+)["']\s*,\s*import\.meta\.url\s*,?\s*\)/g,
    /@import\s+["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function resolveBase(importer, specifier) {
  if (specifier === "@editor") return path.join(vendorRoot, "editor");
  if (specifier.startsWith("@editor/")) {
    return path.join(vendorRoot, "editor", specifier.slice("@editor/".length));
  }
  if (specifier === "@opencut/ui/icons") {
    return path.join(vendorRoot, "editor", "icons", "index");
  }
  if (specifier === "@opencut/env/web") {
    return path.join(vendorRoot, "editor", "stubs", "env");
  }
  if (specifier === "@/editor-engine/vendor") return vendorRoot;
  if (specifier.startsWith("@/editor-engine/vendor/")) {
    return path.join(vendorRoot, specifier.slice("@/editor-engine/vendor/".length));
  }
  if (specifier.startsWith("@/")) {
    return path.join(workspaceRoot, specifier.slice(2));
  }
  if (specifier.startsWith(".")) return path.resolve(path.dirname(importer), specifier);
  return null;
}

function resolveImport(importer, specifier, vendorFiles) {
  const base = resolveBase(importer, specifier);
  if (!base) return null;
  const candidates = [base];
  if (!path.extname(base)) {
    for (const extension of sourceExtensions) candidates.push(`${base}${extension}`);
    for (const extension of sourceExtensions) candidates.push(path.join(base, `index${extension}`));
  }
  for (const candidate of candidates) {
    const normalized = normalize(candidate);
    if (vendorFiles.has(normalized)) return normalized;
  }
  return null;
}

const vendorFiles = new Map(
  walk(vendorRoot).map((file) => [normalize(file), file]),
);
const vendorFileSet = new Set(vendorFiles.keys());
const externalRoots = new Set();

for (const file of walk(workspaceRoot, { skipVendor: true })) {
  if (!sourceExtensions.includes(path.extname(file))) continue;
  const source = fs.readFileSync(file, "utf8");
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveImport(file, specifier, vendorFileSet);
    if (resolved) externalRoots.add(resolved);
  }
}

const testRoots = new Set(
  [...vendorFileSet].filter((file) => /(?:^|\/)(?:[^/]+\.test\.(?:ts|tsx)|[^/]+\.d\.ts)$/.test(file)),
);
const reachable = new Set([...externalRoots, ...testRoots]);
const queue = [...reachable];

while (queue.length) {
  const current = queue.shift();
  const source = fs.readFileSync(vendorFiles.get(current), "utf8");
  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveImport(vendorFiles.get(current), specifier, vendorFileSet);
    if (resolved && !reachable.has(resolved)) {
      reachable.add(resolved);
      queue.push(resolved);
    }
  }
}

const relative = (file) => path.relative(workspaceRoot, vendorFiles.get(file)).replaceAll("\\", "/");
const unreachable = [...vendorFileSet].filter((file) => !reachable.has(file)).sort();
const report = {
  schemaVersion: "multimix_vendor_reachability:v1",
  vendorFileCount: vendorFileSet.size,
  reachableCount: reachable.size,
  unreachableCount: unreachable.length,
  unreachableBytes: unreachable.reduce((total, file) => total + fs.statSync(vendorFiles.get(file)).size, 0),
  externalRoots: [...externalRoots].map(relative).sort(),
  testRoots: [...testRoots].map(relative).sort(),
  unreachablePaths: unreachable.map(relative),
};

if (process.argv.includes("--paths")) {
  process.stdout.write(`${report.unreachablePaths.join("\n")}${unreachable.length ? "\n" : ""}`);
} else if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(
    `vendor files=${report.vendorFileCount} reachable=${report.reachableCount} unreachable=${report.unreachableCount} removable_bytes=${report.unreachableBytes}\n`,
  );
  for (const file of report.unreachablePaths) process.stdout.write(`${file}\n`);
}

if (process.argv.includes("--assert-clean") && unreachable.length) process.exitCode = 1;
