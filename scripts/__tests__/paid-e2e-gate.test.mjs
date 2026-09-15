import assert from "node:assert/strict";
import test from "node:test";

import { assertPaidE2EAllowed } from "../paid-e2e-gate.mjs";

test("paid E2E rejects an implicit run before any provider work", () => {
  assert.throws(
    () => assertPaidE2EAllowed({ suite: "video-pipeline-production", env: {}, args: [] }),
    /MULTIMIX_ALLOW_PAID_E2E=true/,
  );
});

test("paid E2E requires the exact true opt-in", () => {
  assert.throws(
    () => assertPaidE2EAllowed({
      suite: "video-pipeline-production",
      env: { MULTIMIX_ALLOW_PAID_E2E: "1" },
      args: [],
    }),
    /MULTIMIX_ALLOW_PAID_E2E=true/,
  );
  assert.doesNotThrow(() => assertPaidE2EAllowed({
    suite: "video-pipeline-production",
    env: { MULTIMIX_ALLOW_PAID_E2E: "true" },
    args: [],
  }));
});

test("help output remains available without paid opt-in", () => {
  assert.doesNotThrow(() => assertPaidE2EAllowed({
    suite: "video-pipeline-production",
    env: {},
    args: ["--help"],
  }));
});

test("an explicitly enabled retained resume does not require a new paid opt-in", () => {
  assert.doesNotThrow(() => assertPaidE2EAllowed({
    suite: "video-pipeline-production",
    env: {},
    args: ["--resume", "retained-run-id"],
    allowRetainedResume: true,
  }));
});

test("retained resume exemption is caller-owned and requires a valid run ID", () => {
  assert.throws(
    () => assertPaidE2EAllowed({
      suite: "video-pipeline-production",
      env: {},
      args: ["--resume", "retained-run-id"],
    }),
    /MULTIMIX_ALLOW_PAID_E2E=true/,
  );
  for (const args of [["--resume"], ["--resume", "--other"]]) {
    assert.throws(
      () => assertPaidE2EAllowed({
        suite: "video-pipeline-production",
        env: {},
        args,
        allowRetainedResume: true,
      }),
      /MULTIMIX_ALLOW_PAID_E2E=true/,
    );
  }
});
