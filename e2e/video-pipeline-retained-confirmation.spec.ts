import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";


type RetainedConfirmationSeed = {
  backendUrl: string;
  email: string;
  password: string;
  conversationId: string;
  directorAssetId: number;
  directorContentHash: string;
  expectedSceneCount: number;
  ratio: string;
  targetSeconds: number;
  aiVoiceEnabled: boolean;
  voiceSource: string;
  preserveSourceAudioBefore: boolean;
  generationJobId: string;
  resultDir: string;
};

type DirectorAsset = {
  id: number;
  content_type?: string;
  status?: string;
  generation_state?: string;
  content_hash?: string;
  metadata?: {
    video_plan?: {
      creative_profile?: { preserve_source_audio?: boolean };
      video_parameters?: {
        schema_version?: string;
        confirmed?: boolean;
        ratio?: string;
        target_seconds?: number;
        ai_voice_enabled?: boolean;
        voice_source?: string;
      };
      scenes?: Array<Record<string, unknown>>;
    };
  };
};

const seed = JSON.parse(
  process.env.VIDEO_PIPELINE_RETAINED_CONFIRMATION_SEED ?? "null",
) as RetainedConfirmationSeed | null;


async function authenticate(page: Page, value: RetainedConfirmationSeed): Promise<string> {
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


async function readAsset(
  page: Page,
  value: RetainedConfirmationSeed,
  token: string,
  assetId: number,
): Promise<DirectorAsset> {
  const response = await page.request.get(
    `${value.backendUrl}/v1/assets/detail/${assetId}`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  expect(response.ok(), `retained asset read failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { asset?: DirectorAsset };
  expect(body.asset, "retained asset detail returned no asset").toBeTruthy();
  return body.asset!;
}


test("confirms the retained director draft without repeating completed provider stages", async ({ page }) => {
  test.setTimeout(25 * 60_000);
  if (!seed) throw new Error("VIDEO_PIPELINE_RETAINED_CONFIRMATION_SEED is missing");
  fs.mkdirSync(seed.resultDir, { recursive: true });
  const mutatingRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH"].includes(request.method())) {
      mutatingRequests.push({ method: request.method(), url: request.url() });
    }
  });

  const token = await authenticate(page, seed);
  const headers = { authorization: `Bearer ${token}` };
  const directorBefore = await readAsset(page, seed, token, seed.directorAssetId);
  const planBefore = directorBefore.metadata?.video_plan;
  expect(directorBefore.content_type).toBe("video_script");
  expect(directorBefore.status).toBe("draft");
  expect(directorBefore.generation_state).toBe("director_script_draft");
  expect(directorBefore.content_hash).toBe(seed.directorContentHash);
  expect(planBefore?.scenes).toHaveLength(seed.expectedSceneCount);
  expect(planBefore?.video_parameters).toMatchObject({
    schema_version: "video_creation_policy:v1",
    confirmed: true,
    ratio: seed.ratio,
    target_seconds: seed.targetSeconds,
    ai_voice_enabled: seed.aiVoiceEnabled,
    voice_source: seed.voiceSource,
  });
  expect(planBefore?.creative_profile?.preserve_source_audio).toBe(
    seed.preserveSourceAudioBefore,
  );

  await page.goto(`/app/assets?conversation=${encodeURIComponent(seed.conversationId)}`);
  const pendingCard = page.getByLabel("视频方案 · 待确认").last();
  await expect(pendingCard).toBeVisible({ timeout: 180_000 });
  await expect(pendingCard).toContainText(seed.ratio);
  const confirmButton = pendingCard.locator("button.shadcn-prototype-confirm-primary");
  await expect(confirmButton).toBeEnabled();
  const confirmationPromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 180_000 },
  );
  await confirmButton.click();
  const confirmationResponse = await confirmationPromise;
  const confirmationText = await confirmationResponse.text();
  expect(
    confirmationResponse.ok(),
    `retained project confirmation failed: ${confirmationResponse.status()} ${confirmationText}`,
  ).toBe(true);
  const submitted = confirmationResponse.request().postDataJSON() as {
    selected_product_id?: number;
    video_project_confirmation?: {
      director_asset_id?: number;
      director_content_hash?: string;
      ratio?: string;
    };
  };
  expect(submitted.selected_product_id).toBe(seed.directorAssetId);
  expect(submitted.video_project_confirmation).toMatchObject({
    director_asset_id: seed.directorAssetId,
    director_content_hash: seed.directorContentHash,
    ratio: seed.ratio,
  });

  const confirmation = JSON.parse(confirmationText) as {
    product?: { metadata?: { latest_job_public_id?: string } };
    conversation?: {
      metadata?: { latest_job_public_id?: string };
      messages?: Array<{
        role?: string;
        metadata?: { job_public_id?: string };
      }>;
    };
  };
  const assistantJobId = confirmation.conversation?.messages
    ?.slice()
    .reverse()
    .find((message) => message.role === "assistant" && message.metadata?.job_public_id)
    ?.metadata?.job_public_id;
  const videoJobId = confirmation.product?.metadata?.latest_job_public_id
    ?? confirmation.conversation?.metadata?.latest_job_public_id
    ?? assistantJobId;
  expect(videoJobId, "retained confirmation returned no latest_job_public_id").toBeTruthy();

  let projectAssetId: number | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(
      `${seed.backendUrl}/v1/video/jobs/${videoJobId}`,
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

  const project = await readAsset(page, seed, token, projectAssetId!);
  const projectPlan = project.metadata?.video_plan;
  const expectedPreserveSourceAudio = seed.voiceSource === "source_audio";
  expect(project.content_type).toBe("video_project");
  expect(projectPlan?.video_parameters?.confirmed).toBe(true);
  expect(projectPlan?.creative_profile?.preserve_source_audio).toBe(
    expectedPreserveSourceAudio,
  );
  const forbiddenProviderStageRequests = mutatingRequests.filter(({ url }) => (
    /\/v1\/assets\/upload/.test(url)
    || /\/v1\/assets\/generation-jobs\/.+\/retry/.test(url)
  ));
  expect(forbiddenProviderStageRequests).toEqual([]);
  expect(
    mutatingRequests.filter(({ url }) => url.includes("/v1/assets/conversations/messages")),
  ).toHaveLength(1);

  fs.writeFileSync(
    path.join(seed.resultDir, "retained-director-confirmation-result.json"),
    `${JSON.stringify({
      generationJobId: seed.generationJobId,
      videoJobId,
      projectAssetId,
      preserveSourceAudioBefore: seed.preserveSourceAudioBefore,
      preserveSourceAudioAfter: projectPlan?.creative_profile?.preserve_source_audio,
      mutatingRequests,
    }, null, 2)}\n`,
  );
});
