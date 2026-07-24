import fs from "node:fs";
import path from "node:path";

import { expect, test, type APIResponse, type Page } from "@playwright/test";

import {
  PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION,
  selectProductionGeneratedRecomposeTarget,
} from "../test-support/video-pipeline-production-helpers";

const sourceDocument = process.env.VIDEO_PIPELINE_SOURCE_DOCUMENT;
const resultDir = process.env.VIDEO_PIPELINE_RESULT_DIR;
const scenario = process.env.VIDEO_PIPELINE_SCENARIO ?? "animated_explainer";
const requirePublicAsset =
  process.env.VIDEO_PIPELINE_REQUIRE_PUBLIC_ASSET === "true" ||
  scenario === "animated_public";
const hybridMediaFilesRaw = process.env.VIDEO_PIPELINE_HYBRID_MEDIA_FILES;
const expectResume = process.env.VIDEO_PIPELINE_EXPECT_RESUME === "true";
const expectTwoStage = process.env.VIDEO_PIPELINE_EXPECT_TWO_STAGE !== "false";
const expectBgm = process.env.VIDEO_PIPELINE_EXPECT_BGM !== "false";
const audioMixRatioTolerance = Number(
  process.env.VIDEO_PIPELINE_AUDIO_MIX_RATIO_TOLERANCE ?? "0.15",
);

type AssetRow = {
  id: number;
  content_type: string;
  metadata?: Record<string, unknown>;
};

type VideoProject = {
  metadata?: {
    duration?: number;
    bgm_choice?: { enabled?: boolean; catalog_id?: string };
    audio_mix?: {
      voice_to_music_ratio?: number;
      predicted_voice_to_music_ratio?: number;
      voice_lufs?: number;
      music_lufs?: number;
    };
    audio_mix_measurement_status?: string;
  };
  tracks?: Array<{
    id?: string;
    type?: string;
    overlay?: boolean;
    elements?: Array<{
      id?: string;
      type?: string;
      segmentId?: string;
      startTime?: number;
      duration?: number;
      content?: string;
      textRole?: string;
      metadata?: { sourceAssetId?: number; manifestFingerprint?: string };
      editDecision?: {
        layout?: string;
        presentation_support?: { headline?: string; items?: string[] };
      };
    }>;
  }>;
};

type AssetManifest = {
  plan_fingerprint?: string;
  scenes?: Array<{
    scene_id?: string;
    selected_asset?: {
      asset_id?: number;
      artifact_ref?: string;
      source_type?: string;
      provenance?: Record<string, unknown>;
    };
  }>;
};

type SceneRow = {
  id: string;
  narration?: string;
  subtitle_focus?: string;
  asset_requirement?: { evidence_required?: boolean };
  information_roles?: {
    narration?: string;
    subtitle?: string;
    primary_visual?: string;
    mg?: string;
  };
  information_increment_contract_version?: string;
  mg_brief?: {
    needed?: boolean;
    template?: string;
    information_gain?: string;
    params?: Record<string, unknown>;
  };
  mg_decision?: {
    needed?: boolean;
    chosen_template?: string;
    params_source?: string;
    status?: string;
    overlay_ref?: string;
  };
  primary_visual_strategy?: {
    mode?: string;
    presentation_variant?: string;
    presentation_support?: { headline?: string; items?: string[] };
  };
  primary_scene_spec?: {
    exactText?: string[];
    content?: { headline?: string };
  };
  primary_visual?: {
    status?: string;
    source_type?: string;
    asset_id?: number;
    artifact_ref?: string;
    strategy_mode?: string;
    provenance?: {
      grounding?: string;
      source_asset_id?: string;
      catalog_entry_id?: string;
      requested_presentation_variant?: string;
      effective_presentation_variant?: string;
      product_media_region_id?: string;
      presentation_fallback?: string;
    };
  };
};

type EditDecisionScene = {
  scene_id?: string;
  asset_id?: number;
  layout?: string;
  presentation_support?: { headline?: string; items?: string[] };
};

type QualityReport = {
  blockers?: Array<{ code?: string; segment_id?: string; message?: string }>;
  warnings?: Array<{ code?: string; segment_id?: string; message?: string }>;
  metrics?: {
    narration_coverage?: {
      required_scene_count?: number;
      covered_scene_count?: number;
      coverage_rate?: number;
      missing_scene_ids?: string[];
    };
    material_reuse?: {
      unique_material_rate?: number;
      repeated_groups?: Array<{
        scene_ids?: string[];
        intentional_scene_ids?: string[];
        unintentional_scene_ids?: string[];
      }>;
    };
    audio_mix?: {
      measurement_status?: string;
      voice_to_music_ratio?: number;
      predicted_voice_to_music_ratio?: number;
      voice_lufs?: number;
      music_lufs?: number;
      music_gain_db?: number;
      voice_true_peak_dbfs?: number;
    };
  };
};

async function enterWorkspace(page: Page) {
  await page.goto("/app/assets");
  const loginHeading = page.getByRole("heading", {
    name: "登录你的创作工作台",
  });
  const workspaceHeading = page.getByRole("heading", {
    name: "今天想做什么内容？",
  });
  const entry = await Promise.race([
    loginHeading
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "login" as const),
    workspaceHeading
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "workspace" as const),
  ]);
  if (entry === "login") {
    await page
      .locator(".multimix-auth-switch")
      .getByRole("button", { name: "注册" })
      .click();
    await page
      .getByLabel("邮箱或手机号")
      .fill(`video-pipeline-${Date.now()}@example.com`);
    await page.getByLabel("密码").fill("local-video-pipeline-2026");
    await page.locator("form").getByRole("button", { name: "注册" }).click();
  }
  await expect(workspaceHeading).toBeVisible({ timeout: 30_000 });
}

async function postConversation(page: Page, text: string) {
  await page.getByLabel("输入对话内容").fill(text);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 360_000 },
  );
  await page.getByRole("button", { name: "发送" }).click();
  const response = await responsePromise;
  const failureBody = response.ok() ? "" : await response.text();
  expect(
    response.ok(),
    `conversation request failed: ${response.status()} ${failureBody}`,
  ).toBe(true);
  return response;
}

async function waitForProjectReady(page: Page) {
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    const failed = page
      .getByText(/视频(?:工程)?生成失败|生成失败 · 可重试/)
      .last();
    if (await failed.isVisible().catch(() => false)) {
      throw new Error(
        `video project generation failed: ${await failed.innerText()}`,
      );
    }
    const summary = page.getByLabel("分镜摘要");
    if (await summary.isVisible().catch(() => false)) {
      const cards = summary.locator("li");
      if ((await cards.count()) === 6) return summary;
    }
    await page.waitForTimeout(2500);
  }
  throw new Error("timed out waiting for the six-scene video project");
}

function scenesFromAsset(asset: AssetRow): SceneRow[] {
  const plan = asset.metadata?.video_plan;
  if (
    !plan ||
    typeof plan !== "object" ||
    !Array.isArray((plan as { scenes?: unknown }).scenes)
  )
    return [];
  return (plan as { scenes: SceneRow[] }).scenes;
}

function hasValidPresentationSupport(
  support: { headline?: string; items?: string[] } | undefined,
) {
  return Boolean(
    support?.headline?.trim() &&
    Array.isArray(support.items) &&
    support.items.length >= 1 &&
    support.items.length <= 3 &&
    support.items.every((item) => typeof item === "string" && item.trim()),
  );
}

function normalizedVisibleText(value: string | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .toLocaleLowerCase();
}

function generatedPrimaryRepeatsNarration(scene: SceneRow) {
  if (scene.primary_visual?.source_type !== "generated_scene") return false;
  const headline =
    scene.primary_scene_spec?.content?.headline ??
    scene.primary_scene_spec?.exactText?.[0] ??
    "";
  return Boolean(
    headline.trim() &&
    normalizedVisibleText(headline) === normalizedVisibleText(scene.narration),
  );
}

test("produces six persisted visuals and recomposes only one scene", async ({
  page,
}) => {
  test.setTimeout(60 * 60_000);
  if (!sourceDocument || !fs.existsSync(sourceDocument)) {
    throw new Error(
      `VIDEO_PIPELINE_SOURCE_DOCUMENT is missing: ${sourceDocument ?? ""}`,
    );
  }
  if (!resultDir) throw new Error("VIDEO_PIPELINE_RESULT_DIR is required");
  fs.mkdirSync(resultDir, { recursive: true });
  const consoleErrors: string[] = [];
  const requestFailures: Array<{
    url: string;
    method: string;
    resourceType: string;
    error: string;
  }> = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const location = message.location();
    const suffix = location.url
      ? ` @ ${location.url}:${location.lineNumber ?? 0}:${location.columnNumber ?? 0}`
      : "";
    consoleErrors.push(`${message.text()}${suffix}`);
  });
  page.on("requestfailed", (request) => {
    requestFailures.push({
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      error: request.failure()?.errorText ?? "unknown",
    });
  });

  await enterWorkspace(page);
  const uploadPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/assets/upload"),
    { timeout: 180_000 },
  );
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传 PDF 或文档" }).click();
  await (await chooserPromise).setFiles(sourceDocument);
  const uploadResponse = await uploadPromise;
  expect(uploadResponse.ok(), `upload failed: ${uploadResponse.status()}`).toBe(
    true,
  );
  const authorization = uploadResponse.request().headers().authorization;
  const apiBase = new URL(uploadResponse.url()).origin;
  const headers: Record<string, string> = authorization
    ? { authorization }
    : {};

  if (scenario === "hybrid") {
    const hybridMediaFiles = JSON.parse(hybridMediaFilesRaw ?? "[]") as Array<{
      path?: string;
      name?: string;
    }>;
    expect(
      hybridMediaFiles.length,
      "hybrid scenario requires at least three saved venue/process/case media files",
    ).toBeGreaterThanOrEqual(3);
    for (const [index, entry] of hybridMediaFiles.entries()) {
      const mediaPath = path.resolve(entry.path ?? "");
      expect(
        fs.existsSync(mediaPath),
        `hybrid media is missing: ${mediaPath}`,
      ).toBe(true);
      const extension = path.extname(mediaPath).toLowerCase();
      const isVideo = extension === ".mp4";
      expect(
        [".jpg", ".jpeg", ".png", ".mp4"],
        `unsupported hybrid media: ${extension}`,
      ).toContain(extension);
      const mimeType = isVideo
        ? "video/mp4"
        : extension === ".jpg" || extension === ".jpeg"
          ? "image/jpeg"
          : "image/png";
      const mediaKind = isVideo ? "video" : "image";
      const mediaResponse = await page.request.post(
        `${apiBase}/v1/assets/upload`,
        {
        headers,
        multipart: {
          file: {
            name: entry.name ?? `真实门店与过程素材${index + 1}${extension}`,
            mimeType,
            buffer: fs.readFileSync(mediaPath),
          },
          target_kind: mediaKind,
        },
        },
      );
      expect(
        mediaResponse.ok(),
        `hybrid saved-media upload failed: ${mediaResponse.status()} ${await mediaResponse.text()}`,
      ).toBe(true);
    }
  }

  const generationResponse = await postConversation(
    page,
    scenario === "hybrid"
      ? "严格基于刚上传的资料以及真实展厅、空间规划和施工改造视频，制作一条30秒、16:9横屏的商家内容示范片。让真实门店与服务过程素材主导叙事。请用其中一个分镜准确呈现资料中已核验的产品能力：MultiMix 可以把上传资料与已保存图片、视频组织成6个可编辑分镜；这条产品能力声明必须使用批准的产品界面或忠于原文的事实卡作为证据。其他镜头只在解释流程时使用动态图解；不得把通用素材说成客户案例、前后对比或效果证明。先给出编导稿和6个分镜，不要展示内部制作方式。"
      : scenario === "animated_public"
        ? "严格基于刚上传的 MultiMix 产品资料，制作一条30秒、16:9横屏的产品介绍视频。开场或商家痛点/工作场景至少一个分镜必须使用经过网络搜索、视觉验证和授权校验的真实公共图片或视频作为通用 B-roll；产品界面和产品能力镜头继续使用审核产品素材或忠于资料的准确生成画面，不得把公共素材冒充产品界面、客户案例、效果证据或前后对比。先给出编导稿和6个分镜；信息不足按合理默认值处理，不要展示内部制作方式。"
        : "严格基于刚上传的 MultiMix 产品资料，制作一条30秒、16:9横屏的产品介绍视频。把工作台/对话、分镜编辑/视频预览设计成两个不同的产品界面分镜，分别使用已审核产品截图，不要把整张截图直接重复铺成背景；其中至少一个界面分镜把截图证据与来源中存在且不与旁白、字幕重复的补充信息分区呈现，优先保证截图清晰可读。至少一个流程分镜使用 MG 动画补充真实步骤、差异或结构，不得重复旁白和字幕，也不得使用空泛对比项。先给出编导稿和6个分镜；信息不足按合理默认值处理，不要展示内部制作方式。",
  );
  const generationPayload = (await generationResponse.json()) as {
    generation_job?: { id?: string };
  };
  const generationJobId = generationPayload.generation_job?.id;
  expect(
    generationJobId,
    "queued conversation response must include a generation job",
  ).toBeTruthy();
  await expect
    .poll(
      async () => {
    let response: APIResponse;
    try {
      response = await page.request.get(
        `${apiBase}/v1/assets/generation-jobs/${generationJobId}`,
        { headers },
      );
    } catch (error) {
      return `transport-error:${error instanceof Error ? error.message : String(error)}`;
    }
    if (!response.ok()) return `http-${response.status()}`;
        const job = (await response.json()) as {
      status?: string;
      error_code?: string;
      error_message?: string;
    };
    if (job.status === "failed") {
      throw new Error(
        `director generation failed (${job.error_code ?? "unknown"}): ${job.error_message ?? "unknown error"}`,
      );
    }
    return job.status;
      },
      { timeout: 20 * 60_000, intervals: [1000, 2500, 5000] },
    )
    .toBe("completed");
  const narrationBlocked = page
    .getByText(/口播质检未通过|当前不能确认生成视频工程/)
    .last();
  if (await narrationBlocked.isVisible().catch(() => false)) {
    throw new Error(
      `director narration quality blocked: ${await narrationBlocked.innerText()}`,
    );
  }
  const pendingCard = page
    .locator(".shadcn-prototype-confirm-card.pending")
    .last();
  await expect(pendingCard).toBeVisible({ timeout: 180_000 });
  const confirmButton = pendingCard.locator(
    "button.shadcn-prototype-confirm-primary",
  );
  await expect(confirmButton).toBeEnabled();
  const confirmationPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 180_000 },
  );
  await confirmButton.click();
  const confirmationResponse = await confirmationPromise;
  const confirmationText = await confirmationResponse.text();
  expect(
    confirmationResponse.ok(),
    `confirmation failed: ${confirmationResponse.status()} ${confirmationText}`,
  ).toBe(true);
  const confirmationPayload = JSON.parse(confirmationText) as {
    conversation?: {
      metadata?: { latest_job_public_id?: string };
    };
  };
  const videoJobId =
    confirmationPayload.conversation?.metadata?.latest_job_public_id;
  expect(
    videoJobId,
    "confirmation aggregate must contain the queued video job id",
  ).toBeTruthy();
  await expect
    .poll(
      async () => {
    let response: APIResponse;
    try {
          response = await page.request.get(
            `${apiBase}/v1/video/jobs/${videoJobId}`,
            { headers },
          );
    } catch (error) {
      return `transport-error:${error instanceof Error ? error.message : String(error)}`;
    }
    if (!response.ok()) return `http-${response.status()}`;
        const job = (await response.json()) as {
          status?: string;
          error_message?: string;
        };
    if (job.status === "failed") {
          throw new Error(
            `video project generation failed: ${job.error_message ?? "unknown error"}`,
          );
    }
    return job.status;
      },
      { timeout: 20 * 60_000, intervals: [1000, 2500, 5000] },
    )
    .toBe("completed");

  const summary = await waitForProjectReady(page);
  const cards = summary.locator("li");
  await expect(cards).toHaveCount(6);
  await expect(summary.getByText("待补素材")).toHaveCount(0);
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(
    /animated_explainer|\bhybrid\b|\bVLM\b|\bProvider\b|\bRemotion\b/i,
  );
  expect(visibleText).not.toMatch(/待补素材|字幕\/标题卡占位/);
  const confirmedPlanCard = page
    .locator(".shadcn-prototype-confirm-card")
    .last();
  await expect(confirmedPlanCard).toContainText("横屏 16:9");
  await expect(confirmedPlanCard).not.toContainText("竖屏 9:16");

  const listResponse = await page.request.get(`${apiBase}/v1/assets`, {
    headers,
  });
  expect(listResponse.ok()).toBe(true);
  const assets = (await listResponse.json()) as AssetRow[];
  let projectAsset = assets
    .filter(
      (asset) =>
        asset.content_type === "video_render" &&
        asset.metadata?.video_plan &&
        typeof asset.metadata.video_plan === "object",
    )
    .at(-1);
  expect(
    projectAsset,
    "video_render asset with video_plan should exist after confirmation",
  ).toBeTruthy();
  let pipelineCode: string | undefined = expectTwoStage ? undefined : "legacy";
  let beforeScenes = scenesFromAsset(projectAsset!);
  let incrementMgScenes: SceneRow[] = [];
  if (expectTwoStage) {
    const persistedPipelineDecision = (
      projectAsset!.metadata!.video_plan as {
    internal_production?: {
      pipeline_decision?: {
        information_increment_intent?: { minimum_mg_scenes?: number };
        product_presentation_intent?: {
          minimum_split_support_scenes?: number;
          minimum_distinct_product_media_entries?: number;
          required_product_media_roles?: string[];
        };
      };
    };
      }
    ).internal_production?.pipeline_decision;
  expect(
      persistedPipelineDecision?.information_increment_intent
        ?.minimum_mg_scenes,
    "the async director path must preserve the user's explicit MG minimum",
  ).toBeGreaterThanOrEqual(1);
  expect(
      persistedPipelineDecision?.product_presentation_intent
        ?.minimum_split_support_scenes,
    "the async director path must preserve the user's explicit split-support minimum",
  ).toBeGreaterThanOrEqual(1);
  expect(
    persistedPipelineDecision?.product_presentation_intent
      ?.minimum_distinct_product_media_entries,
    "the async director path must preserve the explicit distinct reviewed-media minimum",
  ).toBeGreaterThanOrEqual(2);
    expect(
      new Set(
    persistedPipelineDecision?.product_presentation_intent
      ?.required_product_media_roles ?? [],
      ).size,
    ).toBeGreaterThanOrEqual(2);
    await expect
      .poll(
        async () => {
          const response = await page.request.get(`${apiBase}/v1/assets`, {
            headers,
          });
    if (!response.ok()) return `http-${response.status()}`;
          const current = ((await response.json()) as AssetRow[]).find(
      (asset) => asset.id === projectAsset!.id,
    );
    if (!current) return "asset-missing";
    const plannedMgScenes = scenesFromAsset(current).filter(
      (scene) => scene.mg_brief?.needed === true,
    );
    if (plannedMgScenes.length === 0) {
      throw new Error(
        "director ignored the explicit request for at least one grounded information-increment MG scene",
      );
    }
    const pending = plannedMgScenes.filter(
            (scene) =>
              !new Set(["rendered", "failed"]).has(
                scene.mg_decision?.status ?? "",
              ),
    );
    if (pending.length > 0) {
      return `mg-pending:${pending.map((scene) => scene.id).join(",")}`;
    }
    const rendered = plannedMgScenes.filter(
      (scene) => scene.mg_decision?.status === "rendered",
    );
    if (rendered.length === 0) {
            throw new Error(
              "all information-increment MG scenes reached a failed terminal state",
            );
    }
    projectAsset = current;
    return "ready";
        },
        { timeout: 15 * 60_000, intervals: [1000, 2500, 5000] },
      )
      .toBe("ready");
    const persistedVideoPlan = projectAsset!.metadata?.video_plan as {
    mg_plan?: { layout?: string };
    internal_production?: { skill_package?: { code?: string } };
  };
  expect(persistedVideoPlan.mg_plan?.layout).toBe("landscape");
    pipelineCode = persistedVideoPlan.internal_production?.skill_package?.code;
    expect(pipelineCode).toBe(
      scenario === "animated_public" ? "animated_explainer" : scenario,
    );
    beforeScenes = scenesFromAsset(projectAsset!);
  expect(beforeScenes).toHaveLength(6);
  const informationRoleKeys = [
    "narration",
    "subtitle",
    "primary_visual",
    "mg",
  ];
  for (const scene of beforeScenes) {
    expect(scene.information_increment_contract_version).toBe(
      "scene_information_increment_v1",
    );
    expect(Object.keys(scene.information_roles ?? {}).sort()).toEqual(
      [...informationRoleKeys].sort(),
    );
    expect(scene.information_roles?.narration?.trim()).toBeTruthy();
    expect(scene.information_roles?.subtitle?.trim()).toBeTruthy();
    expect(scene.information_roles?.primary_visual?.trim()).toBeTruthy();
    expect(typeof scene.mg_brief?.needed).toBe("boolean");
      expect(
        scene.mg_brief?.params && typeof scene.mg_brief.params === "object",
      ).toBeTruthy();
    if (scene.mg_brief?.needed) {
      expect(scene.information_roles?.mg?.trim()).toBeTruthy();
      expect(scene.mg_brief.template?.trim()).toBeTruthy();
      expect(scene.mg_brief.information_gain?.trim()).toBeTruthy();
      expect(scene.mg_decision?.needed).toBe(true);
        expect(scene.mg_decision?.chosen_template).toBe(
          scene.mg_brief.template,
        );
      expect(scene.mg_decision?.params_source).toBe("model_structured");
    } else {
      expect(scene.information_roles?.mg ?? "").toBe("");
    }
  }
    incrementMgScenes = beforeScenes.filter(
      (scene) => scene.mg_brief?.needed === true,
    );
  expect(
    incrementMgScenes.length,
    "the confirmed director plan must contain at least one information-increment MG scene",
  ).toBeGreaterThan(0);
  expect(
      incrementMgScenes.some(
        (scene) => scene.mg_decision?.status === "rendered",
      ),
    "at least one information-increment MG scene must be rendered into the candidate",
  ).toBe(true);
    expect(
      beforeScenes.every(
        (scene) =>
          scene.primary_visual?.status === "persisted" &&
          Boolean(scene.primary_visual.artifact_ref) &&
          !/^https?:\/\//.test(scene.primary_visual.artifact_ref ?? ""),
      ),
    ).toBe(true);
  for (let index = 1; index < beforeScenes.length; index += 1) {
    expect(
      beforeScenes[index].primary_visual?.artifact_ref,
      `adjacent scenes ${beforeScenes[index - 1].id}/${beforeScenes[index].id} must not reuse one main visual`,
    ).not.toBe(beforeScenes[index - 1].primary_visual?.artifact_ref);
  }
  if (scenario === "hybrid") {
      const savedSourceIds = new Set(
        beforeScenes
          .filter(
            (scene) => scene.primary_visual?.source_type === "saved_asset",
          )
      .map((scene) => scene.primary_visual?.provenance?.source_asset_id)
          .filter(Boolean),
      );
    expect(
      savedSourceIds.size,
      "hybrid should consume all three already-ranked uploaded clips before generated fallback",
    ).toBeGreaterThanOrEqual(3);
      const evidenceScenes = beforeScenes.filter(
        (scene) => scene.asset_requirement?.evidence_required === true,
      );
      expect(
        evidenceScenes.length,
        "hybrid should include at least one grounded evidence scene",
      ).toBeGreaterThan(0);
    for (const scene of evidenceScenes) {
      expect(scene.primary_visual?.source_type).not.toBe("public_asset");
      if (scene.primary_visual?.source_type === "generated_scene") {
          expect(scene.primary_visual.provenance?.grounding).toBe(
            "confirmed_fact",
          );
      }
    }
  } else {
      expect(
        beforeScenes.some(
          (scene) => scene.primary_visual?.source_type === "product_asset",
        ),
      ).toBe(true);
    if (scenario === "animated_explainer") {
      const productScenes = beforeScenes.filter(
        (scene) => scene.primary_visual?.source_type === "product_asset",
      );
      expect(
        productScenes.length,
        "the two distinct reviewed product captures must both be used",
      ).toBeGreaterThanOrEqual(2);
        expect(
          new Set(
            productScenes
              .map(
        (scene) => scene.primary_visual?.provenance?.catalog_entry_id,
              )
              .filter(Boolean),
          ).size,
        ).toBeGreaterThanOrEqual(2);
        const allowedVariants = new Set([
          "overview_frame",
          "focus_crop",
          "split_support",
        ]);
      for (const scene of productScenes) {
        const provenance = scene.primary_visual?.provenance;
          const effectiveVariant =
            provenance?.effective_presentation_variant ?? "";
        expect(
          scene.mg_brief?.needed,
          `product evidence scene ${scene.id} must not compete with an information MG overlay`,
        ).toBe(false);
        expect(scene.mg_decision?.needed).toBe(false);
        expect(allowedVariants.has(effectiveVariant)).toBe(true);
        expect(provenance?.presentation_fallback).toBeFalsy();
          if (
            effectiveVariant === "focus_crop" ||
            effectiveVariant === "split_support"
          ) {
          expect(provenance?.product_media_region_id).toBeTruthy();
        }
      }
      const splitScenes = productScenes.filter(
          (scene) =>
            scene.primary_visual?.provenance?.effective_presentation_variant ===
            "split_support",
      );
      expect(
        splitScenes.length,
        "at least one reviewed screenshot must use the single-pass split_support presentation",
      ).toBeGreaterThan(0);
      for (const scene of splitScenes) {
          expect(scene.primary_visual_strategy?.presentation_variant).toBe(
            "split_support",
          );
          expect(
            hasValidPresentationSupport(
          scene.primary_visual_strategy?.presentation_support,
            ),
          ).toBe(true);
      }
    }
  }
  for (const scene of beforeScenes) {
    const mediaResponse = await page.request.get(
      `${apiBase}/v1/video/media?ref=${encodeURIComponent(scene.primary_visual!.artifact_ref!)}`,
      { headers: { range: "bytes=0-15" } },
    );
    expect(
      mediaResponse.ok(),
      `persisted ${scene.primary_visual?.source_type ?? "unknown"} media should be readable: ${scene.primary_visual?.artifact_ref}`,
    ).toBe(true);
      expect(mediaResponse.headers()["content-type"]).toMatch(
        /^image\/|^video\//,
      );
  }
  }
  expect(beforeScenes).toHaveLength(6);
  const videoProject = projectAsset!.metadata?.video_project as
    VideoProject | undefined;
  const assetManifest = projectAsset!.metadata?.asset_manifest as
    AssetManifest | undefined;
  const editDecisions = projectAsset!.metadata?.edit_decisions as
    | {
    scenes?: EditDecisionScene[];
      }
    | undefined;
  if (expectTwoStage) {
    expect(assetManifest?.scenes).toHaveLength(6);
    expect(editDecisions?.scenes).toHaveLength(6);
  }
  const manifestAssets = Object.fromEntries(
    (assetManifest?.scenes ?? []).map((scene) => [
      scene.scene_id,
      scene.selected_asset?.asset_id,
    ]),
  );
  const editAssets = Object.fromEntries(
    (editDecisions?.scenes ?? []).map((scene) => [
      scene.scene_id,
      scene.asset_id,
    ]),
  );
  const mainTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-video",
  );
  const projectAssets = Object.fromEntries(
    (mainTrack?.elements ?? []).map((element) => [
      element.segmentId,
      element.metadata?.sourceAssetId,
    ]),
  );
  const manifestProjectReferenceMatch =
    JSON.stringify(manifestAssets) === JSON.stringify(projectAssets) &&
    JSON.stringify(manifestAssets) === JSON.stringify(editAssets);
  const publicCandidateOnlyCount = (assetManifest?.scenes ?? []).filter(
    (scene) => /^https?:\/\//.test(scene.selected_asset?.artifact_ref ?? ""),
  ).length;
  const publicManifestScenes = (assetManifest?.scenes ?? []).filter(
    (scene) => scene.selected_asset?.source_type === "public_asset",
  );
  if (expectTwoStage) {
    expect(manifestProjectReferenceMatch).toBe(true);
    expect(publicCandidateOnlyCount).toBe(0);
  }
  const sortedMainElements = [...(mainTrack?.elements ?? [])].sort(
    (left, right) => Number(left.startTime ?? 0) - Number(right.startTime ?? 0),
  );
  expect(sortedMainElements.length).toBeGreaterThanOrEqual(6);
  expect(Number(sortedMainElements[0]?.startTime ?? -1)).toBeCloseTo(0, 2);
  for (let index = 1; index < sortedMainElements.length; index += 1) {
    const previousEnd =
      Number(sortedMainElements[index - 1].startTime ?? 0) +
      Number(sortedMainElements[index - 1].duration ?? 0);
    expect(
      Math.abs(Number(sortedMainElements[index].startTime ?? 0) - previousEnd),
      `main track must remain continuous before element ${index + 1}`,
    ).toBeLessThanOrEqual(0.01);
  }
  const projectDuration = Number(videoProject?.metadata?.duration);
  const mainTrackEnd =
    Number(sortedMainElements.at(-1)?.startTime ?? 0) +
    Number(sortedMainElements.at(-1)?.duration ?? 0);
  expect(Math.abs(mainTrackEnd - projectDuration)).toBeLessThanOrEqual(0.01);

  const supportTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-support",
  );
  const presentationSupportElements = (mainTrack?.elements ?? []).filter(
    (element) =>
      hasValidPresentationSupport(element.editDecision?.presentation_support),
  );
  if (expectTwoStage) {
    const decisionByScene = Object.fromEntries(
      (editDecisions?.scenes ?? []).map((decision) => [
        decision.scene_id,
        decision,
      ]),
    );
    for (const manifestScene of assetManifest?.scenes ?? []) {
      const variant = String(
        manifestScene.selected_asset?.provenance
          ?.effective_presentation_variant ?? "",
      );
      const decision = decisionByScene[manifestScene.scene_id ?? ""];
      if (variant === "overview_frame" || variant === "focus_crop") {
        expect(["full", "product_focus"]).toContain(decision?.layout);
      }
      if (variant === "split_support") {
        expect(decision?.layout).toBe("split");
        expect(
          hasValidPresentationSupport(decision?.presentation_support),
        ).toBe(true);
      }
    }
    expect(presentationSupportElements.length).toBeGreaterThan(0);
    expect(supportTrack?.elements?.length).toBe(
      presentationSupportElements.length,
    );
    for (const element of presentationSupportElements) {
      expect(element.editDecision?.layout).toBe("split");
      expect(
        hasValidPresentationSupport(element.editDecision?.presentation_support),
      ).toBe(true);
      const supportElement = supportTrack?.elements?.find(
        (candidate) => candidate.segmentId === element.segmentId,
      );
      expect(supportElement?.textRole).toBe("presentation_support");
      expect(String(supportElement?.content ?? "").split(/\r?\n/)).toHaveLength(
        1 + (element.editDecision?.presentation_support?.items?.length ?? 0),
      );
    }
  }

  const narrationTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-audio",
  );
  expect(
    new Set(
      (narrationTrack?.elements ?? []).map((element) => element.segmentId),
    ).size,
  ).toBe(6);
  const subtitleTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-text",
  );
  const subtitleSegmentIds = new Set(
    (subtitleTrack?.elements ?? []).map((element) => element.segmentId),
  );
  for (const scene of beforeScenes) {
    const repeatedGeneratedHeadline = generatedPrimaryRepeatsNarration(scene);
    expect(
      subtitleSegmentIds.has(scene.id),
      repeatedGeneratedHeadline
        ? `generated headline already carries the full narration for ${scene.id}`
        : `non-duplicated narration still requires subtitles for ${scene.id}`,
    ).toBe(!repeatedGeneratedHeadline);
  }
  const mgOverlayTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-overlay" && track.overlay === true,
  );
  if (expectTwoStage)
    expect(mgOverlayTrack?.elements?.length).toBeGreaterThan(0);
  if (expectTwoStage && requirePublicAsset) {
    expect(
      publicManifestScenes.length,
      "animated_public must adopt at least one verified and persisted public asset",
    ).toBeGreaterThan(0);
    for (const manifestScene of publicManifestScenes) {
      const selected = manifestScene.selected_asset!;
      expect(selected.asset_id).toBeGreaterThan(0);
      expect(selected.artifact_ref?.startsWith("local://")).toBe(true);
      expect(selected.provenance?.provider).toBeTruthy();
      expect(selected.provenance?.provider_item_id).toBeTruthy();
      expect(selected.provenance?.license_snapshot).toBeTruthy();
      const sourceAssetId = Number(selected.provenance?.source_asset_id);
      expect(
        Number.isInteger(sourceAssetId) && sourceAssetId > 0,
        "public orchestration copy must retain its owned source asset id",
      ).toBe(true);
      const ownedDownload = await page.request.get(
        `${apiBase}/v1/assets/${sourceAssetId}/download`,
        { headers: { ...headers, range: "bytes=0-15" } },
      );
      expect(
        ownedDownload.ok(),
        `public source asset ${sourceAssetId} must be readable by the current E2E user`,
      ).toBe(true);
      const projectedScene = beforeScenes.find(
        (scene) => scene.id === manifestScene.scene_id,
      );
      expect(projectedScene?.primary_visual?.source_type).toBe("public_asset");
      expect(projectedScene?.primary_visual?.asset_id).toBe(selected.asset_id);
      expect(projectedScene?.primary_visual?.artifact_ref).toBe(
        selected.artifact_ref,
      );
    }
  }
  const bgmTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-bgm",
  );
  if (expectBgm) {
    expect(videoProject?.metadata?.bgm_choice?.enabled).toBe(true);
    expect(videoProject?.metadata?.bgm_choice?.catalog_id).toBeTruthy();
    expect(bgmTrack?.type).toBe("audio");
    expect(bgmTrack?.elements?.length).toBeGreaterThan(0);
  } else {
    expect(videoProject?.metadata?.bgm_choice?.enabled).toBe(false);
    expect(
      bgmTrack,
      "intentional no-BGM degradation must not create a music track",
    ).toBeUndefined();
  }

  const beforeRefs = Object.fromEntries(
    beforeScenes.map((scene) => [
    scene.id,
    scene.primary_visual?.artifact_ref ?? projectAssets[scene.id] ?? null,
    ]),
  );
  let afterScenes = beforeScenes;
  let afterRefs = beforeRefs;
  let targetSegmentId: string | null = null;
  let recomposeTested = false;
  if (expectTwoStage) {
    const target = selectProductionGeneratedRecomposeTarget(beforeScenes);
    if (!target) {
      throw new Error(
        "two-stage production E2E requires a persisted generated primary for deterministic recompose",
      );
    }
    const targetMode = target.primary_visual_strategy?.mode;
    expect(
      targetMode,
      "generated recompose target must expose its current visual mode",
    ).toBeTruthy();
    targetSegmentId = target.id;
    const recomposeResponse = await page.request.post(
    `${apiBase}/v1/video/projects/${projectAsset!.id}/segments/${target.id}/recompose`,
    {
      headers: { ...headers, "content-type": "application/json" },
      data: {
        operation: "regenerate_primary_visual",
          visual_instruction: PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION,
          visual_mode_policy: "preserve",
        confirm_overwrite: false,
      },
    },
  );
    expect(
      recomposeResponse.ok(),
      `recompose failed: ${recomposeResponse.status()} ${await recomposeResponse.text()}`,
    ).toBe(true);
    const recomposeJob = (await recomposeResponse.json()) as {
      id?: string;
      public_id?: string;
    };
  const jobId = recomposeJob.id ?? recomposeJob.public_id;
  expect(jobId).toBeTruthy();
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `${apiBase}/v1/video/jobs/${jobId}`,
            { headers },
          );
    if (!response.ok()) return `http-${response.status()}`;
          const job = (await response.json()) as {
            status?: string;
            error_message?: string;
          };
          if (job.status === "failed")
            throw new Error(
              job.error_message || "single-scene recompose failed",
            );
    return job.status;
        },
        { timeout: 10 * 60_000, intervals: [1000, 2500, 5000] },
      )
      .toBe("completed");

    const refreshedResponse = await page.request.get(`${apiBase}/v1/assets`, {
      headers,
    });
  expect(refreshedResponse.ok()).toBe(true);
    const refreshedAssets = (await refreshedResponse.json()) as AssetRow[];
    const refreshed = refreshedAssets.find(
      (asset) => asset.id === projectAsset!.id,
    );
    expect(
      refreshed,
      "recomposed video_render asset should remain in the library",
    ).toBeTruthy();
    afterScenes = scenesFromAsset(refreshed!);
  expect(afterScenes).toHaveLength(6);
  for (const before of beforeScenes) {
    const after = afterScenes.find((scene) => scene.id === before.id)!;
    if (before.id === target.id) {
      expect(after.primary_visual?.status).toBe("persisted");
        expect(after.primary_visual?.artifact_ref).not.toBe(
          before.primary_visual?.artifact_ref,
        );
        expect(after.primary_visual_strategy?.mode).toBe(targetMode);
        expect(after.primary_visual?.strategy_mode).toBe(targetMode);
        if (before.mg_decision?.status === "rendered") {
          expect(after.mg_decision?.status).toBe("rendered");
          expect(after.mg_decision?.overlay_ref).toBe(
            before.mg_decision.overlay_ref,
          );
        }
    } else {
        expect(after.primary_visual?.artifact_ref).toBe(
          before.primary_visual?.artifact_ref,
        );
    }
  }
    const postRecomposeProject = refreshed?.metadata?.video_project as
      VideoProject | undefined;
  const postRecomposeMainTrack = postRecomposeProject?.tracks?.find(
    (track) => track.id === "track-video",
  );
  const postRecomposeSupportTrack = postRecomposeProject?.tracks?.find(
    (track) => track.id === "track-support",
  );
  const postRecomposePresentationSupportElements = (
    postRecomposeMainTrack?.elements ?? []
    ).filter((element) =>
      hasValidPresentationSupport(element.editDecision?.presentation_support),
  );
  expect(postRecomposePresentationSupportElements.length).toBeGreaterThan(0);
  expect(postRecomposeSupportTrack?.elements?.length).toBe(
    postRecomposePresentationSupportElements.length,
  );
  for (const element of postRecomposePresentationSupportElements) {
    expect(element.editDecision?.layout).toBe("split");
      expect(
        hasValidPresentationSupport(element.editDecision?.presentation_support),
      ).toBe(true);
    const supportElement = postRecomposeSupportTrack?.elements?.find(
      (candidate) => candidate.segmentId === element.segmentId,
    );
    expect(supportElement?.textRole).toBe("presentation_support");
    expect(String(supportElement?.content ?? "").split(/\r?\n/)).toHaveLength(
      1 + (element.editDecision?.presentation_support?.items?.length ?? 0),
    );
  }
    afterRefs = Object.fromEntries(
      afterScenes.map((scene) => [
      scene.id,
      scene.primary_visual?.artifact_ref ?? projectAssets[scene.id] ?? null,
      ]),
    );
    recomposeTested = true;
  }

  await page.reload();
  await expect(page.getByLabel("分镜摘要").locator("li")).toHaveCount(6, {
    timeout: 120_000,
  });
  await expect(page.getByLabel("分镜摘要").getByText("待补素材")).toHaveCount(
    0,
  );
  // Shared quality and export contract for both pipeline modes.
  let finalQualityReport: QualityReport | undefined;
  await expect
    .poll(
      async () => {
    let response: APIResponse;
    try {
      response = await page.request.get(
        `${apiBase}/v1/video/projects/${projectAsset!.id}/quality?stage=export_preflight`,
        { headers },
      );
    } catch (error) {
      return `transport-error:${error instanceof Error ? error.message : String(error)}`;
    }
    if (!response.ok()) return `http-${response.status()}`;
        const report = (await response.json()) as QualityReport;
    if (report.blockers?.length) {
      return JSON.stringify(
            report.blockers.map((blocker) => ({
              code: blocker.code,
              message: blocker.message,
            })),
      );
    }
    finalQualityReport = report;
    return "ready";
      },
      { timeout: 10 * 60_000, intervals: [2500, 5000, 10_000] },
    )
    .toBe("ready");
  expect(finalQualityReport).toBeTruthy();
  const qualityReport = finalQualityReport!;
  const narrationCoverage = qualityReport.metrics?.narration_coverage;
  expect(narrationCoverage?.coverage_rate).toBe(1);
  expect(narrationCoverage?.missing_scene_ids ?? []).toEqual([]);
  const reuseGroups =
    qualityReport.metrics?.material_reuse?.repeated_groups ?? [];
  const reportedReuseSceneIds = new Set(
    (qualityReport.warnings ?? [])
      .filter((warning) => warning.code === "unintentional_material_reuse")
      .map((warning) => warning.segment_id)
      .filter((sceneId): sceneId is string => Boolean(sceneId)),
  );
  for (const group of reuseGroups) {
    for (const sceneId of group.unintentional_scene_ids ?? []) {
      expect(
        reportedReuseSceneIds.has(sceneId),
        "unintentional reuse must be explicitly reported: " + sceneId,
      ).toBe(true);
    }
  }
  const audioMix = qualityReport.metrics?.audio_mix;
  if (expectBgm) {
    expect(audioMix?.measurement_status).toBe("measured");
    const targetRatio = Number(audioMix?.voice_to_music_ratio);
    const predictedRatio = Number(audioMix?.predicted_voice_to_music_ratio);
    expect(Number.isFinite(targetRatio) && targetRatio > 1).toBe(true);
    expect(
      Math.abs(predictedRatio - targetRatio) / targetRatio,
    ).toBeLessThanOrEqual(audioMixRatioTolerance);
  } else {
    expect(audioMix?.measurement_status ?? "not_applicable").not.toBe(
      "measured",
    );
  }
  await page.reload();
  await expect(page.getByLabel("分镜摘要").locator("li")).toHaveCount(6, {
    timeout: 120_000,
  });
  const exportButton = page
    .locator("button.shadcn-prototype-open-editor")
    .last();
  await expect(exportButton).toHaveText("导出视频", { timeout: 180_000 });
  await expect(exportButton).toBeEnabled();
  await exportButton.click();
  await expect
    .poll(
      async () => {
    const label = (await exportButton.innerText()).trim();
    if (/导出失败|修复后重新检查/.test(label)) {
      const alert = page.getByRole("alert").last();
          throw new Error(
            `final export blocked: ${await alert.innerText().catch(() => label)}`,
          );
    }
    return label;
      },
      { timeout: 15 * 60_000, intervals: [1000, 2500, 5000] },
    )
    .toBe("下载成片");
  const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
  await exportButton.click();
  const download = await downloadPromise;
  const candidateVideoPath = path.join(resultDir, "multimix-candidate.mp4");
  await download.saveAs(candidateVideoPath);
  expect(fs.statSync(candidateVideoPath).size).toBeGreaterThan(10_000);
  await page.screenshot({
    path: path.join(resultDir, "video-pipeline-ready.png"),
    fullPage: true,
  });
  const expectedRestartFailure = (failure: { url: string; error: string }) =>
    expectResume &&
    failure.url.startsWith(apiBase) &&
    /net::ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET|SOCKET_NOT_CONNECTED)/.test(
      failure.error,
    );
  const actionableRequestFailures = requestFailures.filter(
    (failure) =>
      failure.error !== "net::ERR_ABORTED" && !expectedRestartFailure(failure),
  );
  const actionableConsoleErrors = consoleErrors.filter(
    (message) =>
      !(
        expectResume &&
        /Failed to fetch|ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET)/.test(
          message,
        )
      ),
  );
  const resumeReuse = Boolean(
    (
      projectAsset!.metadata?.pipeline_attempt as
        { resume_reuse?: boolean } | undefined
    )?.resume_reuse,
  );
  if (expectResume)
    expect(
      resumeReuse,
      "restarted worker must reuse persisted stage artifacts",
    ).toBe(true);
  fs.writeFileSync(
    path.join(resultDir, "browser-result.json"),
    JSON.stringify(
      {
      projectAssetId: projectAsset!.id,
      scenario,
      twoStageEnabled: expectTwoStage,
      pipelineCode,
      recomposeTested,
      targetSegmentId,
      beforeRefs,
      afterRefs,
      candidateVideo: candidateVideoPath,
        assetManifestCoverage:
          (assetManifest?.scenes?.length ?? 0) / beforeScenes.length,
      publicCandidateOnlyCount,
      manifestProjectReferenceMatch,
      sceneWindows: sortedMainElements.slice(0, 6).map((element) => ({
        sceneId: element.segmentId,
        startTime: element.startTime,
        duration: element.duration,
      })),
      informationIncrement: {
        contractVersion: "scene_information_increment_v1",
        sceneCount: beforeScenes.length,
        mgNeededCount: incrementMgScenes.length,
        mgRenderedCount: incrementMgScenes.filter(
          (scene) => scene.mg_decision?.status === "rendered",
        ).length,
        scenes: incrementMgScenes.map((scene) => ({
          sceneId: scene.id,
          template: scene.mg_decision?.chosen_template,
          status: scene.mg_decision?.status,
        })),
      },
      productPresentation: {
        productSceneCount: beforeScenes.filter(
          (scene) => scene.primary_visual?.source_type === "product_asset",
        ).length,
        splitSceneCount: presentationSupportElements.length,
          regionIds: beforeScenes
            .map(
              (scene) =>
                scene.primary_visual?.provenance?.product_media_region_id,
            )
            .filter(Boolean),
          scenes: beforeScenes
            .filter(
          (scene) => scene.primary_visual?.source_type === "product_asset",
            )
            .map((scene) => ({
          sceneId: scene.id,
              catalogEntryId:
                scene.primary_visual?.provenance?.catalog_entry_id,
              variant:
                scene.primary_visual?.provenance
                  ?.effective_presentation_variant,
              regionId:
                scene.primary_visual?.provenance?.product_media_region_id,
        })),
      },
        sourceMix: Object.fromEntries(
          [
            ...new Set(
              (assetManifest?.scenes ?? []).map(
                (scene) => scene.selected_asset?.source_type,
              ),
            ),
          ]
        .filter(Boolean)
            .map((source) => [
              source,
              (assetManifest?.scenes ?? []).filter(
                (scene) => scene.selected_asset?.source_type === source,
              ).length,
            ]),
        ),
      publicProviderProvenance: publicManifestScenes.map((scene) => ({
        sceneId: scene.scene_id,
        assetId: scene.selected_asset?.asset_id,
        artifactRef: scene.selected_asset?.artifact_ref,
        provider: scene.selected_asset?.provenance?.provider,
        providerItemId: scene.selected_asset?.provenance?.provider_item_id,
        licenseSnapshot: scene.selected_asset?.provenance?.license_snapshot,
      })),
        internalTermsVisible:
          /animated_explainer|\bhybrid\b|\bVLM\b|\bProvider\b|\bRemotion\b/i.test(
            visibleText,
          ),
      qualityMetrics: qualityReport.metrics,
      qualityWarnings: qualityReport.warnings ?? [],
      resumeReuse,
      consoleErrors,
      requestFailures,
      },
      null,
      2,
    ),
  );
  expect(
    actionableConsoleErrors,
    "browser console errors should be empty",
  ).toEqual([]);
  expect(
    actionableRequestFailures,
    "browser requests should have no actionable failures",
  ).toEqual([]);
});
