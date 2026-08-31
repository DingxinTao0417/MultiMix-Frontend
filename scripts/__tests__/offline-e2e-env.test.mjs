import assert from "node:assert/strict";
import test from "node:test";

import {
  OFFLINE_E2E_CREDENTIAL_KEYS,
  createOfflineE2EEnv,
} from "../offline-e2e-env.mjs";

test("offline E2E environment clears every paid or production credential alias", () => {
  const source = Object.fromEntries(
    OFFLINE_E2E_CREDENTIAL_KEYS.map((key) => [key, `secret-${key}`]),
  );
  source.PATH = "preserved-path";

  const isolated = createOfflineE2EEnv(source);

  for (const key of OFFLINE_E2E_CREDENTIAL_KEYS) {
    assert.equal(isolated[key], "", `${key} must be cleared`);
    assert.equal(source[key], `secret-${key}`, `${key} source must not be mutated`);
  }
  assert.equal(isolated.PATH, "preserved-path");
});

test("offline E2E environment disables provider-backed fallbacks", () => {
  const isolated = createOfflineE2EEnv({
    MULTIMIX_QWEN_FALLBACK_ENABLED: "true",
    MULTIMIX_TTS_PROVIDER: "elevenlabs",
    VISION_PROVIDER: "qwen",
  });

  assert.equal(isolated.MULTIMIX_QWEN_FALLBACK_ENABLED, "false");
  assert.equal(isolated.MULTIMIX_TTS_PROVIDER, "");
  assert.equal(isolated.VISION_PROVIDER, "disabled");
});
