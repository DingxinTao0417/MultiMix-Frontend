import assert from "node:assert/strict";
import test from "node:test";

import { validateTestScopeRecord } from "../test-scope-policy.mjs";

test("L1 accepts a focused offline verification record", () => {
  const result = validateTestScopeRecord({
    level: "L1",
    changeScope: "numeric fact parser",
    evidenceClaim: "focused",
    commands: ["pytest app/tests/test_numeric_facts.py"],
  });

  assert.equal(result.level, "L1");
  assert.equal(result.paid, false);
});

test("evidence claims cannot exceed the executed level", () => {
  assert.throws(
    () => validateTestScopeRecord({
      level: "L1",
      changeScope: "local mapper",
      evidenceClaim: "full-e2e",
      commands: ["node --test mapper.test.mjs"],
    }),
    /evidenceClaim.*exceeds L1/,
  );
});

test("L3 requires a verified checkpoint, invalidation boundary, and fallback", () => {
  assert.throws(
    () => validateTestScopeRecord({
      level: "L3",
      changeScope: "video render polling",
      evidenceClaim: "checkpoint-to-output",
      commands: ["npm run test:e2e:video-pipeline-resume -- run-123"],
      changedStage: "render",
    }),
    /checkpoint.id/,
  );

  const result = validateTestScopeRecord({
    level: "L3",
    changeScope: "video render polling",
    evidenceClaim: "checkpoint-to-output",
    commands: ["npm run test:e2e:video-pipeline-resume -- run-123"],
    changedStage: "render",
    checkpoint: {
      id: "run-123:director-approved",
      fingerprintsVerified: true,
      invalidationBoundary: "render",
      fallbackStage: "director",
    },
  });

  assert.equal(result.checkpoint.id, "run-123:director-approved");
});

test("L4 requires an escalation reason, acceptance scenario, and paid-call budget", () => {
  assert.throws(
    () => validateTestScopeRecord({
      level: "L4",
      changeScope: "cross-stage video contract",
      evidenceClaim: "full-e2e",
      commands: ["npm run test:e2e:video-pipeline-production"],
    }),
    /escalationReason/,
  );

  const result = validateTestScopeRecord({
    level: "L4",
    changeScope: "cross-stage video contract",
    evidenceClaim: "full-e2e",
    commands: ["npm run test:e2e:video-pipeline-production"],
    escalationReason: "director output schema changed across generation and render stages",
    acceptanceScenario: "idea to publishable video",
    whyL3Insufficient: "no compatible upstream checkpoint exists for the new schema",
    externalCalls: {
      expectedMax: 8,
      reason: "validate real provider schema and final render",
    },
  });

  assert.equal(result.paid, true);
});

test("any partial paid run records a call ceiling and reason", () => {
  assert.throws(
    () => validateTestScopeRecord({
      level: "L3",
      changeScope: "image generation stage",
      evidenceClaim: "checkpoint-to-output",
      commands: ["node scripts/resume-image-stage.mjs"],
      changedStage: "image-generation",
      checkpoint: {
        id: "run-456:director-approved",
        fingerprintsVerified: true,
        invalidationBoundary: "image-generation",
        fallbackStage: "director",
      },
      externalCalls: { expectedMax: 3 },
    }),
    /externalCalls.reason/,
  );
});
