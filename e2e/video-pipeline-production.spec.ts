import fs from "node:fs";
import path from "node:path";

import {
  expect,
  test,
  type APIResponse,
  type Page,
  type Response as PlaywrightResponse,
} from "@playwright/test";

import {
  PRODUCTION_GENERATED_RECOMPOSE_INSTRUCTION,
  selectProductionGeneratedRecomposeTarget,
} from "../test-support/video-pipeline-production-helpers";

const sourceDocument = process.env.VIDEO_PIPELINE_SOURCE_DOCUMENT;
const resultDir = process.env.VIDEO_PIPELINE_RESULT_DIR;
const timingPath = process.env.VIDEO_PIPELINE_TIMING_PATH;

function recordE2ETiming(stage: string, status: "passed" | "failed", durationMs: number) {
  if (!timingPath) return;
  fs.mkdirSync(path.dirname(timingPath), { recursive: true });
  fs.appendFileSync(
    timingPath,
    `${JSON.stringify({
      at: new Date().toISOString(),
      stage,
      status,
      duration_ms: Math.max(0, durationMs),
    })}\n`,
    "utf8",
  );
}

async function measureE2EStage<T>(stage: string, operation: () => Promise<T>): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await operation();
    recordE2ETiming(stage, "passed", Date.now() - startedAt);
    return result;
  } catch (error) {
    recordE2ETiming(stage, "failed", Date.now() - startedAt);
    throw error;
  }
}

async function exportAcceptanceDiagnostic(
  page: Page,
  exportButton: ReturnType<Page["locator"]>,
  assetId: number,
  videoJobId: string,
) {
  const [buttonLabel, previewFrameCount, alertText] = await Promise.all([
    exportButton.innerText().then((value) => value.trim()).catch(() => "unreadable"),
    page.locator('iframe[title="视频工程预播"]').count(),
    page.getByRole("alert").last().innerText().then((value) => value.trim()).catch(() => "none"),
  ]);
  return `asset_id=${assetId}; video_job_id=${videoJobId}; export_button=${JSON.stringify(buttonLabel)}; preview_frames=${previewFrameCount}; alert=${JSON.stringify(alertText)}`;
}

async function assertExportHasNotFailed(
  page: Page,
  exportButton: ReturnType<Page["locator"]>,
  assetId: number,
  videoJobId: string,
) {
  const label = (await exportButton.innerText()).trim();
  if (/导出失败|下载失败|修复后重新检查/.test(label)) {
    throw new Error(
      `final export blocked: ${await exportAcceptanceDiagnostic(page, exportButton, assetId, videoJobId)}`,
    );
  }
  return label;
}

const directorTimingStageKeys = new Set([
  "drafting",
  "video_pipeline_selection",
  "scene_direction",
  "scene_direction_repair",
  "grounding_review",
  "grounding_review_repair",
  "creative_direction",
  "art_direction",
  "asset_requirements",
  "primary_visual_strategy",
]);

type GenerationProgressEvent = {
  key?: string;
  occurred_at?: string;
};

type GenerationJobTimingSource = {
  status?: string;
  updated_at?: string;
  progress_events?: GenerationProgressEvent[];
  timing_events?: Array<{
    stage?: string;
    subject?: string;
    operation?: string;
    status?: "passed" | "failed";
    duration_ms?: number;
  }>;
};

function recordDirectorSubstageTimings(job: GenerationJobTimingSource | undefined) {
  const events = job?.progress_events;
  if (!Array.isArray(events)) return;
  for (const [index, event] of events.entries()) {
    if (!event.key || !directorTimingStageKeys.has(event.key)) continue;
    const startedAt = Date.parse(event.occurred_at ?? "");
    const nextEvent = events[index + 1];
    const endedAt = Date.parse(nextEvent?.occurred_at ?? job?.updated_at ?? "");
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) continue;
    recordE2ETiming(
      `director_phase_${event.key}`,
      job?.status === "failed" && nextEvent?.key === "failed" ? "failed" : "passed",
      endedAt - startedAt,
    );
  }
  for (const event of job?.timing_events ?? []) {
    if (event.stage !== "scene_direction" || !event.subject || !event.operation || !Number.isFinite(event.duration_ms)) continue;
    recordE2ETiming(
      `director_scene_${event.subject}_${event.operation}`,
      event.status === "failed" ? "failed" : "passed",
      Number(event.duration_ms),
    );
  }
}
const targetSeconds = Number(process.env.VIDEO_PIPELINE_TARGET_SECONDS ?? 30);
const targetRatio = process.env.VIDEO_PIPELINE_RATIO ?? "16:9";
const ratioAcceptance = {
  "16:9": {
    confirmationLabel: "横屏 16:9",
    instructionLabel: "16:9横屏",
    layout: "landscape",
    subtitleSafeRegion: { x: 0.08, y: 0.76, width: 0.84, height: 0.18 },
  },
  "9:16": {
    confirmationLabel: "竖屏 9:16",
    instructionLabel: "9:16竖屏",
    layout: "portrait",
    subtitleSafeRegion: { x: 0.08, y: 0.74, width: 0.84, height: 0.22 },
  },
  "1:1": {
    confirmationLabel: "方形 1:1",
    instructionLabel: "1:1方形",
    layout: "square",
    subtitleSafeRegion: { x: 0.08, y: 0.74, width: 0.84, height: 0.2 },
  },
} as const;
if (!(targetRatio in ratioAcceptance)) {
  throw new Error("VIDEO_PIPELINE_RATIO must be one of 16:9, 9:16, or 1:1");
}
const targetRatioAcceptance = ratioAcceptance[targetRatio as keyof typeof ratioAcceptance];
const expectedSceneCount = Number(
  process.env.VIDEO_PIPELINE_EXPECTED_SCENE_COUNT
    ?? (targetSeconds >= 45 ? 8 : 6),
);
const videoJobTimeoutMs = Number(
  process.env.VIDEO_PIPELINE_VIDEO_JOB_TIMEOUT_MS ?? 20 * 60_000,
);
if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) {
  throw new Error("VIDEO_PIPELINE_TARGET_SECONDS must be a positive number");
}
if (!Number.isInteger(expectedSceneCount) || expectedSceneCount < 1) {
  throw new Error("VIDEO_PIPELINE_EXPECTED_SCENE_COUNT must be a positive integer");
}
if (!Number.isInteger(videoJobTimeoutMs) || videoJobTimeoutMs < 1) {
  throw new Error("VIDEO_PIPELINE_VIDEO_JOB_TIMEOUT_MS must be a positive integer");
}
const scenario = process.env.VIDEO_PIPELINE_SCENARIO ?? "animated_explainer";
const expectedPipelineCode =
  scenario === "hybrid" ? "real_material_hybrid" : "designed_explainer";
const requirePublicAsset =
  process.env.VIDEO_PIPELINE_REQUIRE_PUBLIC_ASSET === "true" ||
  scenario === "animated_public";
const hybridMediaFilesRaw = process.env.VIDEO_PIPELINE_HYBRID_MEDIA_FILES;
const expectResume = process.env.VIDEO_PIPELINE_EXPECT_RESUME === "true";
const expectTwoStage = process.env.VIDEO_PIPELINE_EXPECT_TWO_STAGE !== "false";
const testRecompose = process.env.VIDEO_PIPELINE_TEST_RECOMPOSE === "true";
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
  ratio?: string;
  metadata?: {
    duration?: number;
    closing_hold_seconds?: number;
    bgm_choice?: {
      enabled?: boolean;
      catalog_id?: string;
      music_intent?: string;
      selection_reason?: string;
      locked_by_user?: boolean;
    };
    audio_mix?: {
      voice_to_music_ratio?: number;
      predicted_voice_to_music_ratio?: number;
      voice_lufs?: number;
      music_lufs?: number;
    };
    audio_mix_measurement_status?: string;
  };
  orchestration?: {
    tts_sample_gate?: {
      status?: string;
      duration_seconds?: number;
      true_peak_dbfs?: number;
      provider?: string;
    };
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
      subtitlePresentation?: string;
      subtitleBackground?: { enabled?: boolean };
      subtitleTokens?: Array<unknown>;
      safeRegion?: { x?: number; y?: number; width?: number; height?: number };
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
  mg_decision?: {
    needed?: boolean;
    chosen_template?: string;
    params_source?: string;
    status?: string;
    overlay_ref?: string;
    last_error?: string;
  };
  primary_visual_strategy?: {
    mode?: string;
    presentation_variant?: string;
    presentation_support?: { headline?: string; items?: string[] };
  };
  primary_scene_spec?: {
    exactText?: string[];
    content?: { headline?: string };
    surfacePreset?: string;
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
      warning_code?: string;
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

async function confirmVideoParametersIfRequired(
  page: Page,
  initialResponse: PlaywrightResponse,
  ratio: keyof typeof ratioAcceptance,
) {
  type GenerationPayload = {
    generation_job?: { id?: string };
  };
  let payload = (await initialResponse.json()) as GenerationPayload;
  if (payload.generation_job?.id) return payload;

  const confirmButton = page.getByRole("button", {
    name: "确认参数并生成编导稿",
  });
  const directDraftButton = page.getByRole("button", {
    name: "直接起草通用版",
  });

  for (let step = 0; step < 2 && !payload.generation_job?.id; step += 1) {
    let action: "direct-draft" | "confirm-parameters" | null = null;
    await expect
      .poll(
        async () => {
          if (await directDraftButton.isVisible().catch(() => false)) {
            action = "direct-draft";
          } else if (await confirmButton.isVisible().catch(() => false)) {
            action = "confirm-parameters";
          }
          return action;
        },
        { timeout: 30_000 },
      )
      .not.toBeNull();
    const button = action === "direct-draft" ? directDraftButton : confirmButton;
    await expect(button).toBeEnabled();
    if (action === "direct-draft") {
      if (ratio !== "16:9") {
        throw new Error(
          `video parameter confirmation was skipped for non-default ratio ${ratio}`,
        );
      }
      await button.click();
      const composer = page.getByRole("textbox", { name: "输入对话内容" });
      await expect(composer).toHaveValue("直接起草通用版");
    }
    const responsePromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/v1/assets/conversations/messages"),
      { timeout: 360_000 },
    );
    if (action === "direct-draft") {
      await page.getByRole("button", { name: "发送" }).click();
    } else {
      const ratioRadio = page.getByRole("radio", {
        name: ratioAcceptance[ratio].confirmationLabel,
      });
      await expect(ratioRadio).toBeVisible();
      await ratioRadio.click();
      await expect(ratioRadio).toHaveAttribute("aria-checked", "true");
      await button.click();
    }
    const response = await responsePromise;
    const responseText = await response.text();
    expect(
      response.ok(),
      `video generation confirmation failed: ${response.status()} ${responseText}`,
    ).toBe(true);
    payload = JSON.parse(responseText) as GenerationPayload;
  }
  expect(payload.generation_job?.id, "generation confirmation must queue a job").toBeTruthy();
  return payload;
}

async function waitForProjectReady(
  page: Page,
  {
    apiBase,
    assetId,
    headers,
    jobId,
  }: {
    apiBase: string;
    assetId: number;
    headers: Record<string, string>;
    jobId: string;
  },
) {
  const productDeadline = Date.now() + videoJobTimeoutMs;
  let lastProductStatus = "missing";
  while (Date.now() < productDeadline) {
    const projectResponse = await page.request.get(
      `${apiBase}/v1/video/projects/${assetId}`,
      { headers },
    );
    if (!projectResponse.ok()) {
      throw new Error(
        `ready video project could not be read: job=${jobId} asset=${assetId} http=${projectResponse.status()}`,
      );
    }
    const project = (await projectResponse.json()) as {
      project_ready?: boolean;
      workflow_stage?: string;
      project?: unknown;
      product_status?: "generating" | "completed" | "failed";
      failure_reason?: string;
      failure_scene_id?: string;
    };
    if (
      !project.project_ready
      || project.workflow_stage !== "video_project_ready"
      || !project.project
    ) {
      throw new Error(
        `backend_project_not_ready_after_completed_job: job=${jobId} asset=${assetId} ready=${String(project.project_ready)} stage=${project.workflow_stage ?? "missing"}`,
      );
    }
    lastProductStatus = project.product_status ?? "missing";
    if (project.product_status === "failed") {
      throw new Error(
        `video product failed after project assembly: job=${jobId} asset=${assetId} scene=${project.failure_scene_id ?? "missing"} reason=${project.failure_reason ?? "missing"}`,
      );
    }
    if (project.product_status === "completed") break;
    await page.waitForTimeout(2500);
  }
  if (lastProductStatus !== "completed") {
    throw new Error(
      `video_product_not_completed_before_timeout: job=${jobId} asset=${assetId} status=${lastProductStatus} timeout_ms=${videoJobTimeoutMs}`,
    );
  }

  // Internal project readiness only makes the timeline available to MG workers.
  // Reload the workspace after the user-facing product is complete, then allow
  // a separate bounded window for the DOM projection itself to converge.
  await page.reload({ waitUntil: "domcontentloaded" });
  const deadline = Date.now() + 2 * 60_000;
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
      if ((await cards.count()) === expectedSceneCount) return summary;
    }
    await page.waitForTimeout(2500);
  }
  throw new Error(
    `ui_not_converged_after_ready: job=${jobId} asset=${assetId} expected_scenes=${expectedSceneCount}`,
  );
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

function mgDiagnostic(scenes: SceneRow[]) {
  return scenes
    .map((scene) => {
      const decision = scene.mg_decision;
      return `${scene.id}:${decision?.status ?? "missing"}${
        decision?.last_error ? `(${decision.last_error})` : ""
      }`;
    })
    .join(",");
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

function generatedPrimaryRepeatsVisibleSubtitle(scene: SceneRow) {
  if (scene.primary_visual?.source_type !== "generated_scene") return false;
  const headline =
    scene.primary_scene_spec?.content?.headline ??
    scene.primary_scene_spec?.exactText?.[0] ??
    "";
  const visibleSubtitle = scene.subtitle_focus?.trim() || scene.narration;
  return Boolean(
    headline.trim() &&
    normalizedVisibleText(headline) === normalizedVisibleText(visibleSubtitle),
  );
}

test("produces persisted visuals and optionally recomposes one scene", async ({
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

  await measureE2EStage("workspace_entry", () => enterWorkspace(page));
  const uploadResponse = await measureE2EStage("document_upload", async () => {
    const uploadPromise = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().includes("/v1/assets/upload"),
      { timeout: 180_000 },
    );
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "上传 PDF 或文档" }).click();
    await (await chooserPromise).setFiles(sourceDocument);
    return uploadPromise;
  });
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
      "hybrid scenario requires at least three saved venue/process/context media files",
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

  const generationInstruction =
    scenario === "hybrid"
      ? `严格基于刚上传的 MultiMix 产品资料，制作一条${targetSeconds}秒、${targetRatioAcceptance.instructionLabel}的商家内容制作示范片。刚上传的装修图片只作为真实业务环境和服务过程的通用 B-roll，不是 MultiMix 客户项目，也不能证明 MultiMix 产品能力。请用其中一个分镜准确呈现资料中已核验的产品能力：MultiMix 可以把上传资料与已保存图片、视频组织成可编辑分镜；这条产品能力声明必须使用批准的产品界面或忠于原文的事实卡作为证据。其他镜头只在解释流程时使用动态图解；不得把通用素材说成客户案例、前后对比或效果证明。先给出编导稿和${expectedSceneCount}个分镜，不要展示内部制作方式。`
      : scenario === "animated_public"
        ? `严格基于刚上传的 MultiMix 产品资料，制作一条${targetSeconds}秒、${targetRatioAcceptance.instructionLabel}的产品介绍视频。开场或商家痛点/工作场景至少一个分镜必须使用经过网络搜索、视觉验证和授权校验的真实公共图片或视频作为通用 B-roll；产品界面和产品能力镜头继续使用审核产品素材或忠于资料的准确生成画面，不得把公共素材冒充产品界面、客户案例、效果证据或前后对比。先给出编导稿和${expectedSceneCount}个分镜；信息不足按合理默认值处理，不要展示内部制作方式。`
        : scenario === "data_process"
          ? `严格基于刚上传的 MultiMix 产品资料，制作一条${targetSeconds}秒、${targetRatioAcceptance.instructionLabel}的数据与流程讲解视频。至少三个分镜分别用数据总结、步骤流程和结构关系来解释资料中已经明确的产品闭环；只使用资料里有依据的信息，不虚构数字、案例或产品界面。MG 可以承担结构化解释，但不能替代真实证据或审核产品截图。先给出编导稿和${expectedSceneCount}个分镜；信息不足按合理默认值处理，不要展示内部制作方式。`
        : `严格基于刚上传的 MultiMix 产品资料，制作一条${targetSeconds}秒、${targetRatioAcceptance.instructionLabel}的产品介绍视频。把工作台/对话、分镜编辑/视频预览设计成两个不同的产品界面分镜，分别使用已审核产品截图，不要把整张截图直接重复铺成背景；其中至少一个界面分镜把截图证据与来源中存在且不与旁白、字幕重复的补充信息分区呈现，优先保证截图清晰可读。至少一个流程分镜使用 MG 动画补充真实步骤、差异或结构，不得重复旁白和字幕，也不得使用空泛对比项。先给出编导稿和${expectedSceneCount}个分镜；信息不足按合理默认值处理，不要展示内部制作方式。`;
  const generationResponse = await postConversation(
    page,
    `${generationInstruction}${expectBgm ? "" : " 本轮不使用背景音乐，bgm_plan.enabled 必须为 false。"}`,
  );
  const generationPayload = await confirmVideoParametersIfRequired(
    page,
    generationResponse,
    targetRatio as keyof typeof ratioAcceptance,
  );
  const generationJobId = generationPayload.generation_job?.id;
  expect(
    generationJobId,
    "queued conversation response must include a generation job",
  ).toBeTruthy();
  let readyProjectAssetId: number | undefined;
  let latestGenerationJob: GenerationJobTimingSource | undefined;
  try {
    await measureE2EStage("director_generation", async () => expect
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
        const job = (await response.json()) as GenerationJobTimingSource & {
      status?: string;
      error_code?: string;
      error_message?: string;
    };
    latestGenerationJob = job;
    if (job.status === "failed") {
      throw new Error(
        `director generation failed (${job.error_code ?? "unknown"}): ${job.error_message ?? "unknown error"}`,
      );
    }
    return job.status;
      },
      { timeout: 20 * 60_000, intervals: [1000, 2500, 5000] },
    )
    .toBe("completed"));
  } finally {
    recordDirectorSubstageTimings(latestGenerationJob);
  }
  const narrationBlocked = page
    .getByText(/口播质检未通过|当前不能确认生成视频工程/)
    .last();
  if (await narrationBlocked.isVisible().catch(() => false)) {
    throw new Error(
      `director narration quality blocked: ${await narrationBlocked.innerText()}`,
    );
  }
  // Director generation completes asynchronously.  Do not reuse the earlier
  // parameter card while the client is refreshing the completed job: the next
  // user action must be the distinct video-project confirmation card.
  const pendingCard = page.getByLabel("视频方案 · 待确认");
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
  await measureE2EStage("video_project_ready", async () => expect
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
          asset_id?: number;
          project_ready?: boolean;
        };
    if (job.status === "failed") {
          throw new Error(
            `video project generation failed: ${job.error_message ?? "unknown error"}`,
          );
    }
        if (job.status === "completed" && job.project_ready && job.asset_id) {
          readyProjectAssetId = job.asset_id;
          return "completed:ready";
        }
    return `${job.status ?? "unknown"}:${job.project_ready ? "ready" : "not-ready"}`;
      },
      { timeout: videoJobTimeoutMs, intervals: [1000, 2500, 5000] },
    )
    .toBe("completed:ready"));
  expect(readyProjectAssetId, "completed job must identify its ready project").toBeTruthy();

  const summary = await waitForProjectReady(page, {
    apiBase,
    assetId: readyProjectAssetId!,
    headers,
    jobId: videoJobId!,
  });
  const cards = summary.locator("li");
  await expect(cards).toHaveCount(expectedSceneCount);
  await expect(summary.getByText("待补素材")).toHaveCount(0);
  const visibleText = await page.locator("body").innerText();
  expect(visibleText).not.toMatch(
    /animated_explainer|\bhybrid\b|\bVLM\b|\bProvider\b|\bRemotion\b/i,
  );
  expect(visibleText).not.toMatch(/待补素材|字幕\/标题卡占位/);
  const confirmedPlanCard = page
    .locator(".shadcn-prototype-confirm-card")
    .last();
  await expect(confirmedPlanCard).toContainText(
    targetRatioAcceptance.confirmationLabel,
  );

  const listResponse = await page.request.get(`${apiBase}/v1/assets`, {
    headers,
  });
  expect(listResponse.ok()).toBe(true);
  const assets = (await listResponse.json()) as AssetRow[];
  let projectAsset = assets
    .filter(
      (asset) =>
        asset.content_type === "video_project" &&
        asset.metadata?.video_plan &&
        typeof asset.metadata.video_plan === "object",
    )
    .at(-1);
  expect(
    projectAsset,
    "video_project asset with video_plan should exist after confirmation",
  ).toBeTruthy();
  let pipelineCode: string | undefined = expectTwoStage ? undefined : "legacy";
  let beforeScenes = scenesFromAsset(projectAsset!);
  let artDirectionSummary: {
    schemaVersion?: string;
    surfacePresets: string[];
    distinctSurfaceCount: number;
    treatmentCounts: Record<string, number>;
    effectCounts: Record<string, number>;
  } | null = null;
  if (expectTwoStage) {
    await expect
      .poll(
        async () => {
          let response: APIResponse;
          try {
            response = await page.request.get(`${apiBase}/v1/assets`, {
              headers,
            });
          } catch (error) {
            return `transport-error:${error instanceof Error ? error.message : String(error)}`;
          }
    if (!response.ok()) return `http-${response.status()}`;
          const current = ((await response.json()) as AssetRow[]).find(
      (asset) => asset.id === projectAsset!.id,
    );
    if (!current) return "asset-missing";
    const plannedMgScenes = scenesFromAsset(current).filter(
      (scene) => scene.mg_decision?.needed === true,
    );
    if (plannedMgScenes.length === 0) {
      projectAsset = current;
      return "not-needed";
    }
    const notDispatched = plannedMgScenes.filter((scene) =>
      new Set(["planned", "stale", "missing"]).has(
        scene.mg_decision?.status ?? "missing",
      ),
    );
    return notDispatched.length > 0
      ? `mg-not-dispatched:${mgDiagnostic(notDispatched)}`
      : "dispatched";
        },
        { timeout: 90_000, intervals: [1000, 2500, 5000] },
      )
      .toMatch(/^(?:dispatched|not-needed)$/);
    await expect
      .poll(
        async () => {
          let response: APIResponse;
          try {
            response = await page.request.get(`${apiBase}/v1/assets`, { headers });
          } catch (error) {
            return `transport-error:${error instanceof Error ? error.message : String(error)}`;
          }
          if (!response.ok()) return `http-${response.status()}`;
          const current = ((await response.json()) as AssetRow[]).find(
            (asset) => asset.id === projectAsset!.id,
          );
          if (!current) return "asset-missing";
          const plannedMgScenes = scenesFromAsset(current).filter(
            (scene) => scene.mg_decision?.needed === true,
          );
          if (plannedMgScenes.length === 0) {
            projectAsset = current;
            return "not-needed";
          }
          const pending = plannedMgScenes.filter(
            (scene) => !new Set(["rendered", "failed"]).has(scene.mg_decision?.status ?? ""),
          );
          if (pending.length > 0) return `mg-in-flight:${mgDiagnostic(pending)}`;
          const rendered = plannedMgScenes.filter(
            (scene) => scene.mg_decision?.status === "rendered",
          );
          if (rendered.length === 0) {
            throw new Error(`all enabled MG scenes reached a failed terminal state: ${mgDiagnostic(plannedMgScenes)}`);
          }
          projectAsset = current;
          return "ready";
        },
        { timeout: 15 * 60_000, intervals: [1000, 2500, 5000] },
      )
      .toMatch(/^(?:ready|not-needed)$/);
    const persistedVideoPlan = projectAsset!.metadata?.video_plan as {
      duration_contract?: { target_seconds?: number };
      mg_plan?: { layout?: string };
      internal_production?: {
        skill_package?: { code?: string };
      art_direction?: {
          schema_version?: string;
          scene_surface_by_id?: Record<string, string>;
          scene_animation_by_id?: Record<
            string,
            {
              treatment?: string;
              entrance?: { style?: string; portion?: number };
              emphasis?: { style?: string; portion?: number };
              hold?: { portion?: number };
              exit?: { style?: string; portion?: number };
              effects?: string[];
            }
          >;
        };
      };
    };
    expect(persistedVideoPlan.mg_plan?.layout).toBe(targetRatioAcceptance.layout);
    expect(Number(persistedVideoPlan.duration_contract?.target_seconds)).toBe(
      targetSeconds,
    );
    pipelineCode = persistedVideoPlan.internal_production?.skill_package?.code;
    expect(pipelineCode).toBe(expectedPipelineCode);
    beforeScenes = scenesFromAsset(projectAsset!);
    const artDirection =
      persistedVideoPlan.internal_production?.art_direction;
    expect(artDirection?.schema_version).toBe("video_art_direction_v2");
    expect(Object.keys(artDirection?.scene_surface_by_id ?? {})).toHaveLength(
      expectedSceneCount,
    );
    expect(Object.keys(artDirection?.scene_animation_by_id ?? {})).toHaveLength(
      expectedSceneCount,
    );
    const allowedTreatments = new Set([
      "protect_realism",
      "overlay_enhanced",
      "generated_primary",
    ]);
    const allowedEffects = new Set([
      "particle_field",
      "light_sweep",
      "shape_draw",
      "path_flow",
      "mask_reveal",
      "focus_marker",
    ]);
    const animationEntries = Object.values(
      artDirection?.scene_animation_by_id ?? {},
    );
    for (const animation of animationEntries) {
      expect(allowedTreatments.has(animation.treatment ?? "")).toBe(true);
      expect(animation.effects?.length ?? 0).toBeLessThanOrEqual(2);
      expect(
        (animation.effects ?? []).every((effect) => allowedEffects.has(effect)),
      ).toBe(true);
      const totalPortion =
        Number(animation.entrance?.portion ?? 0) +
        Number(animation.emphasis?.portion ?? 0) +
        Number(animation.hold?.portion ?? 0) +
        Number(animation.exit?.portion ?? 0);
      expect(totalPortion).toBeCloseTo(1, 6);
      expect(Number(animation.hold?.portion ?? 0)).toBeGreaterThanOrEqual(0.2);
    }
    const distinctSurfacePresets = new Set(
      Object.values(artDirection?.scene_surface_by_id ?? {}),
    );
    expect(distinctSurfacePresets.size).toBeGreaterThanOrEqual(4);
    artDirectionSummary = {
      schemaVersion: artDirection?.schema_version,
      surfacePresets: [
        ...Object.values(artDirection?.scene_surface_by_id ?? {}),
      ],
      distinctSurfaceCount: distinctSurfacePresets.size,
      treatmentCounts: Object.fromEntries(
        [...allowedTreatments].map((treatment) => [
          treatment,
          animationEntries.filter(
            (animation) => animation.treatment === treatment,
          ).length,
        ]),
      ),
      effectCounts: Object.fromEntries(
        [...allowedEffects].map((effect) => [
          effect,
          animationEntries.filter((animation) =>
            animation.effects?.includes(effect),
          ).length,
        ]),
      ),
    };
    const orderedSurfacePresets = beforeScenes.map(
      (scene) => artDirection?.scene_surface_by_id?.[scene.id],
    );
    for (let index = 2; index < orderedSurfacePresets.length; index += 1) {
      expect(
        new Set(orderedSurfacePresets.slice(index - 2, index + 1)).size,
        `three adjacent scenes must not repeat one surface at ${index + 1}`,
      ).toBeGreaterThan(1);
    }
    const compiledSurfaceScenes = beforeScenes.filter(
      (scene) => scene.primary_scene_spec?.surfacePreset,
    );
    for (const scene of compiledSurfaceScenes) {
      expect(scene.primary_scene_spec?.surfacePreset).toBe(
        artDirection?.scene_surface_by_id?.[scene.id],
      );
    }
  expect(beforeScenes).toHaveLength(expectedSceneCount);
    expect(
      beforeScenes.every(
        (scene) =>
          scene.primary_visual?.status === "persisted" &&
          Boolean(scene.primary_visual.artifact_ref) &&
          !/^https?:\/\//.test(scene.primary_visual.artifact_ref ?? ""),
      ),
    ).toBe(true);
  const primaryVisualRefs = beforeScenes.map(
    (scene) => scene.primary_visual?.artifact_ref ?? "",
  );
  expect(
    new Set(primaryVisualRefs).size,
    "every scene must use a distinct persisted main visual",
  ).toBe(primaryVisualRefs.length);
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
  expect(beforeScenes).toHaveLength(expectedSceneCount);
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
    expect(assetManifest?.scenes).toHaveLength(expectedSceneCount);
    expect(editDecisions?.scenes).toHaveLength(expectedSceneCount);
  }
  const generatedPrimaryFailureCodes = new Set([
    "mg_primary_blank",
    "mg_primary_fallback",
    "title_scene_render_fallback",
  ]);
  for (const scene of beforeScenes) {
    expect(
      generatedPrimaryFailureCodes.has(
        scene.primary_visual?.provenance?.warning_code ?? "",
      ),
      `scene ${scene.id} must not publish a generated-primary failure placeholder`,
    ).toBe(false);
  }
  for (const scene of assetManifest?.scenes ?? []) {
    expect(
      generatedPrimaryFailureCodes.has(
        String(scene.selected_asset?.provenance?.warning_code ?? ""),
      ),
      `manifest scene ${scene.scene_id ?? "unknown"} must not contain a generated-primary failure placeholder`,
    ).toBe(false);
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
  expect(sortedMainElements.length).toBeGreaterThanOrEqual(expectedSceneCount);
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
    expect(supportTrack?.elements ?? []).toHaveLength(
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
  ).toBe(expectedSceneCount);
  const subtitleTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-text",
  );
  const subtitleSegmentIds = new Set(
    (subtitleTrack?.elements ?? []).map((element) => element.segmentId),
  );
  for (const scene of beforeScenes) {
    const repeatedGeneratedHeadline =
      generatedPrimaryRepeatsVisibleSubtitle(scene);
    expect(
      subtitleSegmentIds.has(scene.id),
      repeatedGeneratedHeadline
        ? `generated headline already carries the visible subtitle for ${scene.id}`
        : `non-duplicated visible subtitle is still required for ${scene.id}`,
    ).toBe(!repeatedGeneratedHeadline);
  }
  const mgOverlayTrack = videoProject?.tracks?.find(
    (track) => track.id === "track-overlay" && track.overlay === true,
  );
  if (expectTwoStage) {
    const renderedMgSceneIds = new Set(
      beforeScenes
        .filter(
          (scene) =>
            scene.mg_decision?.needed === true &&
            scene.mg_decision?.status === "rendered",
        )
        .map((scene) => scene.id),
    );
    const mgOverlaySceneIds = new Set(
      (mgOverlayTrack?.elements ?? [])
        .map((element) => element.segmentId)
        .filter((segmentId): segmentId is string => Boolean(segmentId)),
    );
    expect(mgOverlaySceneIds).toEqual(renderedMgSceneIds);
  }
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
  if (targetSeconds >= 45) {
    expect(Number(videoProject?.metadata?.closing_hold_seconds)).toBeGreaterThanOrEqual(
      1.5,
    );
    expect(Number(videoProject?.metadata?.closing_hold_seconds)).toBeLessThanOrEqual(
      2.5,
    );
    expect(videoProject?.orchestration?.tts_sample_gate?.status).toBe("passed");
    expect(
      Number(videoProject?.orchestration?.tts_sample_gate?.true_peak_dbfs),
    ).toBeLessThan(-0.1);
  }
  if (expectBgm) {
    expect(videoProject?.metadata?.bgm_choice?.enabled).toBe(true);
    expect(videoProject?.metadata?.bgm_choice?.catalog_id).toBeTruthy();
    expect(bgmTrack?.type).toBe("audio");
    expect(bgmTrack?.elements?.length).toBeGreaterThan(0);
  } else {
    expect(videoProject?.metadata?.bgm_choice?.enabled).toBe(false);
    expect(videoProject?.metadata?.bgm_choice?.selection_reason).toBeTruthy();
    expect(videoProject?.metadata?.bgm_choice?.locked_by_user).toBe(false);
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
  if (expectTwoStage && testRecompose) {
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
          let response: APIResponse;
          try {
            response = await page.request.get(
              `${apiBase}/v1/video/jobs/${jobId}`,
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
      "recomposed video_project asset should remain in the library",
    ).toBeTruthy();
    afterScenes = scenesFromAsset(refreshed!);
  expect(afterScenes).toHaveLength(expectedSceneCount);
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
  expect(postRecomposeSupportTrack?.elements ?? []).toHaveLength(
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

  await measureE2EStage("final_browse_recovery", async () => {
    await page.reload();
    await expect(page.getByLabel("分镜摘要").locator("li")).toHaveCount(expectedSceneCount, {
      timeout: 120_000,
    });
    await expect(page.getByLabel("分镜摘要").getByText("待补素材")).toHaveCount(
      0,
    );
  });
  // Shared quality and export contract for both pipeline modes.
  let finalQualityReport: QualityReport | undefined;
  let qualityReport: QualityReport | undefined;
  await measureE2EStage("export_preflight", async () => {
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
    qualityReport = finalQualityReport!;
    expect(
      (qualityReport.warnings ?? []).filter((warning) =>
        generatedPrimaryFailureCodes.has(warning.code ?? ""),
      ),
      "generated-primary failure placeholders must never remain export warnings",
    ).toEqual([]);
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
  });
  expect(qualityReport).toBeTruthy();
  const exportButton = await measureE2EStage("export_preview_ready", async () => {
    await page.reload();
    await expect(page.getByLabel("分镜摘要").locator("li")).toHaveCount(expectedSceneCount, {
      timeout: 120_000,
    });
    await expect(page.getByTitle("视频工程预播")).toHaveCount(1);
    await expect(page.getByTitle("视频剪辑器")).toHaveCount(0);
    const exportButton = page
      .locator("button.shadcn-prototype-open-editor")
      .last();
    await expect(exportButton).toHaveText("导出视频", { timeout: 180_000 });
    await expect(exportButton).toBeEnabled();
    await exportButton.click();
    await expect(page.getByTitle("视频剪辑器")).toHaveCount(0);
    await expect
      .poll(
        () => assertExportHasNotFailed(page, exportButton, projectAsset!.id, videoJobId!),
        { timeout: 15 * 60_000, intervals: [1000, 2500, 5000] },
      )
      .toMatch(/^(导出中|正在检查成片…|下载成片)/);
    return exportButton;
  });
  await measureE2EStage("export_browser_render", async () => {
    await expect
      .poll(
        () => assertExportHasNotFailed(page, exportButton, projectAsset!.id, videoJobId!),
        { timeout: 15 * 60_000, intervals: [1000, 2500, 5000] },
      )
      .toBe("下载成片");
  });
  const candidateVideoPath = await measureE2EStage("export_download", async () => {
    const downloadPromise = page.waitForEvent("download", { timeout: 180_000 });
    await exportButton.click();
    const download = await downloadPromise;
    const outputPath = path.join(resultDir, "multimix-candidate.mp4");
    await download.saveAs(outputPath);
    expect(fs.statSync(outputPath).size).toBeGreaterThan(10_000);
    return outputPath;
  });
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
  expect(videoProject?.ratio).toBe(targetRatio);
  const subtitleElements = (videoProject?.tracks ?? [])
    .flatMap((track) => track.elements ?? [])
    .filter((element) => element.textRole === "subtitle");
  expect(subtitleElements.length, "rendered project must retain subtitles").toBeGreaterThan(0);
  for (const subtitle of subtitleElements) {
    expect(subtitle.subtitleBackground?.enabled ?? false).toBe(false);
    expect(subtitle.safeRegion).toEqual(targetRatioAcceptance.subtitleSafeRegion);
    if (["word_highlight", "karaoke"].includes(subtitle.subtitlePresentation ?? "")) {
      expect(subtitle.subtitleTokens?.length ?? 0).toBeGreaterThan(0);
    }
  }

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
      sceneWindows: sortedMainElements.slice(0, expectedSceneCount).map((element) => ({
        sceneId: element.segmentId,
        startTime: element.startTime,
        duration: element.duration,
      })),
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
      qualityMetrics: qualityReport!.metrics,
      qualityWarnings: qualityReport!.warnings ?? [],
      artDirection: artDirectionSummary,
      humanReviewStatus: "pending",
      audioFinishing: {
        closingHoldSeconds: videoProject?.metadata?.closing_hold_seconds,
        ttsSampleGate: videoProject?.orchestration?.tts_sample_gate ?? null,
        bgmEnabled: videoProject?.metadata?.bgm_choice?.enabled,
        bgmSelectionReason: videoProject?.metadata?.bgm_choice?.selection_reason,
        musicIntent: videoProject?.metadata?.bgm_choice?.music_intent,
      },
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
