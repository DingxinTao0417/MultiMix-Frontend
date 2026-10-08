import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

type Seed = {
  backendUrl: string;
  email: string;
  password: string;
  conversationId: string;
  directorAssetId: number;
  directorContentHash: string;
  generationJobId: string;
  failedProductionJobId?: string | null;
  restoreReviewedVersionId?: number;
  reviewStatus: "pending" | "reviewed";
  expectedSceneCount: number;
  directorJobTimeoutMs: number;
  resultDir: string;
};

const seed = JSON.parse(process.env.VIDEO_PIPELINE_RETAINED_EDITABLE_SEED ?? "null") as Seed | null;
const expectSourceChoice = process.env.VIDEO_PIPELINE_EXPECT_SOURCE_CHOICE === "true";
const verifyRetainedSourceChoice = process.env.VIDEO_PIPELINE_VERIFY_RETAINED_SOURCE_CHOICE === "true";
const requestImageProposal = process.env.VIDEO_PIPELINE_REQUEST_IMAGE_PROPOSAL === "true";
const verifyRetainedImagePicker = process.env.VIDEO_PIPELINE_VERIFY_RETAINED_IMAGE_PICKER === "true";
const applyRetainedImageCandidate = process.env.VIDEO_PIPELINE_APPLY_RETAINED_IMAGE_CANDIDATE === "true";
const targetSceneId = process.env.VIDEO_PIPELINE_SOURCE_SCENE_ID?.trim() || null;
const expectSelectedGeneratedImages = process.env.VIDEO_PIPELINE_EXPECT_SELECTED_GENERATED_IMAGES === "true";

type SourceChoiceJob = {
  status?: string;
  failure_diagnostic?: { error_code?: string; stage?: string; scene_ids?: string[] };
  failure_context?: { source_asset_id?: number };
};

async function verifySourceChoiceUi(page: Page, value: Seed, token: string, job: SourceChoiceJob, originalBody?: string) {
  expect(job.status).toBe("failed");
  expect(job.failure_diagnostic).toMatchObject({
    error_code: "source_choice_required",
    stage: "primary_visual_strategy",
  });
  expect(job.failure_context?.source_asset_id).toBe(value.directorAssetId);
  const sceneIds = job.failure_diagnostic?.scene_ids ?? [];
  expect(sceneIds.length).toBeGreaterThan(0);
  for (const sceneId of sceneIds) expect(sceneId).toMatch(/^scene-[1-9][0-9]*$/);
  const sourcePanel = page.getByRole("region", { name: "需要选择画面来源" }).last();
  await expect(sourcePanel).toBeVisible({ timeout: 60_000 });
  const selectedSceneId = targetSceneId ?? sceneIds[0];
  expect(sceneIds).toContain(selectedSceneId);
  const candidateResultName = `retained-editable-image-candidate-${selectedSceneId}.json`;
  const candidateResultPath = path.join(value.resultDir, candidateResultName);
  const selectedSceneNumber = selectedSceneId.slice(6);
  await sourcePanel.getByRole("button", { name: `查看第 ${selectedSceneNumber} 镜并选择画面` }).click();
  const originalAfter = await readAsset(page, value, token, value.directorAssetId);
  expect(originalAfter.content_hash).toBe(value.directorContentHash);
  if (originalBody !== undefined) expect(originalAfter.body).toBe(originalBody);
  const savedScene = originalAfter.metadata?.video_plan?.scenes?.find(
    (item) => item && typeof item === "object" && (item as Record<string, unknown>).id === selectedSceneId,
  ) as Record<string, unknown> | undefined;
  const visibleGoal = typeof savedScene?.visual_brief === "string" ? savedScene.visual_brief.trim() : "";
  expect(visibleGoal).toBeTruthy();
  const sceneDetails = page.locator("details[data-scene-source-list]").last();
  await expect(sceneDetails).toBeVisible();
  await expect(sceneDetails).toHaveAttribute("open", "");
  const scene = page.locator(`[data-scene-source-id="${selectedSceneId}"]`).last();
  await expect(scene).toBeVisible();
  for (const action of ["生成图片", "上传素材", "修改本镜创意"]) {
    await expect(scene.getByRole("button", { name: action, exact: true })).toBeVisible();
  }
  if (verifyRetainedImagePicker) {
    const result = JSON.parse(fs.readFileSync(
      selectedSceneId === "scene-2" && !fs.existsSync(candidateResultPath)
        ? path.join(value.resultDir, "retained-editable-image-candidate-result.json")
        : candidateResultPath, "utf8",
    )) as { resultAssetId?: number };
    expect(result.resultAssetId).toBeGreaterThan(0);
    await scene.getByRole("button", { name: "选择项目图片", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "为分镜选择项目图片" });
    await expect(picker).toBeVisible();
    const candidateOption = picker.getByRole("button").filter({ hasText: `生成图片 #${result.resultAssetId}` });
    await expect(candidateOption).toBeVisible({ timeout: 30_000 });
    if (applyRetainedImageCandidate) {
      const selectionResponse = page.waitForResponse(
        (response) => response.request().method() === "POST"
          && response.url().includes("/v1/assets/conversations/messages")
          && response.request().postDataJSON()?.scene_source_decision?.action === "use_saved_asset",
        { timeout: 60_000 },
      );
      await candidateOption.click();
      const response = await selectionResponse;
      expect(response.ok(), `scene image selection failed: ${response.status()} ${await response.text()}`).toBe(true);
      await expect(picker).toBeHidden({ timeout: 30_000 });
      const updated = await readAsset(page, value, token, value.directorAssetId);
      const scene = updated.metadata?.video_plan?.scenes?.find(
        (item) => item && typeof item === "object" && (item as Record<string, unknown>).id === selectedSceneId,
      ) as Record<string, unknown> | undefined;
      expect((scene?.asset_reference as Record<string, unknown> | undefined)?.chosen_asset_id).toBe(result.resultAssetId);
      fs.writeFileSync(path.join(value.resultDir, `retained-editable-image-applied-${selectedSceneId}.json`),
        `${JSON.stringify({ sceneId: selectedSceneId, imageAssetId: result.resultAssetId,
          originalAssetId: value.directorAssetId, updatedDirectorHash: updated.content_hash }, null, 2)}\n`);
    }
  }
  if (requestImageProposal) {
    const proposalResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && response.url().includes("/v1/assets/conversations/messages"),
      { timeout: 180_000 },
    );
    await scene.getByRole("button", { name: "生成图片", exact: true }).click();
    const proposalResponse = await proposalResponsePromise;
    const requestPayload = proposalResponse.request().postDataJSON() as {
      instruction?: string;
      scene_image_generation_request?: { scene_id?: string; director_version_id?: number };
    };
    expect(requestPayload.instruction).toContain(visibleGoal);
    expect(requestPayload.scene_image_generation_request?.scene_id).toBe(selectedSceneId);
    const proposal = await proposalResponse.json() as {
      intent?: { operation?: string };
      assistant_message?: string;
      generation_job?: { id?: string; status?: string };
    };
    fs.writeFileSync(path.join(value.resultDir, "retained-editable-image-proposal-result.json"),
      `${JSON.stringify({ status: proposalResponse.status(), operation: proposal.intent?.operation,
        generationJobId: proposal.generation_job?.id,
        generationJobStatus: proposal.generation_job?.status }, null, 2)}\n`);
    expect(proposalResponse.status(), `image candidate request failed: ${proposalResponse.status()}`).toBe(202);
    expect(proposal.generation_job?.status).toBe("queued");
    expect(proposal.generation_job?.id).toBeTruthy();
    const deadline = Date.now() + 10 * 60_000;
    let candidateJob: { status?: string; error_code?: string; result_asset_id?: number | null } = {};
    while (Date.now() < deadline) {
      const jobResponse = await page.request.get(
        `${value.backendUrl}/v1/assets/generation-jobs/${proposal.generation_job?.id}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      expect(jobResponse.ok(), `candidate job read failed: ${jobResponse.status()}`).toBe(true);
      candidateJob = await jobResponse.json() as typeof candidateJob;
      if (candidateJob?.status === "completed" || candidateJob?.status === "failed") break;
      await page.waitForTimeout(4000);
    }
    fs.writeFileSync(candidateResultPath,
      `${JSON.stringify({ jobId: proposal.generation_job?.id, status: candidateJob?.status,
        errorCode: candidateJob?.error_code, resultAssetId: candidateJob?.result_asset_id }, null, 2)}\n`);
    expect(candidateJob?.status, `image candidate failed: ${candidateJob?.error_code ?? "timeout"}`).toBe("completed");
    expect(candidateJob?.result_asset_id).toBeGreaterThan(0);
    const directorAfter = await readAsset(page, value, token, value.directorAssetId);
    expect(directorAfter.content_hash).toBe(value.directorContentHash);
    const candidate = await readAsset(page, value, token, candidateJob.result_asset_id!);
    expect(candidate.asset_kind).toBe("image");
    const expectedRatio = originalAfter.metadata?.video_plan?.video_parameters?.ratio;
    const mediaRef = candidate.original_ref;
    expect(mediaRef).toMatch(/^(?:local|supabase|s3):\/\//);
    const mediaResponse = await page.request.get(
      `${value.backendUrl}/v1/video/media?ref=${encodeURIComponent(mediaRef!)}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(mediaResponse.ok(), `candidate media unavailable: ${mediaResponse.status()}`).toBe(true);
    const mediaBytes = await mediaResponse.body();
    expect(mediaBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    const imageFacts = { width: mediaBytes.readUInt32BE(16), height: mediaBytes.readUInt32BE(20) };
    if (expectedRatio === "16:9") {
      expect(imageFacts?.width).toBeGreaterThan(imageFacts?.height ?? 0);
    } else if (expectedRatio === "9:16") {
      expect(imageFacts?.height).toBeGreaterThan(imageFacts?.width ?? 0);
    }
  }
  fs.writeFileSync(path.join(value.resultDir, "retained-editable-source-choice-result.json"),
    `${JSON.stringify({ sourceAssetId: value.directorAssetId, sourceHash: value.directorContentHash,
      generationJobId: value.failedProductionJobId, sceneIds, selectedSceneId }, null, 2)}\n`);
}

async function readAsset(page: Page, value: Seed, token: string, id: number) {
  const response = await page.request.get(`${value.backendUrl}/v1/assets/detail/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `asset read failed: ${response.status()}`).toBe(true);
  return (await response.json() as { asset: {
    id: number;
    content_hash?: string;
    original_ref?: string | null;
    body?: string;
    content_type?: string;
    asset_kind?: string;
    metadata?: {
      director_draft_phase?: string;
      director_review?: { status?: string };
      video_plan?: { scenes?: unknown[]; production_confirmable?: boolean; video_parameters?: { ratio?: string } };
      image_render?: { width?: number; height?: number };
    };
    versions?: Array<{ id: number; version: number; body: string }>;
  } }).asset;
}

test("continues a saved reviewed director draft through the product's production action", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  if (!seed) throw new Error("VIDEO_PIPELINE_RETAINED_EDITABLE_SEED is missing");
  const login = await page.request.post(`${seed.backendUrl}/v1/auth/login`, {
    data: { email: seed.email, password: seed.password },
  });
  expect(login.ok(), `retained login failed: ${login.status()}`).toBe(true);
  const token = (await login.json() as { access_token: string }).access_token;
  expect(token).toBeTruthy();
  await page.addInitScript(({ email, accessToken }) => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email, token: accessToken }));
  }, { email: seed.email, accessToken: token });

  if (seed.restoreReviewedVersionId) {
    const restoreResponse = await page.request.post(
      `${seed.backendUrl}/v1/assets/${seed.directorAssetId}/versions/${seed.restoreReviewedVersionId}/restore`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(restoreResponse.ok(), `reviewed version restore failed: ${restoreResponse.status()} ${await restoreResponse.text()}`).toBe(true);
  }

  const original = await readAsset(page, seed, token, seed.directorAssetId);
  expect(original.content_hash).toBe(seed.directorContentHash);
  expect(original.metadata?.director_review?.status).toBe(seed.reviewStatus);
  expect(original.metadata?.video_plan?.scenes).toHaveLength(seed.expectedSceneCount);
  const reviewedVersion = original.versions?.slice().sort((a, b) => b.version - a.version)
    .find((version) => version.body === original.body);
  expect(reviewedVersion?.id, "reviewed director version is missing").toBeTruthy();
  const selectedImageIds = expectSelectedGeneratedImages
    ? (original.metadata?.video_plan?.scenes ?? [])
      .filter((item) => item && typeof item === "object" && /^scene-[2-5]$/.test(String((item as Record<string, unknown>).id)))
      .map((item) => ((item as Record<string, unknown>).asset_reference as Record<string, unknown> | undefined)?.chosen_asset_id)
    : [];
  if (expectSelectedGeneratedImages) {
    expect(selectedImageIds).toHaveLength(4);
    expect(selectedImageIds.every((id) => typeof id === "number" && id > 0)).toBe(true);
    expect(new Set(selectedImageIds).size).toBe(4);
  }

  await page.goto(`/app/assets?conversation=${encodeURIComponent(seed.conversationId)}`);
  if (seed.reviewStatus === "pending") {
    const retryButton = page.getByRole("button", { name: "重新审查当前稿" }).last();
    await expect(retryButton).toBeVisible({ timeout: 180_000 });
    const reviewResponsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST"
        && response.url().includes(`/v1/assets/${seed.directorAssetId}/director-review/retry`),
      { timeout: 180_000 },
    );
    await retryButton.click();
    const reviewResponse = await reviewResponsePromise;
    expect(reviewResponse.ok(), `review recovery failed: ${reviewResponse.status()} ${await reviewResponse.text()}`).toBe(true);
    const reviewed = await readAsset(page, seed, token, seed.directorAssetId);
    expect(reviewed.metadata?.director_review?.status).toBe("reviewed");
  }
  if (verifyRetainedSourceChoice) {
    expect(seed.failedProductionJobId).toBeTruthy();
    const jobResponse = await page.request.get(
      `${seed.backendUrl}/v1/assets/generation-jobs/${seed.failedProductionJobId}`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(jobResponse.ok()).toBe(true);
    await verifySourceChoiceUi(page, seed, token, await jobResponse.json() as SourceChoiceJob, original.body);
    return;
  }
  if (expectSelectedGeneratedImages) {
    const directorCard = page.locator(`a[href*="product=asset-${seed.directorAssetId}"]`).last();
    await expect(directorCard).toBeVisible({ timeout: 30_000 });
    await directorCard.click();
    await expect(page.getByRole("region", { name: "Current product workspace" })).toContainText("编导稿", { timeout: 30_000 });
  }
  const continueButton = page.getByRole("button", { name: "完善制作方案" }).last();
  await expect(continueButton).toBeVisible({ timeout: 180_000 });
  await expect(continueButton).toBeEnabled();
  const submission = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 180_000 },
  );
  await continueButton.click();
  const response = await submission;
  const responseText = await response.text();
  expect(response.ok(), `production action failed: ${response.status()} ${responseText}`).toBe(true);
  const request = response.request().postDataJSON() as {
    selected_product_id?: number;
    director_production_plan?: { director_asset_id?: number; base_content_hash?: string };
  };
  expect(request.selected_product_id).toBe(seed.directorAssetId);
  expect(request.director_production_plan).toMatchObject({
    director_asset_id: seed.directorAssetId,
    base_content_hash: seed.directorContentHash,
  });
  const submitted = JSON.parse(responseText) as {
    generation_job?: { id?: string; status?: string };
  };
  const jobId = submitted.generation_job?.id;
  expect(jobId, "production action did not queue a job").toBeTruthy();
  expect(["queued", "running"]).toContain(submitted.generation_job?.status);
  if (seed.failedProductionJobId) expect(jobId).toBe(seed.failedProductionJobId);

  let completed: {
    status?: string;
    result_asset_id?: number;
    error_code?: string;
    error_message?: string;
    failure_diagnostic?: { error_code?: string; stage?: string; scene_ids?: string[] };
    failure_context?: { source_asset_id?: number };
  } = {};
  await expect.poll(async () => {
    const jobResponse = await page.request.get(`${seed.backendUrl}/v1/assets/generation-jobs/${jobId}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!jobResponse.ok()) return `http-${jobResponse.status()}`;
    completed = await jobResponse.json();
    if (completed.status === "failed" && !expectSourceChoice) {
      throw new Error(`production planning failed (${completed.error_code ?? "unknown"}): ${completed.error_message ?? "unknown"}`);
    }
    return completed.status;
  }, { timeout: seed.directorJobTimeoutMs, intervals: [1000, 2500, 5000] })
    .toBe(expectSourceChoice ? "failed" : "completed");
  if (expectSourceChoice) {
    await verifySourceChoiceUi(page, seed, token, completed, original.body);
    return;
  }
  expect(completed.result_asset_id).toBeTruthy();
  const produced = await readAsset(page, seed, token, completed.result_asset_id!);
  expect(produced.content_type).toBe("video_script");
  expect(produced.metadata?.director_draft_phase).not.toBe("editable_reviewed");
  expect(produced.metadata?.video_plan?.scenes?.length).toBeGreaterThan(0);
  if (expectSelectedGeneratedImages) {
    const selectedScenes = (produced.metadata?.video_plan?.scenes ?? [])
      .filter((item) => item && typeof item === "object" && /^scene-[2-5]$/.test(String((item as Record<string, unknown>).id)))
      .map((item) => (item as Record<string, unknown>).asset_reference as Record<string, unknown> | undefined);
    const producedImageIds = selectedScenes.map((reference) => reference?.chosen_asset_id);
    expect(producedImageIds).toEqual(selectedImageIds);
    expect(selectedScenes.map((reference) => reference?.selection_mode)).toEqual(
      Array(4).fill("user_selected_generated_image"),
    );
  }
  const originalAfter = await readAsset(page, seed, token, seed.directorAssetId);
  if (produced.id === seed.directorAssetId) {
    expect(originalAfter.content_hash).toBe(produced.content_hash);
    expect(originalAfter.body).toBe(produced.body);
  } else {
    expect(originalAfter.content_hash).toBe(seed.directorContentHash);
    expect(originalAfter.body).toBe(original.body);
  }
  const reviewPreviewResponse = await page.request.get(
    `${seed.backendUrl}/v1/assets/${seed.directorAssetId}/versions/${reviewedVersion!.id}/preview`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(reviewPreviewResponse.ok(), "reviewed version preview failed").toBe(true);
  const reviewedSnapshot = await reviewPreviewResponse.json() as { content_hash?: string; body?: string };
  expect(reviewedSnapshot.content_hash).toBe(seed.directorContentHash);
  expect(reviewedSnapshot.body).toBe(original.body);

  fs.writeFileSync(path.join(seed.resultDir, "retained-editable-result.json"),
    `${JSON.stringify({ originalAssetId: seed.directorAssetId, originalHash: seed.directorContentHash,
      productionAssetId: produced.id, productionHash: produced.content_hash, generationJobId: jobId,
      sceneCount: produced.metadata?.video_plan?.scenes?.length }, null, 2)}\n`);
});
