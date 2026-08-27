import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

import {
  assertPortFree,
  startLogged,
  stopChild,
  waitFor,
} from "./demo-e2e/environment-manager.mjs";
import { createE2ERunLifecycle, resumeRetainedE2ERunLifecycle } from "./e2e-run-lifecycle.mjs";
import { repairNextGeneratedTypeReferences } from "./next-generated-types.mjs";
import {
  assertDeclaredProductMediaMetadata,
  probeProductMediaFile,
} from "./product-media-file-probe.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const workspaceRoot = path.resolve(frontendRoot, "..");
const canonicalBackendRoot = process.env.MULTIMIX_CANONICAL_BACKEND_ROOT
  ? path.resolve(process.env.MULTIMIX_CANONICAL_BACKEND_ROOT)
  : path.join(workspaceRoot, "MultiMix-Backend");
const backendRoot = process.env.MULTIMIX_BACKEND_ROOT
  ? path.resolve(process.env.MULTIMIX_BACKEND_ROOT)
  : canonicalBackendRoot;
const canonicalEnv = {
  ...parseEnvFile(path.join(canonicalBackendRoot, ".env")),
  ...parseEnvFile(path.join(canonicalBackendRoot, ".env.local")),
};
const backendPort = Number(process.env.VIDEO_PIPELINE_BACKEND_PORT ?? 8427);
const frontendPort = Number(process.env.VIDEO_PIPELINE_FRONTEND_PORT ?? 3427);
const visionPort = Number(process.env.VIDEO_PIPELINE_VISION_PORT ?? 8428);
const configuredVisionServiceUrl = (
  process.env.VIDEO_PIPELINE_VISION_SERVICE_URL
  ?? canonicalEnv.MULTIMIX_VISION_SERVICE_URL
  ?? canonicalEnv.VISION_SERVICE_URL
  ?? ""
).trim().replace(/\/+$/, "");
const usesExternalVisionService = configuredVisionServiceUrl.length > 0;
const effectiveVisionApiKey = (
  process.env.VISION_QWEN_API_KEY
  ?? process.env.DASHSCOPE_API_KEY
  ?? process.env.QWEN_API_KEY
  ?? canonicalEnv.VISION_QWEN_API_KEY
  ?? canonicalEnv.DASHSCOPE_API_KEY
  ?? canonicalEnv.QWEN_API_KEY
  ?? ""
).trim();
const effectiveVisionBaseUrl = (
  process.env.VISION_QWEN_BASE_URL
  ?? canonicalEnv.VISION_QWEN_BASE_URL
  ?? "https://dashscope.aliyuncs.com/compatible-mode/v1"
).trim();
const effectiveVisionModel = (
  process.env.VISION_QWEN_MODEL
  ?? canonicalEnv.VISION_QWEN_MODEL
  ?? "qwen3-vl-flash"
).trim();
if (!usesExternalVisionService && !effectiveVisionApiKey) {
  throw new Error(
    "Local vision service requires a configured Qwen/DashScope API key",
  );
}
const requiredPorts = usesExternalVisionService
  ? [backendPort, frontendPort]
  : [backendPort, frontendPort, visionPort];
if (
  !requiredPorts.every(Number.isInteger)
  || new Set(requiredPorts).size !== requiredPorts.length
) {
  throw new Error(
    "VIDEO_PIPELINE_BACKEND_PORT, VIDEO_PIPELINE_FRONTEND_PORT, and any local "
    + "VIDEO_PIPELINE_VISION_PORT must be distinct integers",
  );
}
if (
  usesExternalVisionService
  && !/^https?:\/\//i.test(configuredVisionServiceUrl)
) {
  throw new Error("VIDEO_PIPELINE_VISION_SERVICE_URL must use http or https");
}
const visionServiceUrl = configuredVisionServiceUrl
  || `http://127.0.0.1:${visionPort}`;
const resumeArgIndex = process.argv.indexOf("--resume");
const resumeRunId = resumeArgIndex >= 0 ? process.argv[resumeArgIndex + 1] : "";
if (resumeArgIndex >= 0 && (!resumeRunId || resumeRunId.startsWith("--"))) {
  throw new Error("--resume requires a retained VIDEO_PIPELINE_RUN_ID");
}
const activationPath = path.join(
  canonicalBackendRoot,
  "app",
  "video_pipelines",
  "unified",
  "activation.yaml",
);
const activationSource = fs.readFileSync(activationPath, "utf8");
const activeSection = activationSource.match(/active_versions:\s*\n([\s\S]*?)(?=\n\S|$)/)?.[1] ?? "";
const activeVideoTypes = [...activeSection.matchAll(/^\s{2}([a-z_]+):\s*\S+\s*$/gm)]
  .map((match) => match[1]);
if (activeVideoTypes.length === 0) {
  throw new Error(`Invalid production E2E activation: ${activeVideoTypes.join(",")}`);
}
if (!process.env.VIDEO_PIPELINE_VIDEO_TYPE && resumeArgIndex >= 0) {
  throw new Error("Resuming a retained run requires VIDEO_PIPELINE_VIDEO_TYPE");
}
if (!process.env.VIDEO_PIPELINE_VIDEO_TYPE) {
  const matrixResultRoot = path.resolve(
    process.env.VIDEO_PIPELINE_RESULT_DIR
      ?? path.join(frontendRoot, "test-results", "video-pipeline-production"),
  );
  for (const videoType of activeVideoTypes) {
    const child = spawnSync(
      process.execPath,
      [process.argv[1], ...process.argv.slice(2)],
      {
        cwd: frontendRoot,
        env: {
          ...process.env,
          VIDEO_PIPELINE_VIDEO_TYPE: videoType,
          VIDEO_PIPELINE_RESULT_DIR: path.join(matrixResultRoot, videoType),
          VIDEO_PIPELINE_RUN_ID: `${crypto.randomUUID()}-${videoType}`,
        },
        stdio: "inherit",
      },
    );
    if (child.status !== 0) {
      process.exit(child.status ?? 1);
    }
  }
  process.exit(0);
}
const requestedRunId = (process.env.VIDEO_PIPELINE_RUN_ID ?? crypto.randomUUID()).replace(/[^a-zA-Z0-9-]/g, "-");
const defaultResultDir = path.resolve(
  process.env.VIDEO_PIPELINE_RESULT_DIR
    ?? path.join(frontendRoot, "test-results", "video-pipeline-production"),
);
const isResume = resumeArgIndex >= 0;
const lifecycle = isResume
  ? resumeRetainedE2ERunLifecycle({ suite: "video-pipeline-production", runId: resumeRunId })
  : createE2ERunLifecycle({ suite: "video-pipeline-production", runId: requestedRunId, resultDir: defaultResultDir });
const runId = lifecycle.runId;
const { databasePath, artifactDir } = lifecycle;
const resultDir = lifecycle.readState().resultDir;
const playwrightTimingPath = path.join(lifecycle.runDir, "playwright-timing.ndjson");
const expectedVideoType = process.env.VIDEO_PIPELINE_VIDEO_TYPE ?? activeVideoTypes[0];
if (!expectedVideoType || !activeVideoTypes.includes(expectedVideoType)) {
  throw new Error(`VIDEO_PIPELINE_VIDEO_TYPE is not active: ${expectedVideoType ?? "missing"}`);
}
const sourceDocument = path.resolve(
  process.env.VIDEO_PIPELINE_SOURCE_DOCUMENT
    ?? path.join(workspaceRoot, "MultiMix-商业计划.md"),
);
const sourceExcerptVideo = path.resolve(
  process.env.VIDEO_PIPELINE_SOURCE_EXCERPT_VIDEO
    ?? path.join(
      workspaceRoot,
      "artifacts",
      "research",
      "commerce-video-samples-2026-08-08",
      "thread-local-samples",
      "01-podcast-random-highlights",
      "input-original.mp4",
    ),
);
const targetSeconds = Number(process.env.VIDEO_PIPELINE_TARGET_SECONDS ?? 30);
const targetRatio = process.env.VIDEO_PIPELINE_RATIO ?? "16:9";
const outputSizeByRatio = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
};
if (!(targetRatio in outputSizeByRatio)) {
  throw new Error("VIDEO_PIPELINE_RATIO must be one of 16:9, 9:16, or 1:1");
}
const expectedOutputSize = outputSizeByRatio[targetRatio];
const durationToleranceRatio = Number(
  process.env.VIDEO_PIPELINE_DURATION_TOLERANCE ?? 0.1,
);
const expectedSceneCount = Number(
  process.env.VIDEO_PIPELINE_EXPECTED_SCENE_COUNT
    ?? (targetSeconds >= 45 ? 8 : 6),
);
const videoJobTimeoutMs = Number(
  process.env.VIDEO_PIPELINE_VIDEO_JOB_TIMEOUT_MS ?? 20 * 60_000,
);
if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
  throw new Error("VIDEO_PIPELINE_TARGET_SECONDS must be a positive number");
}
if (
  !Number.isFinite(durationToleranceRatio)
  || durationToleranceRatio < 0
  || durationToleranceRatio >= 1
) {
  throw new Error("VIDEO_PIPELINE_DURATION_TOLERANCE must be between 0 and 1");
}
if (!Number.isInteger(expectedSceneCount) || expectedSceneCount < 1) {
  throw new Error("VIDEO_PIPELINE_EXPECTED_SCENE_COUNT must be a positive integer");
}
if (!Number.isInteger(videoJobTimeoutMs) || videoJobTimeoutMs < 1) {
  throw new Error("VIDEO_PIPELINE_VIDEO_JOB_TIMEOUT_MS must be a positive integer");
}
const minimumDurationSeconds = targetSeconds * (1 - durationToleranceRatio);
const maximumDurationSeconds = targetSeconds * (1 + durationToleranceRatio);
const pythonCommand = process.env.PYTHON
  ?? path.join(canonicalBackendRoot, ".venv", "Scripts", "python.exe");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";
const ffprobeCommand = process.env.FFPROBE ?? "ffprobe";
const ffmpegCommand = process.env.FFMPEG ?? "ffmpeg";
const maxTruePeakDbfs = Number(process.env.VIDEO_PIPELINE_MAX_TRUE_PEAK_DBFS ?? "-0.1");
const interruptAfterManifest = process.env.VIDEO_PIPELINE_INTERRUPT_AFTER_MANIFEST === "true";
const testRecompose = process.argv.includes("--recompose")
  || process.env.VIDEO_PIPELINE_TEST_RECOMPOSE === "true";
const inputProfile = process.env.VIDEO_PIPELINE_INPUT_PROFILE ?? `${expectedVideoType}_default`;
const sourceDocumentFingerprint = inputProfile === "explainer_saved_library_simple"
  ? null
  : fingerprintFile(sourceDocument);
let expectBgm = process.env.VIDEO_PIPELINE_EXPECT_BGM !== "false";
if (expectedVideoType === "source_excerpt") expectBgm = false;
const twoStageEnabled = true;
const requirePublicAsset = process.env.VIDEO_PIPELINE_REQUIRE_PUBLIC_ASSET === "true"
  || inputProfile === "explainer_public_broll";
const defaultDemonstrationMedia = [
  ["02-kitchen-renovation-v1", "过程基线.mp4"],
  ["05-kitchen-service-promo-v2", "步骤迭代.mp4"],
  ["07-kitchen-service-mg-v3", "结果与图形增强.mp4"],
].map(([folder, name]) => ({
  path: path.join(
    workspaceRoot,
    "artifacts",
    "research",
    "commerce-video-samples-2026-08-08",
    "thread-local-samples",
    folder,
    "source.mp4",
  ),
  name,
}));
const demonstrationMediaFiles = process.env.VIDEO_PIPELINE_DEMONSTRATION_MEDIA_FILES
  ?? JSON.stringify(defaultDemonstrationMedia);
const children = [];
let providerProxy;
let decisionAuditEnv;

function startProviderEgressProxy(allowedHosts) {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const sockets = new Set();
  const server = http.createServer((_request, response) => {
    response.writeHead(405, { Connection: "close" });
    response.end();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.on("connect", (request, clientSocket, head) => {
    const authority = String(request.url ?? "");
    const separator = authority.lastIndexOf(":");
    const host = separator > 0 ? authority.slice(0, separator).toLowerCase() : "";
    const port = Number(authority.slice(separator + 1));
    if (!allowed.has(host) || port !== 443) {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect({ host, port });
    sockets.add(upstream);
    upstream.once("close", () => sockets.delete(upstream));
    upstream.once("connect", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.once("error", () => {
      if (!clientSocket.destroyed) {
        clientSocket.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      }
    });
    clientSocket.once("error", () => upstream.destroy());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Provider egress proxy did not bind to a TCP port"));
        return;
      }
      resolve({
        port: address.port,
        close: () => new Promise((closeResolve, closeReject) => {
          for (const socket of sockets) socket.destroy();
          server.close((error) => (error ? closeReject(error) : closeResolve()));
        }),
      });
    });
  });
}

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

async function cleanupRemoteArtifactWrites(backendEnv) {
  const ledgerPath = backendEnv.MULTIMIX_ARTIFACT_WRITE_LEDGER_PATH;
  const expectedPrefix = backendEnv.MULTIMIX_ARTIFACT_KEY_PREFIX;
  if (!ledgerPath || !expectedPrefix || !fs.existsSync(ledgerPath)) return;
  const cleanupScript = [
    "from pathlib import Path",
    "import os",
    "from app.config import Settings",
    "from app.services.storage import ArtifactStore, artifact_key_from_ref",
    "ledger = Path(os.environ['MULTIMIX_ARTIFACT_WRITE_LEDGER_PATH'])",
    "prefix = os.environ['MULTIMIX_ARTIFACT_KEY_PREFIX'].rstrip('/') + '/'",
    "refs = list(dict.fromkeys(line.strip() for line in ledger.read_text(encoding='utf-8').splitlines() if line.strip()))",
    "invalid = [ref for ref in refs if not ref.startswith(('supabase://', 's3://')) or not artifact_key_from_ref(ref, require_value=True).startswith(prefix)]",
    "if invalid: raise RuntimeError('Remote artifact cleanup ledger escaped the current E2E namespace')",
    "store = ArtifactStore(Settings(_env_file=None))",
    "failed = []",
    "for ref in refs:",
    "  try: store.delete(ref)",
    "  except Exception: failed.append(ref)",
    "if failed:",
    "  ledger.write_text(''.join(ref + '\\n' for ref in failed), encoding='utf-8')",
    "  raise RuntimeError(f'Failed to clean {len(failed)} remote E2E artifacts')",
    "ledger.unlink(missing_ok=True)",
  ].join("\n");
  await run(pythonCommand, ["-c", cleanupScript], {
    cwd: backendRoot,
    env: backendEnv,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

async function checkpointRemoteArtifactWrites(backendEnv) {
  const expectedPrefix = backendEnv.MULTIMIX_ARTIFACT_KEY_PREFIX;
  if (!expectedPrefix) return;
  const checkpointRoot = path.join(artifactDir, "retained-remote-artifacts");
  const checkpointScript = [
    "from pathlib import Path",
    "import hashlib, json, os, sys",
    "from app.config import Settings",
    "from app.services.storage import ArtifactStore, artifact_key_from_ref",
    "root = Path(sys.argv[1]).resolve()",
    "root.mkdir(parents=True, exist_ok=True)",
    "objects = (root / 'objects').resolve()",
    "objects.mkdir(parents=True, exist_ok=True)",
    "manifest_path = root / 'manifest.json'",
    "prefix = os.environ['MULTIMIX_ARTIFACT_KEY_PREFIX'].rstrip('/') + '/'",
    "ledger_value = os.environ.get('MULTIMIX_ARTIFACT_WRITE_LEDGER_PATH', '')",
    "ledger = Path(ledger_value) if ledger_value else None",
    "refs = list(dict.fromkeys(line.strip() for line in ledger.read_text(encoding='utf-8').splitlines() if line.strip())) if ledger and ledger.is_file() else []",
    "invalid = [ref for ref in refs if not ref.startswith(('supabase://', 's3://')) or not artifact_key_from_ref(ref, require_value=True).startswith(prefix)]",
    "if invalid: raise RuntimeError('remote artifact checkpoint ref escaped the current E2E namespace')",
    "existing = {'schema_version': 1, 'entries': []}",
    "if manifest_path.is_file(): existing = json.loads(manifest_path.read_text(encoding='utf-8'))",
    "if existing.get('schema_version') != 1 or not isinstance(existing.get('entries'), list): raise RuntimeError('remote artifact checkpoint manifest is invalid')",
    "entries = {str(item.get('ref') or ''): item for item in existing['entries'] if isinstance(item, dict) and item.get('ref')}",
    "store = ArtifactStore(Settings(_env_file=None))",
    "for ref in refs:",
    "  data = store.get_bytes(ref)",
    "  stat = store.stat(ref)",
    "  digest = hashlib.sha256(data).hexdigest()",
    "  relative_path = f'objects/{hashlib.sha256(ref.encode(\"utf-8\")).hexdigest()}.bin'",
    "  target = (root / relative_path).resolve()",
    "  if root not in target.parents: raise RuntimeError('remote artifact checkpoint path escaped its cache directory')",
    "  current = entries.get(ref)",
    "  candidate = {'ref': ref, 'relative_path': relative_path, 'size_bytes': len(data), 'sha256': digest, 'content_type': str(stat.content_type or 'application/octet-stream').split(';', 1)[0].strip().lower()}",
    "  if current and any(current.get(key) != candidate[key] for key in candidate): raise RuntimeError('remote artifact checkpoint digest changed')",
    "  if target.is_file():",
    "    cached = target.read_bytes()",
    "    if len(cached) != len(data) or hashlib.sha256(cached).hexdigest() != digest: raise RuntimeError('remote artifact checkpoint digest changed')",
    "  else:",
    "    temporary = target.with_suffix('.tmp')",
    "    temporary.write_bytes(data)",
    "    temporary.replace(target)",
    "  entries[ref] = candidate",
    "manifest = {'schema_version': 1, 'namespace': prefix, 'entries': [entries[key] for key in sorted(entries)]}",
    "temporary_manifest = manifest_path.with_suffix('.tmp')",
    "temporary_manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\\n', encoding='utf-8')",
    "temporary_manifest.replace(manifest_path)",
    "print(json.dumps({'entry_count': len(entries), 'new_refs': len(refs)}))",
  ].join("\n");
  await run(pythonCommand, ["-c", checkpointScript, checkpointRoot], {
    cwd: backendRoot,
    env: backendEnv,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

async function restoreCheckpointedRemoteArtifacts(backendEnv) {
  const expectedPrefix = backendEnv.MULTIMIX_ARTIFACT_KEY_PREFIX;
  if (!expectedPrefix) return;
  const checkpointRoot = path.join(artifactDir, "retained-remote-artifacts");
  const restoreScript = [
    "from pathlib import Path",
    "import hashlib, json, os, sys",
    "from app.config import Settings",
    "from app.services.storage import ArtifactStore, artifact_key_from_ref",
    "root = Path(sys.argv[1]).resolve()",
    "manifest_path = root / 'manifest.json'",
    "if not manifest_path.is_file(): raise RuntimeError('retained remote artifact checkpoint is missing')",
    "manifest = json.loads(manifest_path.read_text(encoding='utf-8'))",
    "prefix = os.environ['MULTIMIX_ARTIFACT_KEY_PREFIX'].rstrip('/') + '/'",
    "if manifest.get('schema_version') != 1 or manifest.get('namespace') != prefix or not isinstance(manifest.get('entries'), list): raise RuntimeError('retained remote artifact checkpoint manifest is invalid')",
    "store = ArtifactStore(Settings(_env_file=None))",
    "restored = 0",
    "for item in manifest['entries']:",
    "  if not isinstance(item, dict): raise RuntimeError('retained remote artifact checkpoint entry is invalid')",
    "  ref = str(item.get('ref') or '')",
    "  if not ref.startswith(('supabase://', 's3://')) or not artifact_key_from_ref(ref, require_value=True).startswith(prefix): raise RuntimeError('remote artifact checkpoint ref escaped the current E2E namespace')",
    "  source = (root / str(item.get('relative_path') or '')).resolve()",
    "  if root not in source.parents: raise RuntimeError('remote artifact checkpoint path escaped its cache directory')",
    "  if not source.is_file(): raise RuntimeError('retained remote artifact checkpoint object is missing')",
    "  data = source.read_bytes()",
    "  expected_size = int(item.get('size_bytes') or -1)",
    "  expected_digest = str(item.get('sha256') or '').casefold()",
    "  if len(data) != expected_size or hashlib.sha256(data).hexdigest() != expected_digest: raise RuntimeError('remote artifact checkpoint digest changed')",
    "  present = False",
    "  try:",
    "    remote = store.get_bytes(ref)",
    "    if len(remote) != expected_size or hashlib.sha256(remote).hexdigest() != expected_digest: raise RuntimeError('remote artifact checkpoint digest changed')",
    "    present = True",
    "  except Exception as exc:",
    "    if isinstance(exc, RuntimeError) and str(exc) == 'remote artifact checkpoint digest changed': raise",
    "    message = str(exc).casefold()",
    "    if not any(token in message for token in ('nosuchkey', 'not found', '404')): raise",
    "  if not present:",
    "    key = artifact_key_from_ref(ref, require_value=True)",
    "    restored_ref = store.put_bytes_at(key, data, str(item.get('content_type') or 'application/octet-stream'))",
    "    if restored_ref != ref: raise RuntimeError('remote artifact checkpoint ref changed during restore')",
    "    remote = store.get_bytes(ref)",
    "    if len(remote) != expected_size or hashlib.sha256(remote).hexdigest() != expected_digest: raise RuntimeError('remote artifact checkpoint digest changed')",
    "    restored += 1",
    "print(json.dumps({'entry_count': len(manifest['entries']), 'restored': restored}))",
  ].join("\n");
  await run(pythonCommand, ["-c", restoreScript, checkpointRoot], {
    cwd: backendRoot,
    env: backendEnv,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

function readTimingSummary(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line)]; } catch { return []; }
    })
    .filter((entry) => (
      typeof entry?.stage === "string"
      && typeof entry?.status === "string"
      && Number.isFinite(entry?.duration_ms)
    ))
    .map((entry) => ({
      stage: entry.stage,
      status: entry.status,
      duration_ms: Math.max(0, entry.duration_ms),
    }))
    .sort((left, right) => right.duration_ms - left.duration_ms);
}

function snapshotFiles(filePaths) {
  return filePaths.map((filePath) => ({
    filePath,
    existed: fs.existsSync(filePath),
    contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  }));
}

function restoreFiles(snapshots) {
  for (const snapshot of snapshots) {
    if (snapshot.existed && snapshot.contents) fs.writeFileSync(snapshot.filePath, snapshot.contents);
    else fs.rmSync(snapshot.filePath, { force: true });
  }
}

function fingerprintFile(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return { path: resolved, sha256: null };
  return {
    path: resolved,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(resolved)).digest("hex"),
  };
}

function configuredInputFingerprints(raw) {
  if (!raw) return [];
  try {
    const values = JSON.parse(raw);
    if (!Array.isArray(values)) return [];
    return values
      .map((value) => String(value?.path ?? "").trim())
      .filter(Boolean)
      .map(fingerprintFile);
  } catch {
    return [];
  }
}

function stageBgmCatalogIfAvailable() {
  const sourceRoot = path.join(canonicalBackendRoot, "artifacts", "bgm");
  const sourceManifestPath = path.join(sourceRoot, "catalog", "v1", "manifest.json");
  if (!fs.existsSync(sourceManifestPath)) {
    return null;
  }
  const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf8"));
  const tracks = Array.isArray(manifest.tracks)
    ? manifest.tracks.filter((track) => track?.status === "active")
    : [];
  if (tracks.length === 0) {
    return null;
  }
  for (const directory of ["library", "previews", "licenses"]) {
    if (!fs.existsSync(path.join(sourceRoot, directory))) {
      return null;
    }
  }
  for (const directory of ["library", "previews", "licenses"]) {
    fs.cpSync(path.join(sourceRoot, directory), path.join(artifactDir, "bgm", directory), { recursive: true });
  }
  const stagedManifest = {
    ...manifest,
    tracks,
  };
  const manifestPath = path.join(artifactDir, "bgm", "catalog", "v1", "manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(stagedManifest, null, 2));
  return {
    manifestRef: "local://bgm/catalog/v1/manifest.json",
    defaultCatalogId: tracks[0].id,
  };
}

function stageApprovedProductMediaCatalog() {
  const raw = process.env.VIDEO_PIPELINE_PRODUCT_MEDIA_FILES;
  if (!raw) throw new Error("VIDEO_PIPELINE_PRODUCT_MEDIA_FILES is required for product-media QA");
  let sources;
  try {
    sources = JSON.parse(raw);
  } catch (error) {
    throw new Error(`VIDEO_PIPELINE_PRODUCT_MEDIA_FILES must be JSON: ${error.message}`);
  }
  if (!Array.isArray(sources) || sources.length < 2) {
    throw new Error("VIDEO_PIPELINE_PRODUCT_MEDIA_FILES must provide at least two approved captures");
  }
  const entries = sources.map((source, index) => {
    const sourcePath = path.resolve(String(source?.path ?? ""));
    const roles = Array.isArray(source?.roles) ? source.roles.map(String).filter(Boolean) : [];
    if (!fs.existsSync(sourcePath) || roles.length === 0) {
      throw new Error(`Approved product capture ${index + 1} is missing or has no roles: ${sourcePath}`);
    }
    const extension = path.extname(sourcePath).toLowerCase();
    const mediaType = extension === ".mp4" ? "video" : "image";
    if (!new Set([".png", ".jpg", ".jpeg", ".webp", ".mp4"]).has(extension)) {
      throw new Error(`Unsupported approved product capture type: ${extension}`);
    }
    const identifier = `multimix-ui-${index + 1}`;
    const mediaFacts = assertDeclaredProductMediaMetadata(
      source,
      probeProductMediaFile(sourcePath, { command: ffprobeCommand }),
      { mediaType, label: `Approved product capture ${index + 1}` },
    );
    const rawRegions = source?.regions;
    if (rawRegions !== undefined && !Array.isArray(rawRegions)) {
      throw new Error(`Approved product capture ${index + 1} regions must be an array`);
    }
    const regionIds = new Set();
    const regions = (rawRegions ?? []).map((region, regionIndex) => {
      const id = String(region?.id ?? "").trim();
      const regionRoles = Array.isArray(region?.roles)
        ? region.roles.map(String).map((role) => role.trim()).filter(Boolean)
        : [];
      const box = region?.box;
      const normalizedBox = Object.fromEntries(
        ["x", "y", "w", "h"].map((key) => [key, Number(box?.[key])]),
      );
      if (!id || regionIds.has(id) || regionRoles.length === 0) {
        throw new Error(
          `Approved product capture ${index + 1} region ${regionIndex + 1} requires a unique id and roles`,
        );
      }
      const { x, y, w, h } = normalizedBox;
      if (
        ![x, y, w, h].every(Number.isFinite)
        || x < 0
        || y < 0
        || w <= 0
        || h <= 0
        || x + w > 1
        || y + h > 1
      ) {
        throw new Error(
          `Approved product capture ${index + 1} region ${id} must stay within normalized bounds`,
        );
      }
      regionIds.add(id);
      return { id, roles: [...new Set(regionRoles)], box: normalizedBox };
    });
    const key = path.join("product-media", "v1", `${identifier}${extension}`).replaceAll("\\", "/");
    const targetPath = path.join(artifactDir, ...key.split("/"));
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    return {
      id: identifier,
      title: String(source?.title ?? `MultiMix 产品界面 ${index + 1}`),
      status: "approved",
      media_type: mediaType,
      artifact_ref: `local://${key}`,
      roles,
      width: mediaFacts.width,
      height: mediaFacts.height,
      duration_seconds: mediaType === "video" ? mediaFacts.durationSeconds : 0,
      priority: Number(source?.priority ?? index + 1),
      source: "user_approved_product_capture",
      ...(regions.length > 0 ? { regions } : {}),
    };
  });
  const manifestPath = path.join(artifactDir, "product-media", "v1", "manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({
    version: "multimix_product_media_v1",
    product: "MultiMix",
    entries,
  }, null, 2));
  return "local://product-media/v1/manifest.json";
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

async function verifyCandidateVideo() {
  const candidatePath = path.join(resultDir, "multimix-candidate.mp4");
  if (!fs.existsSync(candidatePath)) throw new Error(`Exported candidate is missing: ${candidatePath}`);
  const { stdout } = await run(ffprobeCommand, [
    "-v", "error",
    "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,pix_fmt",
    "-of", "json",
    candidatePath,
  ]);
  const probe = JSON.parse(stdout);
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  const failures = [];
  const warnings = [];
  if (video?.codec_name !== "h264") failures.push(`codec_name=${video?.codec_name ?? "missing"}, expected h264`);
  if (video?.pix_fmt !== "yuv420p") failures.push(`pix_fmt=${video?.pix_fmt ?? "missing"}, expected yuv420p`);
  if (video?.width !== expectedOutputSize.width) {
    failures.push(`width=${video?.width ?? "missing"}, expected ${expectedOutputSize.width}`);
  }
  if (video?.height !== expectedOutputSize.height) {
    failures.push(`height=${video?.height ?? "missing"}, expected ${expectedOutputSize.height}`);
  }
  if (audio?.codec_name !== "aac") failures.push(`audio codec_name=${audio?.codec_name ?? "missing"}, expected aac`);
  if (!Number.isFinite(duration) || duration <= 0) {
    failures.push(
      `duration=${Number.isFinite(duration) ? duration : "missing"}, expected a positive readable duration`,
    );
  } else if (
    duration < minimumDurationSeconds
    || duration > maximumDurationSeconds
  ) {
    warnings.push(
      `duration_seconds=${duration}, expected=${minimumDurationSeconds}-${maximumDurationSeconds}`,
    );
  }
  const { stderr: loudnessStderr } = await run(ffmpegCommand, [
    "-hide_banner",
    "-nostats",
    "-i", candidatePath,
    "-vn",
    "-af", "loudnorm=I=-24:TP=-2:LRA=7:print_format=json",
    "-f", "null",
    process.platform === "win32" ? "NUL" : "/dev/null",
  ]);
  const loudnessMatches = [...loudnessStderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/g)];
  const loudnessRaw = loudnessMatches.at(-1)?.[0];
  if (!loudnessRaw) failures.push("rendered loudness measurement missing");
  const loudness = loudnessRaw ? JSON.parse(loudnessRaw) : {};
  const integratedLufs = Number(loudness.input_i);
  const truePeakDbfs = Number(loudness.input_tp);
  const clipping = !Number.isFinite(truePeakDbfs) || truePeakDbfs > maxTruePeakDbfs;
  if (clipping) {
    failures.push(
      `true_peak_dbfs=${Number.isFinite(truePeakDbfs) ? truePeakDbfs : "missing"}, expected <= ${maxTruePeakDbfs}`,
    );
  }
  const browserResultPath = path.join(resultDir, "browser-result.json");
  const browserResult = fs.existsSync(browserResultPath)
    ? JSON.parse(fs.readFileSync(browserResultPath, "utf8"))
    : {};
  const keyframeDir = path.join(resultDir, "keyframes");
  fs.rmSync(keyframeDir, { recursive: true, force: true });
  fs.mkdirSync(keyframeDir, { recursive: true });
  const sceneWindows = Array.isArray(browserResult.sceneWindows)
    ? browserResult.sceneWindows.filter((window) => (
      Number.isFinite(Number(window?.startTime))
      && Number.isFinite(Number(window?.duration))
      && Number(window.duration) > 0
    )).slice(0, 6)
    : [];
  const keyframeWindows = sceneWindows.length === 6
    ? sceneWindows
    : Array.from({ length: 6 }, (_value, index) => ({
      sceneId: `scene-${index + 1}`,
      startTime: (duration * index) / 6,
      duration: duration / 6,
    }));
  const keyframes = [];
  for (const [index, window] of keyframeWindows.entries()) {
    const sceneId = String(window.sceneId ?? `scene-${index + 1}`)
      .replace(/[^a-zA-Z0-9_-]/g, "-");
    const outputPath = path.join(
      keyframeDir,
      `keyframe-${String(index + 1).padStart(2, "0")}-${sceneId}.png`,
    );
    const seekSeconds = Math.max(
      0,
      Math.min(duration - 0.05, Number(window.startTime) + Number(window.duration) / 2),
    );
    await run(ffmpegCommand, [
      "-hide_banner",
      "-loglevel", "error",
      "-y",
      "-ss", seekSeconds.toFixed(3),
      "-i", candidatePath,
      "-frames:v", "1",
      outputPath,
    ]);
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size <= 0) {
      failures.push(`keyframe ${index + 1} is missing`);
    }
    keyframes.push({ sceneId, seekSeconds, path: outputPath });
  }
  const report = {
    passed: failures.length === 0,
    duration,
    durationReference: {
      targetSeconds,
      toleranceRatio: durationToleranceRatio,
      minimumSeconds: minimumDurationSeconds,
      maximumSeconds: maximumDurationSeconds,
      withinTargetTolerance: Number.isFinite(duration)
        && duration >= minimumDurationSeconds
        && duration <= maximumDurationSeconds,
    },
    video,
    audio,
    renderedAudio: {
      integratedLufs,
      truePeakDbfs,
      clipping,
    },
    projectAudioMix: browserResult.qualityMetrics?.audio_mix ?? {},
    keyframes,
    failures,
    warnings,
  };
  fs.writeFileSync(path.join(resultDir, "media-probe.json"), JSON.stringify(report, null, 2));
  if (failures.length > 0) throw new Error(`Formal MP4 contract failed: ${failures.join("; ")}`);
}

async function waitForManifestArtifact(timeoutMs = 20 * 60_000, signal) {
  const probeScript = [
    "import json, pathlib, sqlite3, sys, time",
    "timeout_at=time.monotonic() + (int(sys.argv[2]) / 1000)",
    "database_uri=pathlib.Path(sys.argv[1]).resolve().as_uri() + '?mode=ro'",
    "while time.monotonic() < timeout_at:",
    " try:",
    "  with sqlite3.connect(database_uri, uri=True, timeout=0.05) as connection:",
    "   row=connection.execute(\"select metadata from content_assets where content_type='video_project' order by id desc limit 1\").fetchone()",
    "  metadata=json.loads(row[0] or '{}') if row else {}",
    "  artifacts=metadata.get('pipeline_artifacts') or {}",
    "  if isinstance(artifacts.get('asset_manifest'), dict):",
    "   print('ready', flush=True)",
    "   raise SystemExit(0)",
    " except (OSError, sqlite3.Error, json.JSONDecodeError):",
    "  pass",
    " time.sleep(0.05)",
    "print('wait', flush=True)",
  ].join("\n");
  if (signal && signal.aborted) throw new Error("Manifest polling aborted");
  const { stdout } = await run(pythonCommand, ["-c", probeScript, databasePath, String(timeoutMs)], {
    cwd: backendRoot,
    signal,
  });
  if (stdout.trim() === "ready") return;
  throw new Error("Timed out waiting for persisted asset_manifest before interruption");
}

async function recoverInterruptedVideoJob(
  backendEnv,
  { requireMainResume = true } = {},
) {
  const recoveryScript = [
    "import json",
    "from app.config import get_settings",
    "from app.db import SessionLocal",
    "from app.models import VideoRenderJob",
    "from app.services.video_job_dispatch import dispatch_video_job",
    "from app.services.video_project_recovery import recover_video_project_jobs",
    "settings=get_settings()",
    "def dispatch(job_id):",
    " with SessionLocal() as dispatch_db:",
    "  job=dispatch_db.get(VideoRenderJob, job_id)",
    "  assert job is not None, f'recovered video job {job_id} is missing'",
    "  dispatch_video_job(dispatch_db, job, settings)",
    "with SessionLocal() as db:",
    " result=recover_video_project_jobs(db, dispatch=dispatch, stale_after_seconds=1)",
    "print(json.dumps(result, ensure_ascii=False))",
    "assert result.get('dispatch_failed') == 0, result",
    ...(requireMainResume
      ? [
          "assert result.get('resume_queued') == 1, result",
          "assert result.get('dispatched') >= 1, result",
        ]
      : []),
  ].join("\n");
  const { stdout } = await run(pythonCommand, ["-c", recoveryScript], {
    cwd: backendRoot,
    env: backendEnv,
    stdout: process.stdout,
    stderr: process.stderr,
  });
  const resultLine = stdout.trim().split(/\r?\n/).at(-1) ?? "{}";
  const result = JSON.parse(resultLine);
  fs.writeFileSync(
    path.join(resultDir, "worker-recovery-result.json"),
    JSON.stringify(result, null, 2),
  );
}

async function readRetainedVideoJob(backendEnv) {
  const script = [
    "import json",
    "from app.db import SessionLocal",
    "from app.models import User, VideoRenderJob",
    "with SessionLocal() as db:",
    " job=db.query(VideoRenderJob).filter(VideoRenderJob.public_id.like(\"video-job-%\")).order_by(VideoRenderJob.id.desc()).first()",
    " assert job is not None, 'no retained video job'",
    " user=db.get(User, job.user_id)",
    " assert user is not None, 'retained video job user is missing'",
    " payload=dict(job.result_payload or {})",
    " failure=dict(payload.get('failure') or {})",
    " result={'publicId': job.public_id, 'status': job.status, 'renderStage': job.render_stage, 'retryable': bool(failure.get('retryable') or payload.get('retryable')), 'email': user.email}",
    "print(json.dumps(result, ensure_ascii=False))",
  ].join("\n");
  const { stdout } = await run(pythonCommand, ["-c", script], {
    cwd: backendRoot,
    env: backendEnv,
  });
  return JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
}

async function rehydrateRetainedSourceExcerpt(backendEnv) {
  const script = [
    "import hashlib, json, pathlib, sys",
    "from app.config import get_settings",
    "from app.db import SessionLocal",
    "from app.models import ContentAsset",
    "from app.services.storage import ArtifactStore, artifact_key_from_ref",
    "from app.services.video_studio.project import segments_from_conversation_scenes",
    "from app.services.video_studio.source_clip import prepare_source_clip_artifacts",
    "source_path=pathlib.Path(sys.argv[1]).resolve()",
    "run_id=sys.argv[2]",
    "assert source_path.is_file(), 'source excerpt resume input is missing'",
    "settings=get_settings()",
    "store=ArtifactStore(settings)",
    "local_size=source_path.stat().st_size",
    "digest=hashlib.sha256()",
    "with source_path.open('rb') as handle:",
    " for block in iter(lambda: handle.read(1024 * 1024), b''): digest.update(block)",
    "local_hash=digest.hexdigest().casefold()",
    "with SessionLocal() as db:",
    " sources=db.query(ContentAsset).filter(ContentAsset.content_type == 'long_form_video_source').all()",
    " assert len(sources) == 1, 'source excerpt resume requires one retained source'",
    " source=sources[0]",
    " originals=[item for item in source.files if item.file_role == 'original']",
    " assert len(originals) == 1, 'source excerpt resume requires one retained original'",
    " original=originals[0]",
    " ref=str(original.storage_ref or '')",
    " expected_size=int(original.size_bytes or 0)",
    " expected_hash=str(original.content_hash or source.content_hash or '').removeprefix('sha256:').casefold()",
    " assert local_size == expected_size, 'source excerpt resume size changed'",
    " assert local_hash == expected_hash, 'source excerpt resume fingerprint changed'",
    " key=artifact_key_from_ref(ref, require_value=True)",
    " namespace=f'e2e/video-pipeline-production/{run_id}/'",
    " assert key.startswith(namespace), 'source excerpt resume ref left the isolated run namespace'",
    " status='already_present'",
    " try:",
    "  stat=store.stat(ref)",
    "  assert stat.size_bytes == expected_size, 'source excerpt resume remote size changed'",
    " except Exception as exc:",
    "  if 'nosuchkey' not in str(exc).casefold(): raise",
    "  restored_ref=store.put_file_at(key, source_path, str(original.mime_type or 'video/mp4'))",
    "  assert restored_ref == ref, 'source excerpt resume changed the retained storage ref'",
    "  assert store.stat(ref).size_bytes == expected_size, 'source excerpt resume upload is incomplete'",
    "  status='rehydrated'",
    " projects=db.query(ContentAsset).filter(ContentAsset.content_type == 'video_project').all()",
    " assert len(projects) == 1, 'source excerpt resume requires one retained video project'",
    " metadata=dict(projects[0].metadata_json or {})",
    " scenes=metadata.get('video_segments') or []",
    " assert isinstance(scenes, list) and scenes, 'retained video project has no video segments'",
    " project=metadata.get('video_project') or {}",
    " orchestration=project.get('orchestration') or {}",
    " source_clip_outcomes=orchestration.get('source_clip_outcomes') or []",
    " assert isinstance(source_clip_outcomes, list) and source_clip_outcomes, 'retained project has no source clip outcomes'",
    " expected={str(item.get('segment_id') or ''): item for item in source_clip_outcomes if isinstance(item, dict)}",
    " artifacts=prepare_source_clip_artifacts(settings, db=db, store=store, user_id=source.user_id, segments=segments_from_conversation_scenes(scenes))",
    " assert set(artifacts) == set(expected), 'rehydrated source clip segment set changed'",
    " for segment_id, artifact in artifacts.items():",
    "  outcome=expected[segment_id]",
    "  assert artifact.source_asset_id == outcome.get('source_asset_id'), 'source clip asset changed during resume'",
    "  assert artifact.source_fingerprint == outcome.get('source_fingerprint'), 'source clip fingerprint changed during resume'",
    "  assert artifact.source_ref == outcome.get('source_ref'), 'source clip source ref changed during resume'",
    "  assert artifact.audio_ref == outcome.get('audio_ref'), 'source clip audio ref changed during resume'",
    "  assert abs(artifact.start_seconds - float(outcome.get('start_seconds') or 0)) <= 0.02, 'source clip start changed during resume'",
    "  assert abs(artifact.end_seconds - float(outcome.get('end_seconds') or 0)) <= 0.02, 'source clip end changed during resume'",
    "  assert store.stat(artifact.audio_ref).size_bytes > 0, 'rehydrated source clip audio is empty'",
    " result={'status': status, 'source_asset_id': source.id, 'size_bytes': expected_size, 'source_clip_artifacts_rehydrated': len(artifacts)}",
    "print(json.dumps(result))",
  ].join("\n");
  const { stdout } = await run(
    pythonCommand,
    ["-c", script, sourceExcerptVideo, runId],
    { cwd: backendRoot, env: backendEnv },
  );
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
  fs.writeFileSync(
    path.join(resultDir, "source-excerpt-resume-rehydration.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

async function authenticateRetainedVideoUser(job) {
  const response = await fetch(`http://127.0.0.1:${backendPort}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: job.email,
      password: "local-video-pipeline-2026",
    }),
  });
  if (!response.ok) {
    throw new Error(`Retained video user login failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  if (!payload.access_token) throw new Error("Retained video user login returned no token");
  return payload.access_token;
}

async function waitForRetainedVideoJob(job, accessToken) {
  const deadline = Date.now() + videoJobTimeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(
      `http://127.0.0.1:${backendPort}/v1/video/jobs/${job.publicId}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!response.ok) {
      throw new Error(`Retained video job read failed: ${response.status} ${await response.text()}`);
    }
    const current = await response.json();
    if (current.status === "completed" && current.project_ready === true) return current;
    if (current.status === "failed") {
      throw new Error(`Retained video job failed again: ${JSON.stringify(current)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for retained video job ${job.publicId}`);
}

async function resumeRetainedVideoJob(backendEnv) {
  const job = await readRetainedVideoJob(backendEnv);
  const accessToken = await authenticateRetainedVideoUser(job);
  let mode;
  let completed;
  if (job.status === "completed" && job.renderStage === "done") {
    mode = "already_completed";
    await recoverInterruptedVideoJob(backendEnv, { requireMainResume: false });
    completed = await waitForRetainedVideoJob(job, accessToken);
  } else if (job.status === "failed") {
    const response = await fetch(
      `http://127.0.0.1:${backendPort}/v1/video/jobs/${job.publicId}/retry`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${accessToken}` },
      },
    );
    if (!response.ok) {
      throw new Error(`Retained video job retry failed: ${response.status} ${await response.text()}`);
    }
    mode = "failed_retry";
    completed = await waitForRetainedVideoJob(job, accessToken);
  } else {
    await recoverInterruptedVideoJob(backendEnv);
    mode = "interrupted_resume";
    completed = await waitForRetainedVideoJob(job, accessToken);
  }
  fs.writeFileSync(
    path.join(resultDir, "worker-recovery-result.json"),
    `${JSON.stringify({ mode, job: completed }, null, 2)}\n`,
  );
  return completed;
}

function assertResumeManifest() {
  const manifestPath = path.join(resultDir, "run-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("Cannot resume: run-manifest.json is missing.");
  }
  const original = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const expected = {
    runId,
    videoType: expectedVideoType,
    targetRatio,
    targetSeconds,
    expectedSceneCount,
    sourceDocument: sourceDocumentFingerprint,
    sourceExcerptVideo: expectedVideoType === "source_excerpt" ? fingerprintFile(sourceExcerptVideo) : null,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(original[key]) !== JSON.stringify(value)) {
      throw new Error(`Cannot resume: retained run manifest differs at ${key}.`);
    }
  }
}

async function verifyResumedVideoJob(backendEnv) {
  const script = [
    "import json, os, sqlite3",
    "database_path = os.environ['MULTIMIX_DATABASE_URL'].removeprefix('sqlite:///')",
    "connection = sqlite3.connect(database_path)",
    "connection.row_factory = sqlite3.Row",
    "row = connection.execute(\"SELECT status, render_stage, attempts, error_message FROM video_render_jobs WHERE public_id LIKE 'video-job-%' ORDER BY id DESC LIMIT 1\").fetchone()",
    "connection.close()",
    "assert row is not None, 'no retained video job'",
    "result = dict(row)",
    "assert result['status'] == 'completed', result",
    "assert result['render_stage'] == 'done', result",
    "print(json.dumps(result, ensure_ascii=False))",
  ].join("\n");
  const { stdout } = await run(pythonCommand, ["-c", script], { cwd: backendRoot, env: backendEnv });
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
  fs.writeFileSync(path.join(resultDir, "resume-verification.json"), `${JSON.stringify(result, null, 2)}\n`);
}

async function readRetainedExportSeed(backendEnv) {
  const script = [
    "import json",
    "from app.db import SessionLocal",
    "from app.models import AssetConversation, ContentAsset, User, VideoRenderJob",
    "with SessionLocal() as db:",
    " job=db.query(VideoRenderJob).filter(VideoRenderJob.public_id.like(\"video-job-%\")).order_by(VideoRenderJob.id.desc()).first()",
    " assert job is not None and job.status == 'completed' and job.render_stage == 'done', 'retained video job is not completed'",
    " assert job.conversation_id, 'retained export requires a conversation'",
    " user=db.get(User, job.user_id)",
    " asset=db.get(ContentAsset, job.asset_id)",
    " conversation=db.get(AssetConversation, job.conversation_id)",
    " assert user is not None and asset is not None and conversation is not None, 'retained export identity is missing'",
    " assert asset.user_id == job.user_id and conversation.user_id == job.user_id, 'retained export identity ownership mismatch'",
    " assert conversation.public_id, 'retained export conversation public identity is missing'",
    " metadata=dict(asset.metadata_json or {})",
    " plan=dict(metadata.get('video_plan') or {})",
    " scenes=[item for item in (plan.get('scenes') or []) if isinstance(item, dict)]",
    " assert scenes, 'retained export requires project scenes'",
    " result={'email': user.email, 'conversationId': conversation.public_id, 'projectAssetId': asset.id, 'videoJobId': job.public_id, 'expectedSceneCount': len(scenes)}",
    "print(json.dumps(result, ensure_ascii=False))",
  ].join("\n");
  const { stdout } = await run(pythonCommand, ["-c", script], {
    cwd: backendRoot,
    env: backendEnv,
  });
  const seed = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) ?? "{}");
  fs.writeFileSync(
    path.join(resultDir, "retained-export-seed.json"),
    `${JSON.stringify(seed, null, 2)}\n`,
  );
  return {
    ...seed,
    backendUrl: `http://127.0.0.1:${backendPort}`,
    password: "local-video-pipeline-2026",
    resultDir,
    targetSeconds,
    minimumDurationSeconds,
    maximumDurationSeconds,
    ratio: targetRatio,
  };
}

async function writeQaReport() {
  const resultPath = path.join(resultDir, "browser-result.json");
  if (!fs.existsSync(resultPath)) return;
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const candidateVideoExists = fs.existsSync(path.join(resultDir, "multimix-candidate.mp4"));
  const errors = Array.isArray(result.consoleErrors) ? result.consoleErrors : [];
  const requestFailures = Array.isArray(result.requestFailures) ? result.requestFailures : [];
  const actionableRequestFailures = requestFailures.filter((failure) => failure?.error !== "net::ERR_ABORTED");
  const otherRefsStable = Object.entries(result.beforeRefs ?? {})
    .filter(([sceneId]) => sceneId !== result.targetSegmentId)
    .every(([sceneId, ref]) => result.afterRefs?.[sceneId] === ref);
  const resumeReuse = result.resumeReuse === true;
  const health = errors.length === 0 && actionableRequestFailures.length === 0 && otherRefsStable
    ? 100
    : Math.max(0, 100 - errors.length * 5 - actionableRequestFailures.length * 5 - (otherRefsStable ? 0 : 40));
  const recomposeResult = result.recomposeTested === true
    ? (otherRefsStable ? "通过" : "失败")
    : "不适用（当前模式不支持两阶段单镜重做证据）";
  const behaviorFailures = [];
  if (!expectBgm && result.audioFinishing?.bgmEnabled !== false) {
    behaviorFailures.push("no_bgm_disabled_state_missing");
  }
  if (!expectBgm && !result.audioFinishing?.bgmSelectionReason) {
    behaviorFailures.push("no_bgm_selection_reason_missing");
  }
  const report = `# 视频流水线浏览器验收\n\n`
    + `> Status: qa\n> Owner: workspace\n> Last verified: ${new Date().toISOString().slice(0, 10)}\n\n`
    + `## 结果\n\n- 流水线模式：${result.twoStageEnabled === true ? "两阶段开启" : "两阶段关闭"}\n- 健康评分：${health}/100\n- ${expectedSceneCount} 镜主轨：通过\n- 待补素材：未出现\n`
    + `- 公共素材正式采用：${Number(result.sourceMix?.public_asset ?? 0)} 个${requirePublicAsset ? "（本场景必需）" : ""}\n`
    + `- 单镜重做未改动其他分镜：${recomposeResult}\n- 正式导出候选 MP4：${candidateVideoExists ? "通过" : "缺失"}\n- 浏览器 console error：${errors.length}\n- 浏览器失败请求：${requestFailures.length}\n- 可行动失败请求：${actionableRequestFailures.length}\n\n`
    + `## 证据\n\n- 候选成片：multimix-candidate.mp4\n- 页面截图：video-pipeline-ready.png\n- 状态快照：browser-result.json\n- 后端日志：backend.log\n- 前端日志：frontend.log\n`
    + `- 分镜关键帧：keyframes/keyframe-*.png\n\n`
    + `## 覆盖范围\n\n- 本测试证明真实上传、对话、确认、worker、${expectedSceneCount} 镜落库和正式导出链路。\n`;
  fs.writeFileSync(path.join(resultDir, "qa-report.md"), report);
  const evaluationReport = {
    twoStageEnabled: result.twoStageEnabled === true,
    assetManifestCoverage: result.assetManifestCoverage,
    publicCandidateOnlyCount: result.publicCandidateOnlyCount,
    manifestProjectReferenceMatch: result.manifestProjectReferenceMatch,
    sourceMix: result.sourceMix,
    sendBacks: result.sendBacks ?? 0,
    resumeReuse,
    internalTermsVisible: result.internalTermsVisible,
    consoleErrors: errors.length,
    actionableRequestFailures: actionableRequestFailures.length,
  };
  fs.writeFileSync(
    path.join(resultDir, "pipeline-evaluation-report.json"),
    JSON.stringify(evaluationReport, null, 2),
  );
  if (result.twoStageEnabled === true) {
    fs.writeFileSync(
      path.join(resultDir, "two-stage-evaluation-report.json"),
      JSON.stringify(evaluationReport, null, 2),
    );
  }
  const mediaProbePath = path.join(resultDir, "media-probe.json");
  const mediaProbe = fs.existsSync(mediaProbePath)
    ? JSON.parse(fs.readFileSync(mediaProbePath, "utf8"))
    : {};
  const hardFailures = [
    ...(Array.isArray(mediaProbe.failures) ? mediaProbe.failures : []),
    ...behaviorFailures,
  ];
  fs.writeFileSync(
    path.join(resultDir, "benchmark-report.json"),
    JSON.stringify({
      caseId: "video_pipeline_multimix_pdf_promo_60s_v1",
      targetSeconds,
      durationContract: {
        toleranceRatio: durationToleranceRatio,
        minimumSeconds: minimumDurationSeconds,
        maximumSeconds: maximumDurationSeconds,
      },
      sourceDocument: sourceDocumentFingerprint,
      candidateVideo: fingerprintFile(path.join(resultDir, "multimix-candidate.mp4")),
      hardFailures,
      automationPassed:
        mediaProbe.passed === true
        && actionableRequestFailures.length === 0
        && hardFailures.length === 0,
    }, null, 2),
  );
}

async function exportDecisionEvents() {
  if (!decisionAuditEnv) return;
  const outputPath = path.join(resultDir, "decision-events.json");
  const script = [
    "import json, os, sqlite3",
    "database_url = os.environ['MULTIMIX_DATABASE_URL']",
    "database_path = database_url.removeprefix('sqlite:///')",
    "connection = sqlite3.connect(database_path)",
    "connection.row_factory = sqlite3.Row",
    "try:",
    "    rows = connection.execute('SELECT * FROM video_decision_events ORDER BY id ASC').fetchall()",
    "except sqlite3.OperationalError:",
    "    rows = []",
    "finally:",
    "    connection.close()",
    "print(json.dumps([dict(row) for row in rows], ensure_ascii=False, default=str))",
  ].join("\n");
  const { stdout } = await run(pythonCommand, ["-c", script], {
    cwd: backendRoot,
    env: decisionAuditEnv,
  });
  fs.writeFileSync(outputPath, `${stdout.trim() || "[]"}\n`);
}

repairNextGeneratedTypeReferences(frontendRoot);
const workspaceSnapshots = snapshotFiles([
  path.join(frontendRoot, "next-env.d.ts"),
  path.join(frontendRoot, "tsconfig.json"),
]);

let runError;
try {
  lifecycle.record("environment", isResume ? "resume_starting" : "starting", {
    backendPort,
    frontendPort,
    visionPort: usesExternalVisionService ? null : visionPort,
  });
  if (
    inputProfile !== "explainer_saved_library_simple"
    && !fs.existsSync(sourceDocument)
  ) {
    throw new Error(`Source document not found: ${sourceDocument}`);
  }
  if (!fs.existsSync(backendRoot)) throw new Error(`Backend worktree not found: ${backendRoot}`);
  if (!fs.existsSync(pythonCommand)) throw new Error(`Python interpreter not found: ${pythonCommand}`);
  fs.mkdirSync(resultDir, { recursive: true });
  if (isResume) {
    assertResumeManifest();
  } else {
    for (const generatedName of ["browser-result.json", "qa-report.md", "video-pipeline-ready.png", "multimix-candidate.mp4", "keyframes"]) {
      fs.rmSync(path.join(resultDir, generatedName), { recursive: true, force: true });
    }
  }
  fs.mkdirSync(artifactDir, { recursive: true });
  const stagedBgm = !isResume && expectBgm ? stageBgmCatalogIfAvailable() : null;
  if (expectBgm && stagedBgm === null) {
    expectBgm = false;
    console.log("BGM unavailable: no active local catalog with media and license evidence; continuing without BGM.");
  }
  const effectiveBgm = stagedBgm ?? { manifestRef: "", defaultCatalogId: "" };
  const productMediaManifestRef = (
    isResume || inputProfile === "explainer_saved_library_simple"
  )
    ? ""
    : stageApprovedProductMediaCatalog();
  console.log(`Video pipeline E2E temp database: ${databasePath}`);
  console.log(`Video pipeline E2E temp artifacts: ${artifactDir}`);
  console.log(
    `Video pipeline E2E ports: backend ${backendPort}, `
    + `frontend ${frontendPort}, vision ${
      usesExternalVisionService ? visionServiceUrl : visionPort
    }`,
  );
  console.log(`Video pipeline E2E results: ${resultDir}`);
  console.log("Cleanup: child processes, SQLite sidecars, temp artifacts, and isolated Next build are removed in finally.");
  await assertPortFree(backendPort);
  await assertPortFree(frontendPort);
  if (!usesExternalVisionService) await assertPortFree(visionPort);

  const providerProxyHosts = ["www.pexels.com", "videos.pexels.com", "images.pexels.com"];
  providerProxy = await startProviderEgressProxy(providerProxyHosts);

  const llmOverride = {
    baseUrl: process.env.MULTIMIX_LLM_BASE_URL?.trim() || null,
    apiKey: process.env.MULTIMIX_LLM_API_KEY?.trim() || null,
    model: process.env.MULTIMIX_LLM_MODEL?.trim() || null,
  };
  const llmOverrideCount = Object.values(llmOverride).filter(Boolean).length;
  if (llmOverrideCount !== 0 && llmOverrideCount !== 3) {
    throw new Error(
      "MULTIMIX_LLM_BASE_URL, MULTIMIX_LLM_API_KEY, and MULTIMIX_LLM_MODEL "
      + "must be supplied together for a production E2E provider override",
    );
  }
  const effectiveLlmConfig = llmOverrideCount === 3
    ? llmOverride
    : {
        baseUrl: canonicalEnv.MULTIMIX_LLM_BASE_URL
          ?? canonicalEnv.MULTIMIX_DEEPSEEK_BASE_URL
          ?? (canonicalEnv.MULTIMIX_DEEPSEEK_API_KEY
            ? "https://api.deepseek.com/v1"
            : null),
        apiKey: canonicalEnv.MULTIMIX_LLM_API_KEY
          ?? canonicalEnv.MULTIMIX_DEEPSEEK_API_KEY
          ?? null,
        model: canonicalEnv.MULTIMIX_LLM_MODEL
          ?? canonicalEnv.MULTIMIX_DEEPSEEK_MODEL
          ?? null,
      };
  if (!isResume) {
    fs.writeFileSync(path.join(resultDir, "run-manifest.json"), JSON.stringify({
      runId,
      videoType: expectedVideoType,
      activeVideoTypes,
      inputProfile,
      targetRatio,
      expectedOutputSize,
      twoStageEnabled,
      targetSeconds,
      expectedSceneCount,
      videoJobTimeoutMs,
      durationToleranceRatio,
      durationContract: {
        minimumSeconds: minimumDurationSeconds,
        maximumSeconds: maximumDurationSeconds,
      },
      sourceDocument: sourceDocumentFingerprint,
      sourceExcerptVideo: expectedVideoType === "source_excerpt" ? fingerprintFile(sourceExcerptVideo) : null,
      visionServiceUrl,
      productMedia: configuredInputFingerprints(process.env.VIDEO_PIPELINE_PRODUCT_MEDIA_FILES),
      demonstrationMedia: configuredInputFingerprints(demonstrationMediaFiles),
      llm: {
        baseUrl: effectiveLlmConfig.baseUrl,
        model: effectiveLlmConfig.model,
        processOverride: llmOverrideCount === 3,
      },
    }, null, 2));
  }
  const databaseUrl = `sqlite:///${databasePath.replaceAll("\\", "/")}`;
  const sourceExcerptRemoteStorage = expectedVideoType === "source_excerpt";
  const remoteWriteLedgerPath = path.join(lifecycle.runDir, "remote-artifact-writes.ndjson");
  const backendEnv = {
    ...process.env,
    ...canonicalEnv,
    MULTIMIX_ENV: "local",
    MULTIMIX_AUTH_PROVIDER: "local",
    MULTIMIX_AUTH_EMAIL_VERIFICATION_REQUIRED: "false",
    MULTIMIX_DATABASE_URL: databaseUrl,
    MULTIMIX_ARTIFACT_DIR: artifactDir,
    MULTIMIX_SUPABASE_URL: sourceExcerptRemoteStorage
      ? (canonicalEnv.MULTIMIX_SUPABASE_URL ?? canonicalEnv.SUPABASE_URL ?? "")
      : "",
    MULTIMIX_SUPABASE_PUBLISHABLE_KEY: "",
    MULTIMIX_SUPABASE_ANON_KEY: "",
    MULTIMIX_SUPABASE_SERVICE_ROLE_KEY: sourceExcerptRemoteStorage
      ? (canonicalEnv.MULTIMIX_SUPABASE_SERVICE_ROLE_KEY ?? canonicalEnv.SUPABASE_SERVICE_ROLE_KEY ?? "")
      : "",
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "",
    MULTIMIX_S3_ENDPOINT_URL: sourceExcerptRemoteStorage
      ? (canonicalEnv.MULTIMIX_S3_ENDPOINT_URL ?? "")
      : "",
    MULTIMIX_S3_ACCESS_KEY: sourceExcerptRemoteStorage
      ? (canonicalEnv.MULTIMIX_S3_ACCESS_KEY ?? "")
      : "",
    MULTIMIX_S3_SECRET_KEY: sourceExcerptRemoteStorage
      ? (canonicalEnv.MULTIMIX_S3_SECRET_KEY ?? "")
      : "",
    MULTIMIX_S3_BUCKET: canonicalEnv.MULTIMIX_S3_BUCKET ?? "multimix-artifacts",
    MULTIMIX_ARTIFACT_KEY_PREFIX: sourceExcerptRemoteStorage
      ? `e2e/video-pipeline-production/${runId}`
      : "",
    ...(sourceExcerptRemoteStorage
      ? { MULTIMIX_ARTIFACT_WRITE_LEDGER_PATH: remoteWriteLedgerPath }
      : {}),
    MULTIMIX_VIDEO_DECISION_RUN_KIND: "test",
    MULTIMIX_TEST_LLM_SNAPSHOT_DIR: path.join(artifactDir, "llm-requests"),
    MULTIMIX_ASSET_GENERATION_QUEUE_ENABLED: "true",
    MULTIMIX_REDIS_URL: "redis://127.0.0.1:6398/15",
    MULTIMIX_LLM_BASE_URL: effectiveLlmConfig.baseUrl ?? "",
    MULTIMIX_LLM_API_KEY: effectiveLlmConfig.apiKey ?? "",
    MULTIMIX_LLM_MODEL: effectiveLlmConfig.model ?? "",
    MULTIMIX_LLM_TIMEOUT_SECONDS: "120",
    MULTIMIX_QWEN_FALLBACK_ENABLED: canonicalEnv.MULTIMIX_QWEN_FALLBACK_ENABLED ?? "",
    MULTIMIX_QWEN_FALLBACK_BASE_URL: canonicalEnv.MULTIMIX_QWEN_FALLBACK_BASE_URL ?? "",
    MULTIMIX_QWEN_FALLBACK_API_KEY: canonicalEnv.MULTIMIX_QWEN_FALLBACK_API_KEY ?? "",
    MULTIMIX_QWEN_FALLBACK_MODEL: canonicalEnv.MULTIMIX_QWEN_FALLBACK_MODEL ?? "",
    MULTIMIX_VIDEO_ORCHESTRATION_INLINE: "true",
    MULTIMIX_MULTIMIX_VIDEO_PIPELINE_PROVIDER_PROXY_DNS_ENABLED: "true",
    MULTIMIX_MULTIMIX_VIDEO_PIPELINE_PROVIDER_PROXY_HOSTS: providerProxyHosts.join(","),
    MULTIMIX_MULTIMIX_VIDEO_PIPELINE_PROVIDER_HTTPS_PROXY: `http://127.0.0.1:${providerProxy.port}`,
    MULTIMIX_VIDEO_BGM_MANIFEST_REF: effectiveBgm.manifestRef,
    MULTIMIX_VIDEO_BGM_DEFAULT_CATALOG_ID: effectiveBgm.defaultCatalogId,
    MULTIMIX_VISION_SERVICE_URL: visionServiceUrl,
    MULTIMIX_VISION_TIMEOUT_SECONDS: "120",
    MULTIMIX_VIDEO_VOICE_TO_MUSIC_RATIO: "4.0",
    MULTIMIX_VIDEO_AUDIO_MIX_RATIO_TOLERANCE: "0.15",
    MULTIMIX_VIDEO_PRODUCT_MEDIA_MANIFEST_REF: productMediaManifestRef,
    MULTIMIX_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
  };
  if (!sourceExcerptRemoteStorage) delete backendEnv.MULTIMIX_ARTIFACT_WRITE_LEDGER_PATH;
  decisionAuditEnv = backendEnv;
  const nextDistDir = `.next-video-pipeline-${runId}`;
  const frontendEnv = {
    ...process.env,
    NEXT_DEV_DIST_DIR: nextDistDir,
    NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${backendPort}`,
    NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    VIDEO_PIPELINE_AUDIO_MIX_RATIO_TOLERANCE: "0.15",
  };

  await lifecycle.measure("schema_initialization", () => run(
    pythonCommand,
    ["-c", "from app.db import create_schema; create_schema()"],
    {
      cwd: backendRoot,
      env: backendEnv,
      stdout: process.stdout,
      stderr: process.stderr,
    },
  ));
  if (isResume) {
    await restoreCheckpointedRemoteArtifacts(backendEnv);
  }
  let vision;
  await lifecycle.measure("vision_service_startup", async () => {
    if (!usesExternalVisionService) {
      vision = startProcess(
        pythonCommand,
        [
          "-m",
          "uvicorn",
          "vision_service.app:app",
          "--host",
          "127.0.0.1",
          "--port",
          String(visionPort),
        ],
        backendRoot,
        {
          ...process.env,
          ...canonicalEnv,
          VISION_PROVIDER: "qwen",
          VISION_QWEN_API_KEY: effectiveVisionApiKey,
          VISION_QWEN_BASE_URL: effectiveVisionBaseUrl,
          VISION_QWEN_MODEL: effectiveVisionModel,
          VISION_QWEN_TIMEOUT_SECONDS: "120",
          VISION_REMOTE_HTTPS_PROXY: `http://127.0.0.1:${providerProxy.port}`,
          VISION_REMOTE_PROXY_HOSTS: providerProxyHosts.join(","),
        },
        "vision.log",
      );
    }
    await waitFor(`${visionServiceUrl}/health`, vision, 120_000);
  });
  let backend;
  await lifecycle.measure("backend_startup", async () => {
    backend = startProcess(
      pythonCommand,
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
      backendRoot,
      backendEnv,
      "backend.log",
    );
    await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend, 120_000);
  });
  if (isResume) {
    if (expectedVideoType === "source_excerpt") {
      await rehydrateRetainedSourceExcerpt(backendEnv);
    }
    await resumeRetainedVideoJob(backendEnv);
    await verifyResumedVideoJob(backendEnv);
    lifecycle.record("worker", "resumed_and_verified");
    const retainedExportSeed = await readRetainedExportSeed(backendEnv);
    await lifecycle.measure("frontend_startup", async () => {
      const frontend = startProcess(
        npmCommand,
        ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
        frontendRoot,
        frontendEnv,
        "frontend.log",
      );
      await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, frontend, 180_000);
    });
    await lifecycle.measure("playwright", () => run(
      npxCommand,
      ["playwright", "test", "e2e/video-pipeline-retained-export.spec.ts", "--workers=1"],
      {
        cwd: frontendRoot,
        env: {
          ...frontendEnv,
          PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
          PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright-retained-export"),
          VIDEO_PIPELINE_RETAINED_EXPORT_SEED: JSON.stringify(retainedExportSeed),
        },
        stdout: process.stdout,
        stderr: process.stderr,
      },
    ));
    await lifecycle.measure("candidate_video_verification", () => verifyCandidateVideo());
    await lifecycle.measure("qa_report", () => writeQaReport());
    lifecycle.record("playwright", "passed");
  } else {
    await lifecycle.measure("frontend_startup", async () => {
      const frontend = startProcess(
        npmCommand,
        ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
        frontendRoot,
        frontendEnv,
        "frontend.log",
      );
      await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, frontend, 180_000);
    });
    const playwrightRun = lifecycle.measure("playwright", () => run(npxCommand, ["playwright", "test", "e2e/video-pipeline-production.spec.ts", "--workers=1"], {
    cwd: frontendRoot,
    env: {
      ...frontendEnv,
      PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
      PLAYWRIGHT_OUTPUT_DIR: path.join(resultDir, "playwright"),
      VIDEO_PIPELINE_SOURCE_DOCUMENT: sourceDocument,
      VIDEO_PIPELINE_SOURCE_EXCERPT_VIDEO: sourceExcerptVideo,
      VIDEO_PIPELINE_RESULT_DIR: resultDir,
      VIDEO_PIPELINE_TARGET_SECONDS: String(targetSeconds),
      VIDEO_PIPELINE_RATIO: targetRatio,
      VIDEO_PIPELINE_DURATION_TOLERANCE: String(durationToleranceRatio),
      VIDEO_PIPELINE_EXPECTED_SCENE_COUNT: String(expectedSceneCount),
      VIDEO_PIPELINE_VIDEO_JOB_TIMEOUT_MS: String(videoJobTimeoutMs),
      VIDEO_PIPELINE_VIDEO_TYPE: expectedVideoType,
      VIDEO_PIPELINE_INPUT_PROFILE: inputProfile,
      VIDEO_PIPELINE_REQUIRE_PUBLIC_ASSET: requirePublicAsset ? "true" : "false",
      VIDEO_PIPELINE_DEMONSTRATION_MEDIA_FILES: demonstrationMediaFiles,
      VIDEO_PIPELINE_EXPECT_RESUME: interruptAfterManifest ? "true" : "false",
      VIDEO_PIPELINE_TEST_RECOMPOSE: testRecompose ? "true" : "false",
      VIDEO_PIPELINE_EXPECT_TWO_STAGE: twoStageEnabled ? "true" : "false",
      VIDEO_PIPELINE_EXPECT_BGM: expectBgm ? "true" : "false",
      VIDEO_PIPELINE_TIMING_PATH: playwrightTimingPath,
    },
    stdout: process.stdout,
    stderr: process.stderr,
    }));
    playwrightRun.catch(() => undefined);
    if (interruptAfterManifest) {
    const manifestAbort = new AbortController();
    const manifestWait = waitForManifestArtifact(20 * 60_000, manifestAbort.signal);
    try {
      await Promise.race([
        manifestWait,
        playwrightRun.then(() => {
          throw new Error("Playwright finished before asset_manifest publication");
        }),
      ]);
    } catch (error) {
      manifestAbort.abort();
      await manifestWait.catch(() => undefined);
      throw error;
    }
    manifestAbort.abort();
    await stopChild(backend);
    backend = startProcess(
      pythonCommand,
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)],
      backendRoot,
      backendEnv,
      "backend-restarted.log",
    );
    await waitFor(`http://127.0.0.1:${backendPort}/healthz`, backend, 120_000);
      await recoverInterruptedVideoJob(backendEnv);
    }
    await playwrightRun;
    await lifecycle.measure("candidate_video_verification", () => verifyCandidateVideo());
    await lifecycle.measure("qa_report", () => writeQaReport());
    lifecycle.record("playwright", "passed");
  }
} catch (error) {
  runError = error;
  lifecycle.record("run", "failed", { errorName: error?.name ?? "Error" });
  throw error;
} finally {
  for (const { child } of children.reverse()) await stopChild(child);
  for (const { log } of children) log.end();
  let cleanupError;
  if (decisionAuditEnv) {
    try {
      await checkpointRemoteArtifactWrites(decisionAuditEnv);
      await cleanupRemoteArtifactWrites(decisionAuditEnv);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (providerProxy) await providerProxy.close();
  try {
    await exportDecisionEvents();
  } catch (error) {
    cleanupError ??= error;
  }
  restoreFiles(workspaceSnapshots);
  try {
    fs.rmSync(path.join(frontendRoot, `.next-video-pipeline-${runId}`), { recursive: true, force: true });
  } catch (error) {
    cleanupError ??= error;
  }
  lifecycle.finish(runError || cleanupError ? "failed_retained" : "passed_pending_cleanup", {
    retainedForConfirmation: true,
    resumeSupported: true,
  });
  const timingSummary = lifecycle.timingSummary();
  if (timingSummary.length > 0) {
    console.log("E2E stage timings (slowest first):");
    for (const item of timingSummary) {
      console.log(`  ${item.stage}: ${(item.duration_ms / 1000).toFixed(1)}s (${item.status})`);
    }
    console.log(`E2E stage timing ledger: ${lifecycle.ledgerPath}`);
  }
  const browserTimingSummary = readTimingSummary(playwrightTimingPath);
  const directorSubstageSummary = browserTimingSummary.filter((item) => item.stage.startsWith("director_phase_"));
  const directorSceneSummary = browserTimingSummary.filter((item) => item.stage.startsWith("director_scene_"));
  const browserPipelineSummary = browserTimingSummary.filter((item) => !item.stage.startsWith("director_phase_") && !item.stage.startsWith("director_scene_"));
  if (browserPipelineSummary.length > 0) {
    console.log("Browser pipeline timings (slowest first):");
    for (const item of browserPipelineSummary) {
      console.log(`  ${item.stage}: ${(item.duration_ms / 1000).toFixed(1)}s (${item.status})`);
    }
  }
  if (directorSubstageSummary.length > 0) {
    console.log("Director substage timings (slowest first):");
    for (const item of directorSubstageSummary) {
      console.log(`  ${item.stage}: ${(item.duration_ms / 1000).toFixed(1)}s (${item.status})`);
    }
  }
  if (directorSceneSummary.length > 0) {
    console.log("Director per-scene timings (slowest first):");
    for (const item of directorSceneSummary) {
      console.log(`  ${item.stage}: ${(item.duration_ms / 1000).toFixed(1)}s (${item.status})`);
    }
  }
  if (browserTimingSummary.length > 0) {
    console.log(`Browser timing ledger: ${playwrightTimingPath}`);
  }
  console.log(`E2E runtime retained: ${lifecycle.runDir}. Confirm cleanup with npm run test:e2e:cleanup-run -- video-pipeline-production/${runId} --confirm`);
  if (cleanupError) throw cleanupError;
}
