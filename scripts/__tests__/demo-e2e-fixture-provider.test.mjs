import assert from "node:assert/strict";
import test from "node:test";

import { createFixtureProvider } from "../demo-e2e/fixture-provider.mjs";

test("fixture provider serves known vision fixtures and rejects unknown files", async (t) => {
  const provider = await createFixtureProvider({ port: 0 });
  t.after(() => provider.close());
  const health = await fetch(`${provider.url}/healthz`);
  assert.equal(health.status, 200);

  const known = await fetch(`${provider.url}/analyze/image`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "07_synthetic_kitchen_measurement_consultation.png" }) });
  assert.equal(known.status, 200);
  assert.match((await known.json()).caption, /厨房/);

  const unknown = await fetch(`${provider.url}/analyze/image`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "unknown.png" }) });
  assert.equal(unknown.status, 422);
});

test("fixture provider never sends an unknown LLM request to the network", async (t) => {
  const provider = await createFixtureProvider({ port: 0 });
  t.after(() => provider.close());
  const response = await fetch(`${provider.url}/v1/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "unregistered request" }] }) });
  assert.equal(response.status, 422);
  assert.match((await response.json()).fixture_key, /unregistered request/);
});
