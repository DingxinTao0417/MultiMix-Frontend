import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { startLogged, stopChild, waitFor } from "./demo-e2e/environment-manager.mjs";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const backendRoot = process.env.MULTIMIX_BACKEND_ROOT
  ? path.resolve(process.env.MULTIMIX_BACKEND_ROOT)
  : path.resolve(frontendRoot, "..", "MultiMix-Backend");
const npmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
const npmCommand = process.platform === "win32" ? process.execPath : "npm";
const npmPrefixArgs = process.platform === "win32" ? [npmCli] : [];
if (process.platform === "win32" && !fs.existsSync(npmCli)) {
  throw new Error(`npm CLI not found beside Node: ${npmCli}`);
}
const pythonCandidates = [
  process.env.MULTIMIX_PYTHON,
  path.join(backendRoot, ".venv", "Scripts", "python.exe"),
  path.resolve(backendRoot, "..", "..", ".venv", "Scripts", "python.exe"),
  process.env.PYTHON,
  "python",
].filter(Boolean);
const python = pythonCandidates.find((candidate) => (
  candidate === "python" || fs.existsSync(candidate)
));
if (!python) throw new Error("A MultiMix backend Python interpreter is required");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
  const child = spawn(command, args, {
      stdio: "inherit",
      ...options,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

const requestedRunId = process.env.MULTIMIX_E2E_RUN_ID?.replaceAll(/[^a-zA-Z0-9]/g, "");
const runId = requestedRunId || crypto.randomUUID().replaceAll("-", "");
const nextDistDir = `.next-long-form-e2e-${runId}`;
const frontendLog = path.join(os.tmpdir(), `multimix-long-form-browser-${runId}.log`);
const backendDatabase = path.join(os.tmpdir(), `multimix-${runId}.sqlite3`);
const frontendSnapshots = ["next-env.d.ts", "tsconfig.json"].map((relativePath) => {
  const filePath = path.join(frontendRoot, relativePath);
  return {
    filePath,
    existed: fs.existsSync(filePath),
    contents: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null,
  };
});
const backendEnv = {
  ...process.env,
  MULTIMIX_TEST_DATABASE_URL: "",
  MULTIMIX_TEST_DATABASE_PATH: backendDatabase,
  MULTIMIX_SUPABASE_URL: "",
  MULTIMIX_SUPABASE_SERVICE_ROLE_KEY: "",
  MULTIMIX_S3_ENDPOINT_URL: "",
};

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function restoreFrontendSnapshots() {
  for (const snapshot of frontendSnapshots) {
    if (snapshot.existed) fs.writeFileSync(snapshot.filePath, snapshot.contents);
    else fs.rmSync(snapshot.filePath, { force: true });
  }
}

function cleanupBackendDatabase() {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    fs.rmSync(`${backendDatabase}${suffix}`, { force: true });
  }
}

let started;
try {
  await run(
    python,
    [
      "-m",
      "pytest",
      "app/tests/test_source_clip_media_integration.py",
      "app/tests/test_long_form_api.py",
      "app/tests/test_long_form_conversation.py",
      "app/tests/test_long_form_generation_job.py",
      "app/tests/test_video_project_consistency.py",
      "app/tests/test_video_project_confirmation.py",
      "-q",
    ],
    { cwd: backendRoot, env: backendEnv },
  );

  await run(python, ["-m", "ruff", "check", "app", "vision_service"], {
    cwd: backendRoot,
    env: backendEnv,
  });

  await run(
    npmCommand,
    [
      ...npmPrefixArgs,
      "test",
      "--",
      "--run",
      "app/assets/__tests__/long-form-library-entry.test.tsx",
      "app/assets/__tests__/chat-video-attachment-routing.test.ts",
      "app/assets/__tests__/chat-video-attachment-rejection.test.tsx",
      "app/assets/__tests__/long-form-candidate-set.test.tsx",
      "app/assets/__tests__/long-form-client.test.ts",
      "app/assets/__tests__/chat-attachment-policy.test.ts",
      "app/assets/__tests__/asset-workspace-adapter.test.ts",
    ],
    { cwd: frontendRoot, env: process.env },
  );

  await run(npmCommand, [...npmPrefixArgs, "run", "typecheck"], { cwd: frontendRoot, env: process.env });
  await run(npmCommand, [...npmPrefixArgs, "run", "lint"], { cwd: frontendRoot, env: process.env });
  await run(npmCommand, [...npmPrefixArgs, "run", "check:video-preview-contract"], {
    cwd: frontendRoot,
    env: process.env,
  });
  await run(npmCommand, [...npmPrefixArgs, "run", "test:product-stage-style"], {
    cwd: frontendRoot,
    env: process.env,
  });

  const frontendPort = await findFreePort();
  if ([3117, 3200].includes(frontendPort)) throw new Error("Browser E2E selected a protected development port");
  const frontendEnv = {
    ...process.env,
    NEXT_DEV_DIST_DIR: nextDistDir,
    NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:9",
    NEXT_PUBLIC_MULTIMIX_AUTH_MODE: "local",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
  };
  started = startLogged(
    npmCommand,
    [...npmPrefixArgs, "run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(frontendPort)],
    { cwd: frontendRoot, env: frontendEnv, logPath: frontendLog },
  );
  console.log(`Long-form browser E2E frontend port: ${frontendPort}`);
  console.log(`Backend pytest database: ${backendDatabase}`);
  console.log("Browser API calls use Playwright route fixtures.");
  await waitFor(`http://127.0.0.1:${frontendPort}/app/assets`, started.child, 180_000);
  await run(
    npmCommand,
    [...npmPrefixArgs, "exec", "--", "playwright", "test", "e2e/long-form-repurpose.spec.ts", "--workers=1"],
    {
      cwd: frontendRoot,
      env: {
        ...frontendEnv,
        PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${frontendPort}`,
        PLAYWRIGHT_OUTPUT_DIR: path.join(os.tmpdir(), `multimix-long-form-playwright-${runId}`),
      },
    },
  );
} catch (error) {
  if (fs.existsSync(frontendLog)) process.stderr.write(fs.readFileSync(frontendLog, "utf8"));
  throw error;
} finally {
  if (started) {
    await stopChild(started.child);
    started.log.end();
  }
  fs.rmSync(path.join(frontendRoot, nextDistDir), { recursive: true, force: true });
  fs.rmSync(path.join(os.tmpdir(), `multimix-long-form-playwright-${runId}`), { recursive: true, force: true });
  fs.rmSync(frontendLog, { force: true });
  cleanupBackendDatabase();
  restoreFrontendSnapshots();
}

console.log("Long-form repurposing cross-layer acceptance passed.");
