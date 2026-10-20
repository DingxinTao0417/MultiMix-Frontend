import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = path.join(workspaceRoot, "editor-engine", "vendor");
const sourceExtensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".css", ".glsl"];
const ignoredDirectories = new Set([
  ".git",
  ".worktrees",
  ".tmp",
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
    if (entry.isDirectory() && (ignoredDirectories.has(entry.name) || entry.name.startsWith(".next-"))) continue;
    const absolute = path.join(directory, entry.name);
    if (skipVendor && normalize(absolute) === normalize(vendorRoot)) continue;
    if (entry.isDirectory()) files.push(...walk(absolute, { skipVendor }));
    else files.push(absolute);
  }
  return files;
}

function importSpecifiers(source, filename) {
  const specifiers = new Set();
  if (path.extname(filename) === ".css") {
    // Preserve strings/URLs while removing CSS block comments before @import.
    const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
    const tokens = [];
    for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
      if (token !== ts.SyntaxKind.MultiLineCommentTrivia) tokens.push(scanner.getTokenText());
    }
    const imports = /@import\s+(?:["']([^"']+)["']|url\(\s*(?:["']([^"']+)["']|([^)\s]+))\s*\))/g;
    for (const match of tokens.join("").matchAll(imports)) specifiers.add(match[1] ?? match[2] ?? match[3]);
    return specifiers;
  }

  const syntax = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const addLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) specifiers.add(node.text);
  };
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addLiteral(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      addLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && (
      node.expression.kind === ts.SyntaxKind.ImportKeyword
      || (ts.isIdentifier(node.expression) && node.expression.text === "require")
    )) {
      addLiteral(node.arguments[0]);
    } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL") {
      addLiteral(node.arguments?.[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
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
  for (const specifier of importSpecifiers(source, file)) {
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
  for (const specifier of importSpecifiers(source, vendorFiles.get(current))) {
    const resolved = resolveImport(vendorFiles.get(current), specifier, vendorFileSet);
    if (resolved && !reachable.has(resolved)) {
      reachable.add(resolved);
      queue.push(resolved);
    }
  }
}

// Product graph starts only at actual Next entry modules and follows local edges.
// Test roots remain visible separately; test reachability alone is not deletion proof.
const allSourceFiles = new Set(walk(workspaceRoot).filter(file => sourceExtensions.includes(path.extname(file))).map(normalize));
const isTest = file => /(?:^|\/)(?:__tests__|test-support|e2e)(?:\/|$)|\.(?:test|spec)\.[^.]+$/.test(file);
const productRoots = [...allSourceFiles].filter(file => {
  const relativePath = path.relative(workspaceRoot, file).replaceAll("\\", "/");
  return !isTest(file) && (/^(?:app|src\/app)\/(?:.*\/)?(?:page|layout|route|loading|error|global-error|not-found|template|default)\.[jt]sx?$/.test(relativePath)
    || /^(?:middleware|instrumentation)\.[jt]s$/.test(relativePath));
});
function traverse(roots, files, rejectTests = false) {
  const seen = new Set(roots), pending = [...roots];
  while (pending.length) {
    const current = pending.shift();
    for (const specifier of importSpecifiers(fs.readFileSync(current, "utf8"), current)) {
      const target = resolveImport(current, specifier, files);
      if (target && !(rejectTests && isTest(target)) && !seen.has(target)) { seen.add(target); pending.push(target); }
    }
  }
  return seen;
}
const productReachable = traverse(productRoots, allSourceFiles, true);
const testReachable = traverse([...allSourceFiles].filter(isTest), allSourceFiles);
const vendorProduct = [...vendorFileSet].filter(file => productReachable.has(file));
const testOnly = [...vendorFileSet].filter(file => !productReachable.has(file) && testReachable.has(file));
const retainedOnly = [...vendorFileSet].filter(file => reachable.has(file) && !productReachable.has(file) && !testReachable.has(file));

const relative = (file) => path.relative(workspaceRoot, vendorFiles.get(file)).replaceAll("\\", "/");
const unreachable = [...vendorFileSet].filter((file) => !reachable.has(file)).sort();
const report = {
  schemaVersion: "multimix_vendor_reachability:v1",
  product: {
    rootPaths: productRoots.map(file => path.relative(workspaceRoot, file).replaceAll("\\", "/")).sort(),
    reachableCount: vendorProduct.length,
    reachablePaths: vendorProduct.map(file => path.relative(workspaceRoot, file).replaceAll("\\", "/")).sort(),
    testOnlyPaths: testOnly.map(file => path.relative(workspaceRoot, file).replaceAll("\\", "/")).sort(),
    retainedOnlyPaths: retainedOnly.map(file => path.relative(workspaceRoot, file).replaceAll("\\", "/")).sort(),
    classificationNotes: { testOnly: "reachable from tests but not Next product entrypoints; inspect contracts before retirement", retainedOnly: "retained by the combined declaration/tool graph; not product reachability" },
  },
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
