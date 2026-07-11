import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export function createRunPaths(prefix, runId) {
  return {
    databasePath: path.join(os.tmpdir(), `${prefix}-${runId}.sqlite3`),
    artifactDir: path.join(os.tmpdir(), `${prefix}-artifacts-${runId}`),
  };
}

export function safeRemoveRunDatabase(databasePath, runId) {
  const resolved = path.resolve(databasePath);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir())) throw new Error(`Database path is outside temp directory: ${resolved}`);
  if (!path.basename(resolved).includes(runId)) throw new Error(`Database path does not contain current run id: ${resolved}`);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(`${resolved}${suffix}`, { force: true });
}

export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Test port ${port} is already in use`)));
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

export async function waitFor(url, child, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child?.exitCode != null) throw new Error(`${url} process exited with ${child.exitCode}`);
    try { const response = await fetch(url); if (response.ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export function startLogged(command, args, { cwd, env, logPath }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const log = fs.createWriteStream(logPath, { flags: "w" });
  const child = spawn(command, args, { cwd, env, shell: process.platform === "win32" && command.endsWith(".cmd"), stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return { child, log };
}

export async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      killer.once("exit", resolve);
      killer.once("error", resolve);
    });
  } else {
    child.kill("SIGTERM");
  }
}
