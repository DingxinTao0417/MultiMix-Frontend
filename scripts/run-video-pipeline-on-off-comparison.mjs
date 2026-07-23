import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const productionRunner = path.join(
  frontendRoot,
  "scripts",
  "run-video-pipeline-production-e2e.mjs",
);
const comparisonId = (process.env.VIDEO_PIPELINE_COMPARISON_ID ?? crypto.randomUUID())
  .replace(/[^a-zA-Z0-9-]/g, "-");
const comparisonRoot = path.resolve(
  process.env.VIDEO_PIPELINE_COMPARISON_RESULT_DIR
    ?? path.join(frontendRoot, "test-results", `video-pipeline-comparison-${comparisonId}`),
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runProductionMode(mode) {
  const resultDir = path.join(comparisonRoot, mode);
  if (fs.existsSync(resultDir)) {
    throw new Error(`Comparison result directory already exists: ${resultDir}`);
  }
  fs.mkdirSync(resultDir, { recursive: true });
  const child = spawn(process.execPath, [productionRunner], {
    cwd: frontendRoot,
    env: {
      ...process.env,
      VIDEO_PIPELINE_TWO_STAGE_ENABLED: mode === "on" ? "true" : "false",
      VIDEO_PIPELINE_RUN_ID: `${comparisonId}-${mode}`,
      VIDEO_PIPELINE_RESULT_DIR: resultDir,
    },
    stdio: "inherit",
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve(resultDir);
        return;
      }
      reject(new Error(
        `Video pipeline ${mode} run failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
      ));
    });
  });
}

function comparableManifest(manifest) {
  return {
    scenario: manifest.scenario,
    sourceDocument: manifest.sourceDocument,
    productMedia: manifest.productMedia,
    hybridMedia: manifest.hybridMedia,
    llm: manifest.llm,
  };
}

function assertComparableManifests(offManifest, onManifest) {
  const offComparable = comparableManifest(offManifest);
  const onComparable = comparableManifest(onManifest);
  if (JSON.stringify(offComparable) !== JSON.stringify(onComparable)) {
    throw new Error(
      `On/off inputs differ and cannot be compared:\n${JSON.stringify({ offComparable, onComparable }, null, 2)}`,
    );
  }
  return offComparable;
}

function summarizeRun(mode) {
  const resultDir = path.join(comparisonRoot, mode);
  const browser = readJson(path.join(resultDir, "browser-result.json"));
  const mediaProbe = readJson(path.join(resultDir, "media-probe.json"));
  return {
    mode,
    twoStageEnabled: browser.twoStageEnabled,
    projectAssetId: browser.projectAssetId,
    candidateVideo: path.join(resultDir, "multimix-candidate.mp4"),
    screenshot: path.join(resultDir, "video-pipeline-ready.png"),
    mediaProbe,
    qualityMetrics: browser.qualityMetrics,
    qualityWarningCount: Array.isArray(browser.qualityWarnings)
      ? browser.qualityWarnings.length
      : 0,
    sourceMix: browser.sourceMix,
    informationIncrement: browser.informationIncrement,
    productPresentation: browser.productPresentation,
    manifestProjectReferenceMatch: browser.manifestProjectReferenceMatch,
    recomposeTested: browser.recomposeTested,
    resumeReuse: browser.resumeReuse,
    consoleErrorCount: Array.isArray(browser.consoleErrors) ? browser.consoleErrors.length : 0,
    requestFailureCount: Array.isArray(browser.requestFailures)
      ? browser.requestFailures.length
      : 0,
  };
}

function linkEvidence(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    fs.linkSync(source, destination);
  } catch {
    fs.copyFileSync(source, destination);
  }
}

function writeBlindScorecard() {
  const labels = crypto.randomInt(2) === 0
    ? { A: "off", B: "on" }
    : { A: "on", B: "off" };
  for (const [label, mode] of Object.entries(labels)) {
    const blindDir = path.join(comparisonRoot, "blind", label);
    linkEvidence(
      path.join(comparisonRoot, mode, "multimix-candidate.mp4"),
      path.join(blindDir, "candidate.mp4"),
    );
    linkEvidence(
      path.join(comparisonRoot, mode, "video-pipeline-ready.png"),
      path.join(blindDir, "workspace.png"),
    );
  }
  fs.writeFileSync(
    path.join(comparisonRoot, "blind-map.json"),
    JSON.stringify({ comparisonId, labels }, null, 2),
  );
  fs.writeFileSync(path.join(comparisonRoot, "blind-scorecard.md"), [
    "# 视频流水线匿名 A/B 评分表",
    "",
    "> Status: qa",
    "> Owner: workspace",
    `> Last verified: ${new Date().toISOString().slice(0, 10)}`,
    "",
    "评分时只打开 `blind/A/candidate.mp4` 与 `blind/B/candidate.mp4`，完成后再查看 `blind-map.json`。",
    "",
    "| 维度 | A（1–5） | B（1–5） | 备注 |",
    "| --- | ---: | ---: | --- |",
    "| 叙事清晰 | | | |",
    "| 素材相关 | | | |",
    "| 节奏自然 | | | |",
    "| 品牌一致 | | | |",
    "| 信息密度 | | | |",
    "| 真实素材使用 | | | |",
    "| 证据真实性 | | | |",
    "| 整体专业感 | | | |",
    "",
    "总体偏好：A / B / 持平",
  ].join("\n"));
}

fs.mkdirSync(comparisonRoot, { recursive: true });
console.log(`Video pipeline comparison results: ${comparisonRoot}`);
for (const mode of ["off", "on"]) {
  console.log(`Starting isolated ${mode} run...`);
  await runProductionMode(mode);
}

const offManifest = readJson(path.join(comparisonRoot, "off", "run-manifest.json"));
const onManifest = readJson(path.join(comparisonRoot, "on", "run-manifest.json"));
const comparableInputs = assertComparableManifests(offManifest, onManifest);
const report = {
  comparisonId,
  createdAt: new Date().toISOString(),
  comparableInputs,
  runs: {
    off: summarizeRun("off"),
    on: summarizeRun("on"),
  },
};
fs.writeFileSync(
  path.join(comparisonRoot, "comparison-report.json"),
  JSON.stringify(report, null, 2),
);
writeBlindScorecard();
console.log(`Comparison complete: ${comparisonRoot}`);
