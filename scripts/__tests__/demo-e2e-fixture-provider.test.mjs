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

test("fixture provider returns structured LLY-44 source-resolution responses", async (t) => {
  const provider = await createFixtureProvider({ port: 0 });
  t.after(() => provider.close());
  const complete = async (system, content) => {
    const response = await fetch(`${provider.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [
        { role: "system", content: system },
        { role: "user", content: `${content} LLY44_BROWSER_FIXTURE` },
      ] }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    return JSON.parse(payload.choices[0].message.content);
  };

  const intent = await complete(
    "You classify a Chinese content-creation assistant user's message",
    "用施工花絮做一条门窗宣传视频",
  );
  assert.equal(intent.operation, "derive");
  assert.equal(intent.has_provided_source, true);

  const reference = await complete(
    "Determine whether the user explicitly refers to one existing source",
    "用品牌主视觉做一条门窗宣传视频",
  );
  assert.equal(reference.reference_intent, "explicit_reference");
  assert.equal(reference.reference_text, "品牌主视觉");

  const ambiguous = await complete(
    "Ground the user's explicit source reference to only the supplied candidate IDs",
    '{"asset_id":41,"title":"施工花絮 A"},{"asset_id":42,"title":"施工花絮 B"}',
  );
  assert.deepEqual(ambiguous, {
    status: "ambiguous",
    selected_asset_id: null,
    candidate_ids: [41, 42],
    reason: "multiple_identity_matches",
  });
});
