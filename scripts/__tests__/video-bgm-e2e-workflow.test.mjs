import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..", "..");

test("video BGM E2E runner isolates storage, ports, and cleanup", () => {
  const runnerPath = path.join(root, "scripts", "run-video-bgm-e2e.mjs");
  assert.equal(fs.existsSync(runnerPath), true, "runner must exist");
  const source = fs.readFileSync(runnerPath, "utf8");

  assert.match(source, /multimix-video-bgm-.*\.sqlite3/);
  assert.match(source, /multimix-video-bgm-artifacts-/);
  assert.match(source, /CHANGEIN_DATABASE_URL/);
  assert.match(source, /CHANGEIN_VIDEO_BGM_ENABLED:\s*"true"/);
  assert.match(source, /CHANGEIN_SUPABASE_URL:\s*""/);
  assert.match(source, /findFreePort/);
  assert.match(source, /FORBIDDEN_PORTS/);
  assert.match(source, /8199/);
  assert.match(source, /3117/);
  assert.match(source, /3200/);
  assert.match(source, /finally\s*\{/);
  assert.match(source, /safeRemoveRunDatabase/);
  assert.match(source, /fs\.rmSync\(artifactDir, \{ recursive: true, force: true \}\)/);
  assert.match(source, /video-orchestration.*e2e.*background\.png/);
});

test("video BGM E2E covers default, change, refresh, and both gain modes", () => {
  const specPath = path.join(root, "e2e", "video-bgm.spec.ts");
  assert.equal(fs.existsSync(specPath), true, "Playwright spec must exist");
  const source = fs.readFileSync(specPath, "utf8");

  assert.match(source, /背景音乐/);
  assert.match(source, /restore_auto/);
  assert.match(source, /page\.reload/);
  assert.match(source, /0\.18/);
  assert.match(source, /0\.5/);
  assert.match(source, /ffprobe/);
});

test("video BGM E2E seed creates an authoritative completed main render job", () => {
  const seedPath = path.resolve(root, "..", "MultiMix-Backend", "tools", "seed_video_bgm_e2e.py");
  assert.equal(fs.existsSync(seedPath), true, "backend seed helper must exist");
  const source = fs.readFileSync(seedPath, "utf8");

  assert.match(source, /adapter="railway_backend"/);
  assert.doesNotMatch(source, /adapter="local_e2e"/);
  assert.match(source, /status="completed"/);
  assert.match(source, /render_stage="done"/);
  assert.match(source, /local:\/\/video-orchestration\/e2e\/background\.png/);
  assert.doesNotMatch(source, /local:\/\/e2e\//);
});
