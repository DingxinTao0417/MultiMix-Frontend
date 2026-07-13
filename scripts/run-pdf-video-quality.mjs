import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import {
  assertPortFree,
  safeRemoveRunDatabase,
  startLogged,
  stopChild,
  waitFor,
} from "./demo-e2e/environment-manager.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const inWorktree = path.basename(path.dirname(frontendRoot)).toLowerCase() === ".worktrees";
const workspaceRoot = inWorktree
  ? path.resolve(frontendRoot, "..", "..", "..")
  : path.resolve(frontendRoot, "..");
const backendRoot = inWorktree
  ? path.join(workspaceRoot, "MultiMix-Backend", ".worktrees", path.basename(frontendRoot))
  : path.join(workspaceRoot, "MultiMix-Backend");
const canonicalBackendRoot = path.join(workspaceRoot, "MultiMix-Backend");
const backendPort = 8299;
const frontendPort = 3317;
const runId = (process.env.PDF_VIDEO_RUN_ID ?? crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, "-");
const timestamp = (process.env.PDF_VIDEO_TIMESTAMP ?? new Date().toISOString().replace(/[:.]/g, "-"))
  .replace(/[^a-zA-Z0-9-]/g, "-");
const databasePath = path.join(os.tmpdir(), `multimix-pdf-video-quality-${timestamp}-${runId}.sqlite3`);
const artifactDir = path.join(os.tmpdir(), `multimix-pdf-video-quality-artifacts-${timestamp}-${runId}`);
const resultDir = path.resolve(
  process.env.PDF_VIDEO_RESULT_DIR
    ?? path.join(workspaceRoot, "..", "multimix-test-results", timestamp),
);
const pdfPath = path.resolve(process.env.PDF_VIDEO_PATH ?? path.join(os.homedir(), "Desktop", "商业计划书v0.pdf"));
const manualMode = process.argv.includes("--manual");
const children = [];
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const pythonCommand = process.env.PYTHON ?? (process.platform === "win32" ? "py" : "python");
const pythonPrefix = process.platform === "win32" && !process.env.PYTHON ? ["-3.13"] : [];

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const output = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    output[key] = value;
  }
  return output;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: process.platform === "win32" && command.endsWith(".cmd"),
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk; options.stdout?.write(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += chunk; options.stderr?.write(chunk); });
    child.once("error", reject);
    child.once("exit", (code) => (
      code === 0
        ? resolve({ stdout, stderr })
        : reject(new Error(`${command} exited ${code}\n${stderr || stdout}`))
    ));
  });
}

function startProcess(command, args, cwd, env, logName) {
  const started = startLogged(command, args, {
    cwd,
    env,
    logPath: path.join(resultDir, logName),
  });
  children.push(started);
  return started.child;
}

function snapshotFiles(paths) {
  return paths.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }));
}

function restoreFiles(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.existed) fs.writeFileSync(snapshot.filePath, snapshot.contents);
    else fs.rmSync(snapshot.filePath, { force: true });
  }
}

async function removeRunDatabaseWithRetry(filePath, expectedRunId) {
  let lastError;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      safeRemoveRunDatabase(filePath, expectedRunId);
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === 11) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw lastError;
}

async function writeMediaReport() {
  const exportPath = path.join(resultDir, "verified-export.mp4");
  if (!fs.existsSync(exportPath)) return;
  const probe = await run("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", exportPath,
  ]);
  fs.writeFileSync(path.join(resultDir, "ffprobe.json"), probe.stdout);
  const parsed = JSON.parse(probe.stdout);
  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video") ?? {};
  const audio = streams.find((stream) => stream.codec_type === "audio") ?? {};
  const black = await run("ffmpeg", [
    "-hide_banner", "-i", exportPath, "-vf", "blackdetect=d=0.5:pix_th=0.10", "-an", "-f", "null", "-",
  ]).catch((error) => ({ stdout: "", stderr: String(error) }));
  fs.writeFileSync(path.join(resultDir, "blackdetect.log"), black.stderr);
  const duration = Number(parsed.format?.duration ?? video.duration ?? 0);
  const keyframeDir = path.join(resultDir, "keyframes");
  fs.mkdirSync(keyframeDir, { recursive: true });
  const moments = [0.5, duration * 0.25, duration * 0.5, duration * 0.75, Math.max(0, duration - 0.5)];
  for (const [index, moment] of moments.entries()) {
    await run("ffmpeg", [
      "-y", "-ss", moment.toFixed(3), "-i", exportPath, "-frames:v", "1",
      path.join(keyframeDir, `${index + 1}-${moment.toFixed(2)}s.png`),
    ]);
  }
  const blackIntervals = [...black.stderr.matchAll(/black_start:([0-9.]+).*?black_end:([0-9.]+)/g)]
    .map((match) => `${match[1]}s–${match[2]}s`);
  const report = `# PDF 到讲解视频本地回归报告\n\n`
    + `> Status: qa\n> Owner: workspace\n> Last verified: ${new Date().toISOString().slice(0, 10)}\n\n`
    + `## 结果\n\n- PDF: ${pdfPath}\n- MP4: ${exportPath}\n- 时长: ${duration.toFixed(3)} 秒\n`
    + `- 视频: ${video.width ?? "?"}x${video.height ?? "?"}, ${video.codec_name ?? "?"}\n`
    + `- 音频: ${audio.codec_name ?? "缺失"}\n- 裸黑区间: ${blackIntervals.length ? blackIntervals.join("、") : "未检出"}\n\n`
    + `## 自动验收\n\n${blackIntervals.length ? "- 检出连续裸黑区间，成片不应通过。" : "- 服务端质量门禁、来源内容断言与下载顺序均通过。"}\n\n`
    + `## 待人工判定\n\n- MG 表达、素材语义和竖屏构图需结合关键帧与 PDF 原文做视觉复核；自动通过不代表内容质量通过。\n\n`
    + `## 优化建议\n\n- 持续保留本用例作为 PDF 视频链路的发布前回归。\n`;
  fs.writeFileSync(path.join(resultDir, "qa-report.md"), report);
}

const workspaceSnapshots = snapshotFiles([
  path.join(frontendRoot, "next-env.d.ts"),
  path.join(frontendRoot, "tsconfig.json"),
]);

try {
  if (!fs.existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
  if (!fs.existsSync(backendRoot)) throw new Error(`Backend worktree not found: ${backendRoot}`);
  fs.mkdirSync(resultDir, { recursive: true });
  fs.mkdirSync(artifactDir, { recursive: true });
  console.log(`PDF video quality temp database: ${databasePath}`);
  console.log(`PDF video quality ports: backend ${backendPort}, frontend ${frontendPort}`);
  console.log(`PDF video quality results: ${resultDir}`);
  console.log("Cleanup: child processes, SQLite sidecars, temporary artifacts, and isolated Next build will be removed in finally.");
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);

  const canonicalEnv = parseEnvFile(path.join(canonicalBackendRoot, ".env"));
  const databaseUrl = `sqlite:///${databasePath.replaceAll("\\", "/")}`;
  const backendEnv = {
    ...process.env,
    ...canonicalEnv,
    CHANGEIN_ENV: "local",
    CHANGEIN_AUTH_PROVIDER: "local",
    CHANGEIN_AUTH_EMAIL_VERIFICATION_REQUIRED: "false",
    CHANGEIN_DATABASE_URL: databaseUrl,
    CHANGEIN_ARTIFACT_DIR: artifactDir,
    CHANGEIN_SUPABASE_URL: "",
    CHANGEIN_SUPABASE_PUBLISHABLE_KEY: "",
    CHANGEIN_SUPABASE_ANON_KEY: "",
    CHANGEIN_SUPABASE_SERVICE_ROLE_KEY: "",
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    CHANGEIN_S3_ENDPOINT_URL: "",
    CHANGEIN_S3_ACCESS_KEY: "",
    CHANGEIN_S3_SECRET_KEY: "",
    CHANGEIN_MODULES_MONITORING_ENABLED: "false",
    CHANGEIN_MODULES_VIDEO_ORCHESTRATION_ENABLED: "true",
    CHANGEIN_VIDEO_ORCHESTRATION_INLINE: "true",
    CHANGEIN_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
  };
  const frontendEnv = {
    ...process.env,
    NEXT_DEV_DIST_DIR: `.next-pdf-video-quality-${runId}`,
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };
  await run(
    pythonCommand,
    [...pythonPrefix, "-c", "from app.db import create_schema; create_schema()"],
    { cwd: backendRoot, env: backendEnv, stdout: process.stdout, stderr: process.stderr },
  );
  const backend = startProcess(
    pythonCommand,
    [...pythonPrefix, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
    backendRoot,
    backendEnv,
    "backend.log",
  );
  await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend, 120_000);
  const frontend = startProcess(
    npmCommand,
    ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
    frontendRoot,
    frontendEnv,
    "frontend.log",
  );
  await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, frontend, 180_000);

  if (manualMode) {
    fs.writeFileSync(path.join(resultDir, "manual-runtime.json"), JSON.stringify({
      url: `http://127.0.0.1:${frontendPort}/app/assets`, databasePath, artifactDir, pdfPath,
    }, null, 2));
    console.log(`Manual acceptance ready: http://127.0.0.1:${frontendPort}/app/assets`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } else {
    await run(npxCommand, ["playwright", "test", "e2e/pdf-video-quality.spec.ts"], {
      cwd: frontendRoot,
      env: {
        ...frontendEnv,
        PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
        PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright"),
        PDF_VIDEO_PATH: pdfPath,
        PDF_VIDEO_RESULT_DIR: resultDir,
      },
      stdout: process.stdout,
      stderr: process.stderr,
    });
    await writeMediaReport();
  }
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  await removeRunDatabaseWithRetry(databasePath, runId);
  fs.rmSync(artifactDir, { recursive: true, force: true });
  fs.rmSync(path.join(frontendRoot, `.next-pdf-video-quality-${runId}`), { recursive: true, force: true });
  restoreFiles(workspaceSnapshots);
  console.log(`Cleanup complete: ports ${backendPort}/${frontendPort} processes stopped; temp database and artifacts removed.`);
}
