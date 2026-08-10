import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { expect, test, type Page } from "@playwright/test";

type Seed = {
  email: string;
  password: string;
  narrated_asset_id: number;
  no_narration_asset_id: number;
  narrated_default_track_id: string;
  narrated_default_title: string;
  narrated_default_frequency: number;
  narrated_alternate_track_id: string;
  narrated_alternate_title: string;
  narrated_alternate_frequency: number;
  no_narration_default_track_id: string;
  no_narration_default_title: string;
  no_narration_default_frequency: number;
};

type ProjectResponse = {
  project: {
    metadata: { bgm_choice?: { catalog_id?: string; selected_by?: string; enabled?: boolean } };
    mp4_state?: string;
    mp4_ref?: string;
    tracks: Array<{
      id: string;
      elements: Array<{
        startTime?: number;
        volume?: number;
        animations?: {
          channels?: {
            volume?: { keyframes?: Array<{ time?: number; value?: number }> };
          };
        };
      }>;
    }>;
  };
};

const backendUrl = process.env.BGM_E2E_BACKEND_URL;
const resultDir = process.env.BGM_E2E_RESULT_DIR;
const artifactDir = process.env.BGM_E2E_ARTIFACT_DIR;
const seed = JSON.parse(process.env.BGM_E2E_SEED ?? "null") as Seed | null;

async function authenticate(page: Page): Promise<string> {
  if (!backendUrl || !seed) throw new Error("BGM E2E environment is missing");
  const response = await page.request.post(`${backendUrl}/v1/auth/login`, {
    data: { email: seed.email, password: seed.password },
  });
  expect(response.ok(), `login failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Local login returned no access token");
  await page.addInitScript((token) => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ token }));
  }, body.access_token);
  return body.access_token;
}

async function readProject(page: Page, assetId: number, token: string): Promise<ProjectResponse> {
  if (!backendUrl) throw new Error("BGM_E2E_BACKEND_URL is missing");
  const response = await page.request.get(`${backendUrl}/v1/video/projects/${assetId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `project load failed: ${response.status()}`).toBe(true);
  return response.json() as Promise<ProjectResponse>;
}

async function updateBgm(
  page: Page,
  assetId: number,
  token: string,
  data: { action: "disable" | "select" | "restore_auto"; catalog_id?: string },
) {
  if (!backendUrl) throw new Error("BGM_E2E_BACKEND_URL is missing");
  const response = await page.request.put(`${backendUrl}/v1/video/projects/${assetId}/bgm`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { ...data, catalog_version: "v1" },
  });
  expect(response.ok(), `BGM update failed: ${response.status()}`).toBe(true);
  return response.json() as Promise<{ choice?: { catalog_id?: string } }>;
}

function assertStaticGain(project: ProjectResponse, expected: number) {
  const bgm = project.project.tracks.find((track) => track.id === "track-bgm");
  expect(bgm, "project must contain a BGM track").toBeTruthy();
  expect(new Set(bgm?.elements.map((element) => element.volume))).toEqual(new Set([expected]));
}

function assertDuckingEnvelope(project: ProjectResponse) {
  const bgm = project.project.tracks.find((track) => track.id === "track-bgm");
  expect(bgm, "project must contain a BGM track").toBeTruthy();
  const points = (bgm?.elements ?? []).flatMap((element) => (
    element.animations?.channels?.volume?.keyframes ?? []
  ).map((keyframe) => ({
    time: (element.startTime ?? 0) + (keyframe.time ?? 0),
    value: keyframe.value ?? -1,
  })));
  const valueAt = (time: number) => {
    const point = points.find((candidate) => Math.abs(candidate.time - time) < 0.002);
    expect(point, `missing BGM envelope point at ${time}s`).toBeTruthy();
    return point?.value ?? -1;
  };
  const ducked = 0.18 * (10 ** (-6 / 20));
  expect(valueAt(4.8)).toBeCloseTo(0.18, 5);
  expect(valueAt(5)).toBeCloseTo(ducked, 5);
  expect(valueAt(20)).toBeCloseTo(ducked, 5);
  expect(valueAt(20.5)).toBeCloseTo(0.18, 5);
}

function listStoredMp4Artifacts(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return listStoredMp4Artifacts(entryPath);
    return entry.isFile() && path.basename(path.dirname(entryPath)) === "mp4" ? [entryPath] : [];
  });
}

async function exportProject(
  page: Page,
  fileName: string,
  assetId: number,
  token: string,
): Promise<string> {
  if (!resultDir || !artifactDir || !backendUrl) throw new Error("BGM E2E export environment is missing");
  fs.mkdirSync(resultDir, { recursive: true });
  const outputPath = path.join(resultDir, fileName);
  const storedBefore = listStoredMp4Artifacts(artifactDir);
  const exportRequests: Array<{ method: string; url: string }> = [];
  const onRequest = (request: { method(): string; url(): string }) => {
    const url = request.url();
    if (url.startsWith(backendUrl)) exportRequests.push({ method: request.method(), url });
  };
  page.on("request", onRequest);
  const exportFailure = page.getByText(/^导出(?:失败|出错)：/);
  const downloadButton = page.getByRole("button", { name: "下载成片", exact: true });
  await page.getByRole("button", { name: "导出视频", exact: true }).click();
  const exportOutcome = await Promise.race([
    downloadButton.waitFor({ state: "visible", timeout: 10 * 60_000 }).then(() => ({ error: null })),
    exportFailure.waitFor({ state: "visible", timeout: 10 * 60_000 }).then(async () => ({
      error: await exportFailure.textContent(),
    })),
  ]);
  if (exportOutcome.error) throw new Error(exportOutcome.error);
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await downloadButton.click();
  const download = await downloadPromise;
  page.off("request", onRequest);
  await download.saveAs(outputPath);
  expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);

  const projectPath = `/v1/video/projects/${assetId}`;
  const saveRequests = exportRequests.filter((request) => (
    request.method === "PUT" && new URL(request.url).pathname === projectPath
  ));
  const preflightRequests = exportRequests.filter((request) => (
    request.method === "GET"
    && new URL(request.url).pathname === `${projectPath}/quality`
    && new URL(request.url).searchParams.get("stage") === "export_preflight"
  ));
  const finalizeRequests = exportRequests.filter((request) => (
    request.method === "POST" && new URL(request.url).pathname === `${projectPath}/exports/finalize`
  ));
  const retiredRequests = exportRequests.filter((request) => (
    new URL(request.url).pathname === `${projectPath}/mp4`
    || new URL(request.url).pathname === `${projectPath}/exports/verify`
  ));
  expect(saveRequests).toHaveLength(1);
  expect(preflightRequests).toHaveLength(1);
  expect(finalizeRequests).toHaveLength(1);
  expect(retiredRequests).toHaveLength(0);
  expect(exportRequests.indexOf(saveRequests[0])).toBeLessThan(exportRequests.indexOf(preflightRequests[0]));
  expect(exportRequests.indexOf(preflightRequests[0])).toBeLessThan(exportRequests.indexOf(finalizeRequests[0]));

  const storedAfter = listStoredMp4Artifacts(artifactDir);
  expect(storedAfter).toHaveLength(storedBefore.length + 1);
  const persisted = await readProject(page, assetId, token);
  expect(persisted.project.mp4_state).toBe("ready");
  expect(persisted.project.mp4_ref).toMatch(/^local:\/\//);
  return outputPath;
}

async function assertInvalidMp4BlockedWithoutPersistence(
  page: Page,
  assetId: number,
  token: string,
) {
  if (!artifactDir || !backendUrl) throw new Error("BGM E2E blocker environment is missing");
  const beforeProject = await readProject(page, assetId, token);
  const save = await page.request.put(`${backendUrl}/v1/video/projects/${assetId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: beforeProject.project,
  });
  expect(save.ok(), `project approval save failed: ${save.status()}`).toBe(true);
  const storedBefore = listStoredMp4Artifacts(artifactDir);
  const blocked = await page.request.post(
    `${backendUrl}/v1/video/projects/${assetId}/exports/finalize`,
    {
      headers: { Authorization: `Bearer ${token}` },
      multipart: {
        file: {
          name: "invalid.mp4",
          mimeType: "video/mp4",
          buffer: Buffer.from("not-an-mp4"),
        },
      },
    },
  );
  expect(blocked.status()).toBe(422);
  expect(listStoredMp4Artifacts(artifactDir)).toEqual(storedBefore);
  const afterProject = await readProject(page, assetId, token);
  expect(afterProject.project.mp4_ref).toBeFalsy();
  expect(afterProject.project.mp4_state).not.toBe("ready");
}

function probeExport(filePath: string, expectedFrequency: number) {
  const probe = JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-show_streams", "-show_format", "-of", "json", filePath,
  ], { encoding: "utf8" })) as {
    streams?: Array<{ codec_type?: string }>;
    format?: { duration?: string };
  };
  expect(probe.streams?.filter((stream) => stream.codec_type === "audio")).toHaveLength(1);
  const duration = Number(probe.format?.duration ?? 0);
  expect(duration).toBeGreaterThanOrEqual(27);
  expect(duration).toBeLessThanOrEqual(33);

  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const analysis = spawnSync("ffmpeg", [
    "-hide_banner", "-nostats", "-i", filePath,
    "-af", `bandpass=f=${expectedFrequency}:width_type=h:w=30,astats=metadata=0:reset=0`,
    "-f", "null", nullDevice,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  expect(analysis.status, analysis.stderr || "ffmpeg band analysis failed").toBe(0);
  const stderr = analysis.stderr ?? "";
  const levels = [...stderr.matchAll(/RMS level dB:\s*(-?[0-9.]+)/g)].map((match) => Number(match[1]));
  expect(levels.length, "ffmpeg must report band-limited RMS").toBeGreaterThan(0);
  expect(Math.max(...levels), `${expectedFrequency}Hz BGM must remain audible`).toBeGreaterThan(-45);
}

test("default BGM survives change, refresh, export, and restore_auto", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  if (!seed) throw new Error("BGM_E2E_SEED is missing");
  const token = await authenticate(page);
  await page.goto(`/editor?asset=${seed.narrated_asset_id}`);
  await expect(page.getByRole("button", { name: "导出视频", exact: true })).toBeVisible({
    timeout: 180_000,
  });
  const initial = await readProject(page, seed.narrated_asset_id, token);
  expect(initial.project.metadata.bgm_choice?.catalog_id).toBe(seed.narrated_default_track_id);
  assertStaticGain(initial, 0.18);
  assertDuckingEnvelope(initial);

  await updateBgm(page, seed.narrated_asset_id, token, {
    action: "select",
    catalog_id: seed.narrated_alternate_track_id,
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "导出视频", exact: true })).toBeVisible({
    timeout: 180_000,
  });
  const changed = await readProject(page, seed.narrated_asset_id, token);
  expect(changed.project.metadata.bgm_choice?.catalog_id).toBe(seed.narrated_alternate_track_id);
  assertStaticGain(changed, 0.18);
  assertDuckingEnvelope(changed);

  probeExport(
    await exportProject(page, "narrated-manual-bgm.mp4", seed.narrated_asset_id, token),
    seed.narrated_alternate_frequency,
  );

  await updateBgm(page, seed.narrated_asset_id, token, { action: "disable" });
  const disabled = await readProject(page, seed.narrated_asset_id, token);
  expect(disabled.project.metadata.bgm_choice?.enabled).toBe(false);
  expect(disabled.project.tracks.some((track) => track.id === "track-bgm")).toBe(false);

  const restoredBody = await updateBgm(
    page,
    seed.narrated_asset_id,
    token,
    { action: "restore_auto" },
  );
  expect(restoredBody.choice?.catalog_id).toBe(seed.narrated_default_track_id);
  const restored = await readProject(page, seed.narrated_asset_id, token);
  expect(restored.project.metadata.bgm_choice?.selected_by).toBe("auto");
  expect(restored.project.metadata.bgm_choice?.catalog_id).toBe(seed.narrated_default_track_id);
});

test("no-narration project keeps static 0.5 BGM gain in MP4 export", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  if (!seed) throw new Error("BGM_E2E_SEED is missing");
  const token = await authenticate(page);
  await assertInvalidMp4BlockedWithoutPersistence(page, seed.no_narration_asset_id, token);
  await page.goto(`/editor?asset=${seed.no_narration_asset_id}`);
  await expect(page.getByRole("button", { name: "导出视频", exact: true })).toBeVisible({
    timeout: 180_000,
  });
  const project = await readProject(page, seed.no_narration_asset_id, token);
  expect(project.project.metadata.bgm_choice?.catalog_id).toBe(seed.no_narration_default_track_id);
  assertStaticGain(project, 0.5);
  probeExport(
    await exportProject(page, "no-narration-stable-bgm.mp4", seed.no_narration_asset_id, token),
    seed.no_narration_default_frequency,
  );
});
