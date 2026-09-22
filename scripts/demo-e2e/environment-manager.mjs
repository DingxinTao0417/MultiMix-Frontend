import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    fs.rmSync(`${resolved}${suffix}`, {
      force: true,
      recursive: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
}

export async function safeRemoveRunDatabaseWithRetries(
  databasePath,
  runId,
  { attempts = 10, retryDelay = 250 } = {},
) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      safeRemoveRunDatabase(databasePath, runId);
      return;
    } catch (error) {
      lastError = error;
      if (!["EBUSY", "EPERM"].includes(error?.code) || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  throw lastError;
}

export function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", () => reject(new Error(`Test port ${port} is already in use`)));
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => server.close(resolve));
  });
}

export async function waitForPortFree(
  port,
  { timeoutMs = 30_000, intervalMs = 250, assertFree = assertPortFree } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      await assertFree(port);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
  throw lastError ?? new Error(`Timed out waiting for test port ${port} to become free`);
}

export function listeningPidsForPort(port) {
  const result = process.platform === "win32"
    ? spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true })
    : spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      windowsHide: true,
    });
  if (result.error) {
    throw new Error(`Cannot inspect test port ${port}: ${result.error.message}`);
  }
  if (process.platform !== "win32") {
    if (result.status === 1) return [];
    if (result.status !== 0) {
      throw new Error(`Cannot inspect test port ${port}: lsof exited ${result.status}`);
    }
    return [...new Set(
      String(result.stdout ?? "").split(/\s+/).map(Number).filter(Number.isInteger),
    )];
  }
  if (result.status !== 0) {
    throw new Error(`Cannot inspect test port ${port}: netstat exited ${result.status}`);
  }
  const listener = new RegExp(
    `^\\s*TCP\\s+\\S+:${port}\\s+\\S+\\s+LISTENING\\s+(\\d+)\\s*$`,
    "i",
  );
  return [...new Set(
    String(result.stdout ?? "").split(/\r?\n/)
      .map((line) => line.match(listener)?.[1])
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger),
  )];
}

function processTable() {
  const result = process.platform === "win32"
    ? spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-CimInstance Win32_Process | Select-Object -Property ProcessId,ParentProcessId | ConvertTo-Json -Compress",
      ],
      { encoding: "utf8", windowsHide: true },
    )
    : spawnSync("ps", ["-eo", "pid=,ppid="], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exited ${result.status}`;
    throw new Error(`Cannot inspect test process tree: ${reason}`);
  }
  if (process.platform === "win32") {
    const parsed = JSON.parse(String(result.stdout ?? "[]").trim() || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).map((item) => ({
      pid: Number(item?.ProcessId),
      parentPid: Number(item?.ParentProcessId),
    })).filter((item) => Number.isInteger(item.pid) && Number.isInteger(item.parentPid));
  }
  return String(result.stdout ?? "").split(/\r?\n/).map((line) => {
    const [pid, parentPid] = line.trim().split(/\s+/).map(Number);
    return { pid, parentPid };
  }).filter((item) => Number.isInteger(item.pid) && Number.isInteger(item.parentPid));
}

export function processTreePids(rootPid, { processes = processTable } = {}) {
  if (!Number.isInteger(rootPid) || rootPid <= 0) {
    throw new Error("Test process tree requires a positive root PID");
  }
  const childrenByParent = new Map();
  for (const { pid, parentPid } of processes()) {
    const children = childrenByParent.get(parentPid) ?? [];
    children.push(pid);
    childrenByParent.set(parentPid, children);
  }
  const descendants = new Set([rootPid]);
  const pending = [rootPid];
  while (pending.length > 0) {
    const parentPid = pending.pop();
    for (const childPid of childrenByParent.get(parentPid) ?? []) {
      if (descendants.has(childPid)) continue;
      descendants.add(childPid);
      pending.push(childPid);
    }
  }
  return descendants;
}

export function assertPortOwnedByChild(
  port,
  child,
  {
    listeningPids = listeningPidsForPort,
    processTreePids: expectedProcessTreePids = processTreePids,
  } = {},
) {
  if (!Number.isInteger(child?.pid) || child.pid <= 0) {
    throw new Error(`Test port ${port} cannot be verified because the started child has no PID`);
  }
  const pids = listeningPids(port);
  if (pids.length !== 1) {
    throw new Error(
      `Test port ${port} must have exactly one listener after startup; observed: ${pids.join(", ") || "none"}`,
    );
  }
  const ownedPids = expectedProcessTreePids(child.pid);
  if (!ownedPids.has(pids[0])) {
    throw new Error(
      `Test port ${port} listener PID ${pids[0]} does not belong to expected child process tree rooted at PID ${child.pid}`,
    );
  }
  return { port, rootPid: child.pid, listenerPid: pids[0] };
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
