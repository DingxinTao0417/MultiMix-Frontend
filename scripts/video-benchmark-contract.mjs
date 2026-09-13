import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const VIDEO_BENCHMARK_CASE_VERSION = "video-benchmark-case:v2";
export const VIDEO_BENCHMARK_RUN_BINDING_VERSION = "video-benchmark-run-binding:v1";

const benchmarkLevels = new Set(["technical_baseline", "public_release_gold"]);
const scenarioFamilies = new Set([
  "document_explainer",
  "operation_explainer",
  "multi_video_montage",
  "presenter_source_audio",
]);
const evaluationModes = new Set(["offline_contract", "production_e2e"]);
const sha256Pattern = /^[a-f0-9]{64}$/;

function requiredText(value, field) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function requiredObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value;
}

function normalizeSha256(value, field, { required = false } = {}) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!normalized) {
    if (required) throw new Error(`${field} is required`);
    return null;
  }
  if (!sha256Pattern.test(normalized)) throw new Error(`${field} must be a SHA-256 hex digest`);
  return normalized;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

function caseDefinition(value) {
  return Object.fromEntries(
    Object.entries(requiredObject(value, "video benchmark case"))
      .filter(([key]) => key !== "case_fingerprint"),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

export function canonicalSha256(value) {
  return crypto.createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function validateVideoBenchmarkCase(value) {
  const benchmarkCase = stableValue(caseDefinition(value));
  if (benchmarkCase.schema_version !== VIDEO_BENCHMARK_CASE_VERSION) {
    throw new Error(`video benchmark case schema_version must be ${VIDEO_BENCHMARK_CASE_VERSION}`);
  }
  requiredText(benchmarkCase.case_id, "case_id");
  if (!benchmarkLevels.has(benchmarkCase.benchmark_level)) {
    throw new Error("benchmark_level must be technical_baseline or public_release_gold");
  }
  if (!scenarioFamilies.has(benchmarkCase.scenario_family)) {
    throw new Error("scenario_family is not a supported positive acceptance family");
  }
  if (!evaluationModes.has(benchmarkCase.evaluation_mode)) {
    throw new Error("evaluation_mode must be offline_contract or production_e2e");
  }
  const execution = requiredObject(benchmarkCase.execution, "execution");
  ["video_type", "input_profile", "ratio"].forEach((field) => requiredText(execution[field], `execution.${field}`));
  if (typeof execution.target_seconds !== "number" || !Number.isFinite(execution.target_seconds) || execution.target_seconds <= 0) {
    throw new Error("execution.target_seconds must be positive");
  }
  const sourceContract = requiredObject(benchmarkCase.source_contract, "source_contract");
  if (typeof sourceContract.document_required !== "boolean") {
    throw new Error("source_contract.document_required must be boolean");
  }
  if (typeof sourceContract.preserve_source_audio !== "boolean") {
    throw new Error("source_contract.preserve_source_audio must be boolean");
  }
  if (!Array.isArray(sourceContract.asset_roles) || sourceContract.asset_roles.some((role) => typeof role !== "string" || !role.trim())) {
    throw new Error("source_contract.asset_roles must be a string array");
  }
  return benchmarkCase;
}

export function loadVideoBenchmarkCase({ backendRoot, filename }) {
  const plainFilename = requiredText(filename, "video benchmark case filename");
  if (path.basename(plainFilename) !== plainFilename || path.extname(plainFilename).toLowerCase() !== ".json") {
    throw new Error("video benchmark case must be a plain JSON filename");
  }
  const casePath = path.join(path.resolve(backendRoot), "evals", "cases", plainFilename);
  if (!fs.existsSync(casePath) || !fs.statSync(casePath).isFile()) {
    throw new Error(`missing video benchmark case: ${casePath}`);
  }
  const benchmarkCase = validateVideoBenchmarkCase(JSON.parse(fs.readFileSync(casePath, "utf8")));
  return { ...benchmarkCase, case_fingerprint: canonicalSha256(benchmarkCase) };
}

export function assertVideoBenchmarkExecution(rawCase, execution) {
  const benchmarkCase = validateVideoBenchmarkCase(rawCase);
  if (canonicalJson(execution) !== canonicalJson(benchmarkCase.execution)) {
    throw new Error("video benchmark execution mismatch");
  }
  return execution;
}

export function unboundVideoBenchmarkRun(rawCase = null, reason = "benchmark_case_not_provided") {
  const benchmarkCase = rawCase ? validateVideoBenchmarkCase(rawCase) : null;
  return {
    schema_version: VIDEO_BENCHMARK_RUN_BINDING_VERSION,
    status: "unbound",
    reason,
    case_id: benchmarkCase?.case_id ?? null,
    case_fingerprint: benchmarkCase ? canonicalSha256(benchmarkCase) : null,
    benchmark_level: benchmarkCase?.benchmark_level ?? null,
    scenario_family: benchmarkCase?.scenario_family ?? null,
    input_fingerprint: null,
    inputs: null,
    candidate_video_sha256: null,
    reference_video_sha256: null,
  };
}

export function bindVideoBenchmarkRun({
  benchmarkCase: rawCase,
  execution,
  sourceDocumentSha256,
  sourceAssetSha256s = [],
  generationInstructionSha256,
  candidateVideoSha256,
  referenceVideoSha256,
}) {
  const benchmarkCase = validateVideoBenchmarkCase(rawCase);
  if (canonicalJson(execution) !== canonicalJson(benchmarkCase.execution)) {
    throw new Error("video benchmark execution mismatch");
  }
  const inputs = {
    execution: stableValue(execution),
    source_document_sha256: normalizeSha256(
      sourceDocumentSha256,
      "source_document_sha256",
      { required: benchmarkCase.source_contract.document_required },
    ),
    source_asset_sha256s: sourceAssetSha256s.map((value, index) => normalizeSha256(
      value,
      `source_asset_sha256s[${index}]`,
      { required: true },
    )),
    generation_instruction_sha256: normalizeSha256(
      generationInstructionSha256,
      "generation_instruction_sha256",
      { required: true },
    ),
  };
  if (inputs.source_asset_sha256s.length < benchmarkCase.source_contract.asset_roles.length) {
    throw new Error("source asset identities do not satisfy source_contract.asset_roles");
  }
  return {
    schema_version: VIDEO_BENCHMARK_RUN_BINDING_VERSION,
    status: "bound",
    case_id: benchmarkCase.case_id,
    case_fingerprint: canonicalSha256(benchmarkCase),
    benchmark_level: benchmarkCase.benchmark_level,
    scenario_family: benchmarkCase.scenario_family,
    input_fingerprint: canonicalSha256(inputs),
    inputs,
    candidate_video_sha256: normalizeSha256(candidateVideoSha256, "candidate_video_sha256"),
    reference_video_sha256: normalizeSha256(referenceVideoSha256, "reference_video_sha256"),
  };
}

export function verifySameInputAb(candidateBinding, referenceReview) {
  const candidate = requiredObject(candidateBinding, "candidate benchmark binding");
  if (candidate.status !== "bound") {
    throw new Error("same-input A/B candidate binding must be bound");
  }
  const reference = requiredObject(referenceReview, "reference human review");
  if (reference.schema_version !== "rendered-human-review:v1") {
    throw new Error("same-input A/B reference must be rendered-human-review:v1");
  }
  const referenceBenchmark = requiredObject(reference.benchmark, "reference benchmark");
  const referenceCandidate = requiredObject(reference.candidate, "reference candidate");
  if (referenceBenchmark.case_fingerprint !== candidate.case_fingerprint) {
    throw new Error("same-input A/B case fingerprint mismatch");
  }
  if (referenceBenchmark.input_fingerprint !== candidate.input_fingerprint) {
    throw new Error("same-input A/B input fingerprint mismatch");
  }
  const referenceVideoSha256 = normalizeSha256(
    referenceCandidate.sha256,
    "reference candidate sha256",
    { required: true },
  );
  if (referenceVideoSha256 !== candidate.reference_video_sha256) {
    throw new Error("same-input A/B reference candidate fingerprint mismatch");
  }
  return {
    status: "same_input_verified",
    case_fingerprint: candidate.case_fingerprint,
    input_fingerprint: candidate.input_fingerprint,
    reference_video_sha256: referenceVideoSha256,
    candidate_video_sha256: candidate.candidate_video_sha256 ?? null,
  };
}
