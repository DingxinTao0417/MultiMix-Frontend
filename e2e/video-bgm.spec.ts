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

async function exportProject(page: Page, fileName: string): Promise<string> {
  if (!resultDir) throw new Error("BGM_E2E_RESULT_DIR is missing");
  fs.mkdirSync(resultDir, { recursive: true });
  const outputPath = path.join(resultDir, fileName);
  const downloadPromise = page.waitForEvent("download", { timeout: 10 * 60_000 });
  await page.getByRole("button", { name: "导出视频", exact: true }).click();
  const exportFailure = page.getByText(/^导出(?:失败|出错)：/);
  const outcome = await Promise.race([
    downloadPromise.then((download) => ({ download, error: null })),
    exportFailure.waitFor({ state: "visible", timeout: 10 * 60_000 }).then(async () => ({
      download: null,
      error: await exportFailure.textContent(),
    })),
  ]);
  if (outcome.error || !outcome.download) throw new Error(outcome.error || "Export produced no download");
  const download = outcome.download;
  await download.saveAs(outputPath);
  expect(fs.statSync(outputPath).size).toBeGreaterThan(1000);
  return outputPath;
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
  const bgmPanel = page.getByRole("complementary", { name: "背景音乐", exact: true });
  await expect(bgmPanel).toBeVisible({
    timeout: 180_000,
  });
  await expect(bgmPanel.getByText("已自动配乐", { exact: true })).toBeVisible();
  await expect(bgmPanel.getByRole("button", { name: "恢复自动配乐", exact: true })).toBeVisible();
  await expect(bgmPanel.getByText(seed.narrated_default_title, { exact: true })).toHaveAttribute("data-current", "true");
  const initial = await readProject(page, seed.narrated_asset_id, token);
  expect(initial.project.metadata.bgm_choice?.catalog_id).toBe(seed.narrated_default_track_id);
  assertStaticGain(initial, 0.18);
  assertDuckingEnvelope(initial);

  await page.getByRole("button", { name: "全部音乐", exact: true }).click();
  await page.getByRole("button", { name: `选择 ${seed.narrated_alternate_title}`, exact: true }).click();
  await expect(page.getByText("背景音乐已更新。", { exact: true })).toBeVisible();
  await expect(bgmPanel.getByText(seed.narrated_alternate_title, { exact: true })).toHaveAttribute("data-current", "true");
  await page.reload();
  await expect(bgmPanel).toBeVisible({
    timeout: 180_000,
  });
  await page.getByRole("button", { name: "全部音乐", exact: true }).click();
  await expect(bgmPanel.getByText(seed.narrated_alternate_title, { exact: true })).toHaveAttribute("data-current", "true");
  const changed = await readProject(page, seed.narrated_asset_id, token);
  expect(changed.project.metadata.bgm_choice?.catalog_id).toBe(seed.narrated_alternate_track_id);
  assertStaticGain(changed, 0.18);
  assertDuckingEnvelope(changed);

  probeExport(await exportProject(page, "narrated-manual-bgm.mp4"), seed.narrated_alternate_frequency);

  await bgmPanel.getByRole("button", { name: "无配乐", exact: true }).click();
  await expect(page.getByText("已关闭背景音乐。", { exact: true })).toBeVisible();
  const disabled = await readProject(page, seed.narrated_asset_id, token);
  expect(disabled.project.metadata.bgm_choice?.enabled).toBe(false);
  expect(disabled.project.tracks.some((track) => track.id === "track-bgm")).toBe(false);

  if (!backendUrl) throw new Error("BGM_E2E_BACKEND_URL is missing");
  const restore = await page.request.put(
    `${backendUrl}/v1/video/projects/${seed.narrated_asset_id}/bgm`,
    {
      headers: { Authorization: `Bearer ${token}` },
      data: { action: "restore_auto", catalog_version: "v1" },
    },
  );
  expect(restore.ok(), `restore_auto failed: ${restore.status()}`).toBe(true);
  const restoredBody = await restore.json() as { choice?: { catalog_id?: string } };
  expect(restoredBody.choice?.catalog_id).toBe(seed.narrated_default_track_id);
  await page.reload();
  await expect(bgmPanel.getByText("已自动配乐", { exact: true })).toBeVisible();
  await expect(bgmPanel.getByText(seed.narrated_default_title, { exact: true })).toHaveAttribute("data-current", "true");
  const restored = await readProject(page, seed.narrated_asset_id, token);
  expect(restored.project.metadata.bgm_choice?.selected_by).toBe("auto");
  expect(restored.project.metadata.bgm_choice?.catalog_id).toBe(seed.narrated_default_track_id);
});

test("no-narration project keeps static 0.5 BGM gain in MP4 export", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  if (!seed) throw new Error("BGM_E2E_SEED is missing");
  const token = await authenticate(page);
  await page.goto(`/editor?asset=${seed.no_narration_asset_id}`);
  const bgmPanel = page.getByRole("complementary", { name: "背景音乐", exact: true });
  await expect(bgmPanel).toBeVisible({
    timeout: 180_000,
  });
  const project = await readProject(page, seed.no_narration_asset_id, token);
  expect(project.project.metadata.bgm_choice?.catalog_id).toBe(seed.no_narration_default_track_id);
  await expect(bgmPanel.getByText(seed.no_narration_default_title, { exact: true })).toHaveAttribute("data-current", "true");
  assertStaticGain(project, 0.5);
  probeExport(await exportProject(page, "no-narration-stable-bgm.mp4"), seed.no_narration_default_frequency);
});
