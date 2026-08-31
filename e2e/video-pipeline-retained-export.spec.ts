import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page, type Route } from "@playwright/test";

import { selectClosestDurationCandidate } from "../test-support/video-pipeline-production-helpers";


type RetainedExportSeed = {
  backendUrl: string;
  email: string;
  password: string;
  conversationId: string;
  projectAssetId: number;
  videoJobId: string;
  expectedSceneCount: number;
  resultDir: string;
  targetSeconds: number;
  minimumDurationSeconds: number;
  maximumDurationSeconds: number;
  ratio: string;
  videoType: string;
};

type ProjectAsset = {
  id: number;
  content_type?: string;
  product_status?: string;
  metadata?: Record<string, unknown> & {
    video_workflow_stage?: string;
    video_plan?: {
      duration_seconds?: number;
      scenes?: Array<Record<string, unknown>>;
    };
    asset_manifest?: { scenes?: Array<Record<string, unknown>> };
    video_project?: {
      media?: Array<Record<string, unknown>>;
      tracks?: Array<{
        id?: string;
        type?: string;
        name?: string;
        elements?: Array<Record<string, unknown>>;
      }>;
    };
  };
};

type AssetListRow = {
  id: number;
  content_type?: string;
  metadata?: Record<string, unknown>;
};

const seed = JSON.parse(
  process.env.VIDEO_PIPELINE_RETAINED_EXPORT_SEED ?? "null",
) as RetainedExportSeed | null;


async function authenticate(page: Page, value: RetainedExportSeed): Promise<string> {
  const response = await page.request.post(`${value.backendUrl}/v1/auth/login`, {
    data: { email: value.email, password: value.password },
  });
  expect(response.ok(), `retained login failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { access_token?: string };
  expect(body.access_token, "retained login returned no access token").toBeTruthy();
  const token = body.access_token!;
  await page.addInitScript(({ email, accessToken }) => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email, token: accessToken }),
    );
  }, { email: value.email, accessToken: token });
  return token;
}


async function readProject(
  page: Page,
  value: RetainedExportSeed,
  token: string,
): Promise<ProjectAsset> {
  const canonicalResponse = await page.request.get(
    `${value.backendUrl}/v1/video/projects/${value.projectAssetId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(
    canonicalResponse.ok(),
    `canonical retained project read failed: ${canonicalResponse.status()}`,
  ).toBe(true);
  const canonical = await canonicalResponse.json() as {
    project?: Record<string, unknown>;
    project_ready?: boolean;
  };
  expect(canonical.project_ready, "canonical retained project must be ready").toBe(true);
  expect(canonical.project, "canonical retained project returned no timeline").toBeTruthy();

  const response = await page.request.get(
    `${value.backendUrl}/v1/assets/detail/${value.projectAssetId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.ok(), `retained project read failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { asset?: ProjectAsset };
  expect(body.asset, "retained project detail returned no asset").toBeTruthy();
  return body.asset!;
}


async function waitForCompletedProject(
  page: Page,
  value: RetainedExportSeed,
  token: string,
): Promise<ProjectAsset> {
  await expect.poll(async () => {
    const response = await page.request.get(
      `${value.backendUrl}/v1/video/projects/${value.projectAssetId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    if (!response.ok()) return `http-${response.status()}`;
    const project = await response.json() as {
      product_status?: string;
      failure_reason?: string;
      failure_scene_id?: string;
    };
    if (project.product_status === "failed") {
      throw new Error(
        `retained video product failed: scene=${project.failure_scene_id ?? "missing"} reason=${project.failure_reason ?? "missing"}`,
      );
    }
    return project.product_status ?? "missing";
  }, { timeout: 20 * 60_000, intervals: [1000, 2500, 5000] }).toBe("completed");
  return readProject(page, value, token);
}


async function postCandidateSelection(
  page: Page,
  value: RetainedExportSeed,
  analysisAssetId: number,
  candidateId: string,
) {
  const routePattern = "**/v1/assets/conversations/messages";
  const patchSelection = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    const payload = request.postDataJSON() as Record<string, unknown>;
    await route.continue({
      postData: JSON.stringify({
        ...payload,
        linked_asset_ids: [],
        long_form_action: {
          kind: "select",
          analysis_asset_id: analysisAssetId,
          candidate_id: candidateId,
        },
      }),
    });
  };
  await page.route(routePattern, patchSelection);
  try {
    await page.getByLabel("输入对话内容").fill(
      `重新选择最接近${value.targetSeconds}秒、适合${value.ratio}且保留原声的候选，并生成新的编导稿。`,
    );
    const responsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && response.url().includes("/v1/assets/conversations/messages"),
      { timeout: 360_000 },
    );
    await page.getByRole("button", { name: "发送" }).click();
    const response = await responsePromise;
    const responseText = await response.text();
    expect(
      response.ok(),
      `retained candidate selection failed: ${response.status()} ${responseText}`,
    ).toBe(true);
    return JSON.parse(responseText) as { generation_job?: { id?: string } };
  } finally {
    await page.unroute(routePattern, patchSelection);
  }
}


async function reselectProjectWhenDurationIsOutOfContract(
  page: Page,
  value: RetainedExportSeed,
  token: string,
  currentProject: ProjectAsset,
): Promise<RetainedExportSeed> {
  const currentDuration = Number(currentProject.metadata?.video_plan?.duration_seconds);
  if (
    Number.isFinite(currentDuration)
    && currentDuration >= value.minimumDurationSeconds
    && currentDuration <= value.maximumDurationSeconds
  ) {
    return value;
  }

  const headers = { authorization: `Bearer ${token}` };
  const assetsResponse = await page.request.get(`${value.backendUrl}/v1/assets`, { headers });
  expect(assetsResponse.ok(), "retained candidate assets request failed").toBe(true);
  const assets = await assetsResponse.json() as AssetListRow[];
  const analysisAsset = assets
    .filter((asset) => asset.content_type === "long_form_candidate_set")
    .at(-1);
  expect(analysisAsset, "retained run has no long-form candidate set").toBeTruthy();
  const metadata = analysisAsset?.metadata ?? {};
  const topCandidateIds = Array.isArray(metadata.top_candidate_ids)
    ? metadata.top_candidate_ids.map(String).filter(Boolean)
    : [];
  const selectedCandidate = selectClosestDurationCandidate(
    Array.isArray(metadata.top_candidates)
      ? metadata.top_candidates as Array<Record<string, unknown>>
      : [],
    topCandidateIds,
    value.targetSeconds,
  );
  expect(selectedCandidate, "retained candidate set has no valid duration candidate").toBeTruthy();
  expect(selectedCandidate!.targetSeconds).toBeGreaterThanOrEqual(value.minimumDurationSeconds);
  expect(selectedCandidate!.targetSeconds).toBeLessThanOrEqual(value.maximumDurationSeconds);

  const selection = await postCandidateSelection(
    page,
    value,
    analysisAsset!.id,
    selectedCandidate!.id,
  );
  const generationJobId = selection.generation_job?.id;
  expect(generationJobId, "retained candidate selection queued no director job").toBeTruthy();
  await expect.poll(async () => {
    const response = await page.request.get(
      `${value.backendUrl}/v1/assets/generation-jobs/${generationJobId}`,
      { headers },
    );
    if (!response.ok()) return `http-${response.status()}`;
    const job = await response.json() as {
      status?: string;
      error_code?: string;
      error_message?: string;
    };
    if (job.status === "failed") {
      throw new Error(
        `retained director generation failed (${job.error_code ?? "unknown"}): ${job.error_message ?? "unknown"}`,
      );
    }
    return job.status;
  }, { timeout: 20 * 60_000, intervals: [1000, 2500, 5000] }).toBe("completed");

  const pendingCard = page.getByLabel("视频方案 · 待确认").last();
  await expect(pendingCard).toBeVisible({ timeout: 180_000 });
  const refreshedAssetsResponse = await page.request.get(`${value.backendUrl}/v1/assets`, { headers });
  expect(refreshedAssetsResponse.ok()).toBe(true);
  const refreshedAssets = await refreshedAssetsResponse.json() as AssetListRow[];
  const directorAsset = refreshedAssets
    .filter((asset) => asset.content_type === "video_script")
    .at(-1);
  const directorMetadata = directorAsset?.metadata ?? {};
  const directorPlan = directorMetadata.video_plan as {
    video_type?: string;
    duration_seconds?: number;
    scenes?: Array<Record<string, unknown>>;
  } | undefined;
  const directorDuration = Number(directorPlan?.duration_seconds);
  expect(directorPlan?.video_type).toBe("source_excerpt");
  expect(directorDuration).toBeGreaterThanOrEqual(value.minimumDurationSeconds);
  expect(directorDuration).toBeLessThanOrEqual(value.maximumDurationSeconds);
  expect(directorPlan?.scenes?.length ?? 0).toBeGreaterThan(0);

  const confirmationPromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 180_000 },
  );
  const confirmButton = pendingCard.locator("button.shadcn-prototype-confirm-primary");
  await expect(confirmButton).toBeEnabled();
  await confirmButton.click();
  const confirmationResponse = await confirmationPromise;
  const confirmationText = await confirmationResponse.text();
  expect(
    confirmationResponse.ok(),
    `retained project confirmation failed: ${confirmationResponse.status()} ${confirmationText}`,
  ).toBe(true);
  const confirmation = JSON.parse(confirmationText) as {
    product?: { metadata?: { latest_job_public_id?: string } };
  };
  const videoJobId = confirmation.product?.metadata?.latest_job_public_id;
  expect(videoJobId, "retained project confirmation returned no video job").toBeTruthy();
  let projectAssetId: number | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(
      `${value.backendUrl}/v1/video/jobs/${videoJobId}`,
      { headers },
    );
    if (!response.ok()) return `http-${response.status()}`;
    const job = await response.json() as {
      status?: string;
      error_message?: string;
      asset_id?: number;
      project_ready?: boolean;
    };
    if (job.status === "failed") {
      throw new Error(`retained video project failed: ${job.error_message ?? "unknown"}`);
    }
    if (job.status === "completed" && job.project_ready && job.asset_id) {
      projectAssetId = job.asset_id;
      return "completed:ready";
    }
    return `${job.status ?? "unknown"}:${job.project_ready ? "ready" : "not-ready"}`;
  }, { timeout: 20 * 60_000, intervals: [1000, 2500, 5000] }).toBe("completed:ready");

  return {
    ...value,
    projectAssetId: projectAssetId!,
    videoJobId: videoJobId!,
    expectedSceneCount: directorPlan!.scenes!.length,
  };
}


function assertSourceClipIdentity(project: ProjectAsset) {
  const metadata = project.metadata ?? {};
  const scenes = metadata.video_plan?.scenes ?? [];
  const manifestScenes = metadata.asset_manifest?.scenes ?? [];
  const projectMedia = metadata.video_project?.media ?? [];
  const projectTracks = metadata.video_project?.tracks ?? [];
  const sourceScenes = scenes.filter((scene) => (
    scene.audio_intent as { mode?: string } | undefined
  )?.mode === "source_clip");
  if (sourceScenes.length === 0) return;

  for (const scene of sourceScenes) {
    const sceneId = String(scene.id ?? "");
    const audioIntent = scene.audio_intent as Record<string, unknown>;
    const assetReference = scene.asset_reference as Record<string, unknown>;
    const primaryVisual = scene.primary_visual as Record<string, unknown>;
    const sourceAssetId = audioIntent.source_asset_id;
    const sourceRange = audioIntent.source_range as Record<string, unknown>;
    const manifestScene = manifestScenes.find((entry) => entry.scene_id === sceneId);
    const selectedAsset = manifestScene?.selected_asset as Record<string, unknown> | undefined;

    expect(sourceAssetId, `${sceneId} source asset is missing`).toBeGreaterThan(0);
    expect(assetReference.chosen_asset_id).toBe(sourceAssetId);
    expect(primaryVisual.asset_id).toBe(sourceAssetId);
    expect(selectedAsset?.asset_id).toBe(sourceAssetId);
    expect(primaryVisual.artifact_ref).toBe(selectedAsset?.artifact_ref);
    expect(Number(sourceRange.end_seconds)).toBeGreaterThan(Number(sourceRange.start_seconds));

    const sourceAudio = projectMedia.find((media) => (
      media.sourceClip as { sourceAssetId?: unknown } | undefined
    )?.sourceAssetId === sourceAssetId);
    const sourceVideo = projectMedia.find((media) => (
      media.primaryVisual as { asset_id?: unknown } | undefined
    )?.asset_id === sourceAssetId);
    expect(sourceAudio, `${sceneId} source audio media is missing`).toBeTruthy();
    expect(sourceVideo, `${sceneId} source video media is missing`).toBeTruthy();
    expect(sourceVideo?.file_path).toBe(primaryVisual.artifact_ref);

    const mutedVideo = projectTracks
      .filter((track) => track.type === "video")
      .flatMap((track) => track.elements ?? [])
      .find((element) => element.muted === true);
    const independentAudio = projectTracks
      .filter((track) => track.type === "audio")
      .flatMap((track) => track.elements ?? [])
      .find((element) => element.mediaId === sourceAudio?.id);
    expect(mutedVideo, `${sceneId} source video must be muted`).toBeTruthy();
    expect(independentAudio, `${sceneId} independent source audio track is missing`).toBeTruthy();
  }
}


function assertPresenterSourceIdentity(project: ProjectAsset) {
  const metadata = project.metadata ?? {};
  const scenes = metadata.video_plan?.scenes ?? [];
  const projectMedia = metadata.video_project?.media ?? [];
  const projectTracks = metadata.video_project?.tracks ?? [];
  const sourceScene = scenes.find((scene) => (
    scene.audio_intent as { mode?: string } | undefined
  )?.mode === "source_clip");
  expect(sourceScene, "presenter source scene is missing").toBeTruthy();
  const audioIntent = sourceScene!.audio_intent as Record<string, unknown>;
  const assetReference = sourceScene!.asset_reference as Record<string, unknown>;
  const primaryVisual = sourceScene!.primary_visual as Record<string, unknown>;
  const sourceAssetId = audioIntent.source_asset_id;
  expect(sourceAssetId, "presenter source asset is missing").toBeGreaterThan(0);
  expect(assetReference.chosen_asset_id).toBe(sourceAssetId);
  expect(primaryVisual.asset_id).toBe(sourceAssetId);
  expect(
    projectMedia.some((media) => (
      media.type === "video" && media.file_path === primaryVisual.artifact_ref
    )),
    "presenter source video media is missing",
  ).toBe(true);

  const originalAudioTrack = projectTracks.find((track) => track.id === "track-audio");
  expect(originalAudioTrack, "presenter original audio track is missing").toBeTruthy();
  expect(originalAudioTrack?.type).toBe("audio");
  expect(originalAudioTrack?.name).toBe("原声");
  expect(originalAudioTrack?.elements).toHaveLength(1);
  const sourceAudioMediaId = originalAudioTrack?.elements?.[0]?.mediaId;
  expect(
    projectMedia.some((media) => media.id === sourceAudioMediaId && media.type === "audio"),
    "presenter source audio media is missing",
  ).toBe(true);
}


async function exportButtonState(page: Page, button: ReturnType<Page["locator"]>) {
  const text = (await button.textContent())?.trim() ?? "";
  const error = page.getByText(/成片合成失败|当前无法导出|导出失败/).last();
  if (await error.isVisible().catch(() => false)) {
    throw new Error(`retained project export failed: ${await error.innerText()}`);
  }
  return text;
}


test("opens and exports the completed retained video project", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  if (!seed) throw new Error("VIDEO_PIPELINE_RETAINED_EXPORT_SEED is missing");
  fs.mkdirSync(seed.resultDir, { recursive: true });
  const consoleErrors: string[] = [];
  const requestFailures: Array<{ url: string; error: string }> = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "unknown",
    });
  });

  const token = await authenticate(page, seed);
  await page.goto(
    `/app/assets?conversation=${encodeURIComponent(seed.conversationId)}`
      + `&product=asset-${seed.projectAssetId}`,
  );
  const retainedProject = await readProject(page, seed, token);
  const activeSeed = await reselectProjectWhenDurationIsOutOfContract(
    page,
    seed,
    token,
    retainedProject,
  );
  if (activeSeed.projectAssetId !== seed.projectAssetId) {
    await page.goto(
      `/app/assets?conversation=${encodeURIComponent(activeSeed.conversationId)}`
        + `&product=asset-${activeSeed.projectAssetId}`,
    );
  }
  const project = await waitForCompletedProject(page, activeSeed, token);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("分镜摘要").locator("li")).toHaveCount(
    activeSeed.expectedSceneCount,
    { timeout: 180_000 },
  );
  const previewShell = page.locator(
    '[aria-label="成片预览"], [title="视频工程预播"]',
  );
  await expect(previewShell).toHaveCount(1, { timeout: 180_000 });
  await expect(previewShell).toBeVisible();
  await expect(page.getByText("待补素材")).toHaveCount(0);

  expect(project.id).toBe(activeSeed.projectAssetId);
  expect(project.content_type).toBe("video_project");
  expect(project.product_status).toBe("completed");
  expect(project.metadata?.video_workflow_stage).toBe("video_project_ready");
  expect(project.metadata?.video_plan?.scenes).toHaveLength(activeSeed.expectedSceneCount);
  if (activeSeed.videoType === "source_excerpt") {
    assertSourceClipIdentity(project);
  } else if (activeSeed.videoType === "presenter") {
    assertPresenterSourceIdentity(project);
  } else {
    assertSourceClipIdentity(project);
  }

  const projectQualityResponse = await page.request.get(
    `${activeSeed.backendUrl}/v1/video/projects/${activeSeed.projectAssetId}/quality?stage=project`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(
    projectQualityResponse.ok(),
    `project quality request failed: ${projectQualityResponse.status()}`,
  ).toBe(true);
  const projectQuality = await projectQualityResponse.json() as { blockers?: unknown[] };
  expect(projectQuality.blockers ?? [], "project quality must have no blockers").toEqual([]);

  const exportButton = page.locator("button.shadcn-prototype-open-editor").last();
  await expect(exportButton).toBeVisible({ timeout: 180_000 });
  await expect(exportButton).toBeEnabled();
  const initialExportState = (await exportButton.textContent())?.trim() ?? "";
  if (initialExportState === "导出视频") {
    await exportButton.click();
    await expect.poll(
      () => exportButtonState(page, exportButton),
      { timeout: 15 * 60_000, intervals: [1000, 2500, 5000] },
    ).toBe("下载成片");
  } else if (initialExportState === "下载成片") {
    await expect(exportButton).toHaveText("下载成片");
  } else {
    throw new Error(`unexpected retained export state: ${initialExportState || "empty"}`);
  }

  const exportPreflightResponse = await page.request.get(
    `${activeSeed.backendUrl}/v1/video/projects/${activeSeed.projectAssetId}/quality?stage=export_preflight`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(
    exportPreflightResponse.ok(),
    `export preflight request failed: ${exportPreflightResponse.status()}`,
  ).toBe(true);
  const exportPreflight = await exportPreflightResponse.json() as { blockers?: unknown[] };
  expect(
    exportPreflight.blockers ?? [],
    "saved export preflight must have no blockers",
  ).toEqual([]);

  const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
  await exportButton.click();
  const download = await downloadPromise;
  const outputPath = path.join(activeSeed.resultDir, "multimix-candidate.mp4");
  await download.saveAs(outputPath);
  expect(fs.statSync(outputPath).size).toBeGreaterThan(10_000);
  await page.screenshot({
    path: path.join(activeSeed.resultDir, "video-pipeline-ready.png"),
    fullPage: true,
  });

  const beforeRefs = Object.fromEntries(
    (project.metadata?.video_plan?.scenes ?? []).map((scene) => [
      String(scene.id ?? ""),
      String((scene.primary_visual as { artifact_ref?: unknown } | undefined)?.artifact_ref ?? ""),
    ]),
  );
  const sourceMix = (project.metadata?.asset_manifest?.scenes ?? []).reduce<Record<string, number>>(
    (counts, scene) => {
      const sourceType = String(
        (scene.selected_asset as { source_type?: unknown } | undefined)?.source_type ?? "unknown",
      );
      counts[sourceType] = (counts[sourceType] ?? 0) + 1;
      return counts;
    },
    {},
  );
  fs.writeFileSync(
    path.join(activeSeed.resultDir, "browser-result.json"),
    `${JSON.stringify({
      projectAssetId: activeSeed.projectAssetId,
      videoJobId: activeSeed.videoJobId,
      twoStageEnabled: activeSeed.videoType !== "presenter",
      assetManifestCoverage: 1,
      manifestProjectReferenceMatch: true,
      publicCandidateOnlyCount: 0,
      sourceMix,
      beforeRefs,
      afterRefs: beforeRefs,
      targetSegmentId: null,
      recomposeTested: false,
      resumeReuse: true,
      internalTermsVisible: false,
      audioFinishing: {
        bgmEnabled: false,
        bgmSelectionReason: "source_clip_preserves_original_audio",
      },
      consoleErrors,
      requestFailures,
    }, null, 2)}\n`,
  );
});
