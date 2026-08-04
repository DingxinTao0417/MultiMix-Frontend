import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const RUNTIME_ROOT = path.join(os.homedir(), "Desktop", "multimix-test-results", "e2e-runtime");
const RUN_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,119}$/;
const SUITE = /^[a-z][a-z0-9-]{0,79}$/;

function assertSegment(value, expression, label) {
  if (typeof value !== "string" || !expression.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function createStageTiming({ record, now = Date.now }) {
  const completed = [];

  async function measure(stage, operation, details = {}) {
    const startedAt = now();
    record(stage, "started", details);
    try {
      const result = await operation();
      const duration_ms = Math.max(0, now() - startedAt);
      const entry = { stage, status: "passed", duration_ms };
      completed.push(entry);
      record(stage, "passed", { ...details, duration_ms });
      return result;
    } catch (error) {
      const duration_ms = Math.max(0, now() - startedAt);
      const entry = { stage, status: "failed", duration_ms };
      completed.push(entry);
      record(stage, "failed", {
        ...details,
        duration_ms,
        errorName: error instanceof Error ? error.name : "Error",
      });
      throw error;
    }
  }

  function timingSummary() {
    return [...completed].sort((left, right) => right.duration_ms - left.duration_ms);
  }

  return { measure, timingSummary };
}

export function e2eRuntimeRoot() {
  return RUNTIME_ROOT;
}

export function createE2ERunLifecycle({ suite, runId = crypto.randomUUID(), resultDir, now }) {
  assertSegment(suite, SUITE, "suite");
  assertSegment(runId, RUN_ID, "run id");
  const runDir = path.join(RUNTIME_ROOT, suite, runId);
  const databasePath = path.join(runDir, "runtime.sqlite3");
  const artifactDir = path.join(runDir, "artifacts");
  const manifestPath = path.join(runDir, "run-state.json");
  const ledgerPath = path.join(runDir, "run-ledger.ndjson");
  let state;

  if (fs.existsSync(manifestPath)) {
    state = readJson(manifestPath);
    if (state.status !== "active") {
      throw new Error(`E2E run ${suite}/${runId} is ${state.status}; use a new run id or explicit cleanup.`);
    }
  } else {
    fs.mkdirSync(runDir, { recursive: true });
    state = {
      version: 1,
      suite,
      runId,
      status: "active",
      createdAt: new Date().toISOString(),
      resultDir: path.resolve(resultDir),
      databasePath,
      artifactDir,
    };
    writeJson(manifestPath, state);
  }

  function save() { writeJson(manifestPath, state); }
  function record(stage, status, details = {}) {
    const event = { at: new Date().toISOString(), stage, status, details };
    fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, "utf8");
  }
  const stageTiming = createStageTiming({ record, now });
  function finish(status, details = {}) {
    if (!["failed_retained", "passed_pending_cleanup"].includes(status)) {
      throw new Error(`Invalid E2E terminal status: ${status}`);
    }
    state = {
      ...state,
      status,
      finishedAt: new Date().toISOString(),
      timingSummary: stageTiming.timingSummary(),
      ...details,
    };
    save();
    record("run", status, details);
  }

  record("run", "started", { resultDir: state.resultDir });
  return {
    suite,
    runId,
    runDir,
    databasePath,
    artifactDir,
    manifestPath,
    ledgerPath,
    record,
    measure: stageTiming.measure,
    timingSummary: stageTiming.timingSummary,
    finish,
    readState: () => ({ ...state }),
  };
}

export function resumeRetainedE2ERunLifecycle({ suite, runId }) {
  assertSegment(suite, SUITE, "suite");
  assertSegment(runId, RUN_ID, "run id");
  const runDir = path.join(RUNTIME_ROOT, suite, runId);
  const manifestPath = path.join(runDir, "run-state.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Retained E2E run not found: ${suite}/${runId}`);
  const previous = readJson(manifestPath);
  if (previous.suite !== suite || previous.runId !== runId || previous.status !== "failed_retained") {
    throw new Error(`E2E run ${suite}/${runId} is not a failed retained run.`);
  }
  if (!fs.existsSync(previous.databasePath) || !fs.existsSync(previous.artifactDir)) {
    throw new Error(`E2E run ${suite}/${runId} is missing its retained SQLite or ArtifactStore.`);
  }
  const state = { ...previous, status: "active", resumedAt: new Date().toISOString() };
  writeJson(manifestPath, state);
  const ledgerPath = path.join(runDir, "run-ledger.ndjson");
  function record(stage, status, details = {}) {
    fs.appendFileSync(ledgerPath, `${JSON.stringify({ at: new Date().toISOString(), stage, status, details })}\n`, "utf8");
  }
  const stageTiming = createStageTiming({ record });
  function finish(status, details = {}) {
    if (!["failed_retained", "passed_pending_cleanup"].includes(status)) {
      throw new Error(`Invalid E2E terminal status: ${status}`);
    }
    const next = {
      ...state,
      status,
      finishedAt: new Date().toISOString(),
      timingSummary: stageTiming.timingSummary(),
      ...details,
    };
    writeJson(manifestPath, next);
    record("run", status, details);
  }
  record("run", "resumed");
  return {
    suite,
    runId,
    runDir,
    databasePath: state.databasePath,
    artifactDir: state.artifactDir,
    manifestPath,
    ledgerPath,
    record,
    measure: stageTiming.measure,
    timingSummary: stageTiming.timingSummary,
    finish,
    readState: () => ({ ...state }),
  };
}

export function listRetainedE2ERuns() {
  if (!fs.existsSync(RUNTIME_ROOT)) return [];
  return fs.readdirSync(RUNTIME_ROOT, { withFileTypes: true }).flatMap((suiteEntry) => {
    if (!suiteEntry.isDirectory() || !SUITE.test(suiteEntry.name)) return [];
    const suiteDir = path.join(RUNTIME_ROOT, suiteEntry.name);
    return fs.readdirSync(suiteDir, { withFileTypes: true }).flatMap((runEntry) => {
      if (!runEntry.isDirectory() || !RUN_ID.test(runEntry.name)) return [];
      const manifestPath = path.join(suiteDir, runEntry.name, "run-state.json");
      if (!fs.existsSync(manifestPath)) return [];
      try { return [readJson(manifestPath)]; } catch { return []; }
    });
  });
}

export function cleanupRetainedE2ERun({ suite, runId, confirmed }) {
  if (confirmed !== true) throw new Error("Refusing to delete E2E runtime without --confirm.");
  assertSegment(suite, SUITE, "suite");
  assertSegment(runId, RUN_ID, "run id");
  const runDir = path.join(RUNTIME_ROOT, suite, runId);
  const manifestPath = path.join(runDir, "run-state.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Retained E2E run not found: ${suite}/${runId}`);
  const state = readJson(manifestPath);
  if (state.suite !== suite || state.runId !== runId || !["failed_retained", "passed_pending_cleanup"].includes(state.status)) {
    throw new Error(`E2E run ${suite}/${runId} is not awaiting cleanup.`);
  }
  const receipt = { ...state, status: "cleanup_confirmed", cleanedAt: new Date().toISOString() };
  const receiptPath = path.join(path.dirname(runDir), `${runId}.cleanup-receipt.json`);
  writeJson(receiptPath, receipt);
  fs.rmSync(runDir, { recursive: true, force: false });
  return { runDir, receiptPath, databasePath: state.databasePath, artifactDir: state.artifactDir };
}
