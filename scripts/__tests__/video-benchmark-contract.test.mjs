import assert from "node:assert/strict";
import test from "node:test";

import {
  bindVideoBenchmarkRun,
  canonicalSha256,
  verifySameInputAb,
  validateVideoBenchmarkCase,
} from "../video-benchmark-contract.mjs";

const benchmarkCase = {
  schema_version: "video-benchmark-case:v2",
  case_id: "operation_explainer_v2",
  benchmark_level: "technical_baseline",
  scenario_family: "operation_explainer",
  evaluation_mode: "production_e2e",
  execution: {
    video_type: "explainer",
    input_profile: "saved_library",
    ratio: "16:9",
    target_seconds: 30,
  },
  source_contract: {
    document_required: true,
    asset_roles: ["screen_recording"],
    preserve_source_audio: false,
  },
};

test("benchmark case fingerprint is canonical and mutation-sensitive", () => {
  const validated = validateVideoBenchmarkCase(benchmarkCase);
  assert.equal(
    canonicalSha256({ b: 2, a: { 二: 2, 一: 1 } }),
    canonicalSha256({ a: { 一: 1, 二: 2 }, b: 2 }),
  );
  assert.equal(
    canonicalSha256({ b: 2, a: { 二: 2, 一: 1 } }),
    "d0c735bd4e82e46e6f86a1f615e214ab7ee3496ef3fef90c7800c1b3092786fd",
  );
  assert.equal(canonicalSha256({ coverage: 1.0 }), canonicalSha256({ coverage: 1 }));
  assert.notEqual(
    canonicalSha256(validated),
    canonicalSha256({
      ...validated,
      execution: { ...validated.execution, target_seconds: 31 },
    }),
  );
});

test("bound benchmark rejects execution drift and records exact identities", () => {
  assert.throws(
    () => bindVideoBenchmarkRun({
      benchmarkCase,
      execution: { ...benchmarkCase.execution, ratio: "9:16" },
      sourceDocumentSha256: "a".repeat(64),
      sourceAssetSha256s: ["b".repeat(64)],
      generationInstructionSha256: "c".repeat(64),
    }),
    /execution mismatch/i,
  );

  const binding = bindVideoBenchmarkRun({
    benchmarkCase,
    execution: benchmarkCase.execution,
    sourceDocumentSha256: "a".repeat(64),
    sourceAssetSha256s: ["b".repeat(64)],
    generationInstructionSha256: "c".repeat(64),
    candidateVideoSha256: "d".repeat(64),
  });
  assert.equal(binding.status, "bound");
  assert.equal(binding.case_id, benchmarkCase.case_id);
  assert.equal(binding.case_fingerprint, canonicalSha256(benchmarkCase));
  assert.equal(binding.benchmark_level, "technical_baseline");
  assert.equal(binding.scenario_family, "operation_explainer");
  assert.equal(binding.input_fingerprint, canonicalSha256(binding.inputs));
});

test("same-input A/B requires matching case, input, and reference candidate", () => {
  const binding = bindVideoBenchmarkRun({
    benchmarkCase,
    execution: benchmarkCase.execution,
    sourceDocumentSha256: "a".repeat(64),
    sourceAssetSha256s: ["b".repeat(64)],
    generationInstructionSha256: "c".repeat(64),
    candidateVideoSha256: "d".repeat(64),
    referenceVideoSha256: "e".repeat(64),
  });
  const referenceReview = {
    schema_version: "rendered-human-review:v1",
    benchmark: {
      case_fingerprint: binding.case_fingerprint,
      input_fingerprint: binding.input_fingerprint,
    },
    candidate: { sha256: "e".repeat(64) },
  };

  assert.equal(verifySameInputAb(binding, referenceReview).status, "same_input_verified");
  assert.throws(
    () => verifySameInputAb(binding, {
      ...referenceReview,
      benchmark: { ...referenceReview.benchmark, input_fingerprint: "f".repeat(64) },
    }),
    /input fingerprint/i,
  );
});
