import fs from "node:fs";
import { pathToFileURL } from "node:url";

const LEVEL_RANK = Object.freeze({ L1: 1, L2: 2, L3: 3, L4: 4 });
const CLAIM_RANK = Object.freeze({
  focused: 1,
  "related-regression": 2,
  "checkpoint-to-output": 3,
  "full-e2e": 4,
});

function requireText(value, field) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function requireCommands(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("commands must contain at least one executed or planned command");
  }
  return value.map((command, index) => requireText(command, `commands[${index}]`));
}

function validateExternalCalls(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("externalCalls must be an object");
  }
  if (!Number.isInteger(value.expectedMax) || value.expectedMax < 1) {
    throw new Error("externalCalls.expectedMax must be a positive integer");
  }
  return {
    expectedMax: value.expectedMax,
    reason: requireText(value.reason, "externalCalls.reason"),
  };
}

export function validateTestScopeRecord(record) {
  if (record == null || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("test scope record must be an object");
  }

  const level = requireText(record.level, "level").toUpperCase();
  if (!(level in LEVEL_RANK)) {
    throw new Error(`level must be one of ${Object.keys(LEVEL_RANK).join(", ")}`);
  }

  const evidenceClaim = requireText(record.evidenceClaim, "evidenceClaim");
  if (!(evidenceClaim in CLAIM_RANK)) {
    throw new Error(`evidenceClaim must be one of ${Object.keys(CLAIM_RANK).join(", ")}`);
  }
  if (CLAIM_RANK[evidenceClaim] > LEVEL_RANK[level]) {
    throw new Error(`evidenceClaim ${evidenceClaim} exceeds ${level} evidence`);
  }

  const normalized = {
    level,
    changeScope: requireText(record.changeScope, "changeScope"),
    evidenceClaim,
    commands: requireCommands(record.commands),
    paid: false,
  };

  if (level === "L3") {
    normalized.changedStage = requireText(record.changedStage, "changedStage");
    const checkpoint = record.checkpoint;
    if (checkpoint == null || typeof checkpoint !== "object" || Array.isArray(checkpoint)) {
      throw new Error("checkpoint.id must identify the reused run or artifact");
    }
    normalized.checkpoint = {
      id: requireText(checkpoint.id, "checkpoint.id"),
      invalidationBoundary: requireText(
        checkpoint.invalidationBoundary,
        "checkpoint.invalidationBoundary",
      ),
      fallbackStage: requireText(checkpoint.fallbackStage, "checkpoint.fallbackStage"),
      fingerprintsVerified: checkpoint.fingerprintsVerified === true,
    };
    if (!normalized.checkpoint.fingerprintsVerified) {
      throw new Error("checkpoint.fingerprintsVerified must be true before reuse");
    }
  }

  if (level === "L4") {
    normalized.escalationReason = requireText(record.escalationReason, "escalationReason");
    normalized.acceptanceScenario = requireText(record.acceptanceScenario, "acceptanceScenario");
    normalized.whyL3Insufficient = requireText(record.whyL3Insufficient, "whyL3Insufficient");
  }

  const externalCalls = validateExternalCalls(record.externalCalls);
  if (level === "L4" && externalCalls == null) {
    throw new Error("externalCalls is required for L4 paid full-chain verification");
  }
  if (externalCalls != null) {
    normalized.externalCalls = externalCalls;
    normalized.paid = true;
  }

  return normalized;
}

function runCli() {
  const recordPath = process.argv[2];
  if (!recordPath || recordPath === "--help" || recordPath === "-h") {
    process.stdout.write("Usage: node scripts/test-scope-policy.mjs <record.json>\n");
    process.exitCode = recordPath ? 0 : 2;
    return;
  }

  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const normalized = validateTestScopeRecord(record);
  process.stdout.write(`${JSON.stringify(normalized, null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`Test scope record rejected: ${error.message}\n`);
    process.exitCode = 1;
  }
}
