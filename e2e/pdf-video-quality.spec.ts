import fs from "node:fs";
import path from "node:path";

import { expect, test, type Download, type Page } from "@playwright/test";

const pdfPath = process.env.PDF_VIDEO_PATH;
const resultDir = process.env.PDF_VIDEO_RESULT_DIR;
const videoLayout = process.env.PDF_VIDEO_LAYOUT === "landscape" ? "landscape" : "portrait";
const ratioLabel = videoLayout === "landscape" ? "16:9横屏" : "9:16竖屏";
const testEmailDomain = process.env.PDF_VIDEO_TEST_EMAIL_DOMAIN ?? "example.com";
const testEmail = process.env.PDF_VIDEO_TEST_EMAIL;
const testPassword = process.env.PDF_VIDEO_TEST_PASSWORD;
const pollGenerationJob = process.env.PDF_VIDEO_POLL_GENERATION_JOB === "true";
const existingConversationId = process.env.PDF_VIDEO_EXISTING_CONVERSATION_ID;
const existingProductId = process.env.PDF_VIDEO_EXISTING_PRODUCT_ID;
const textOnlyPrompt = process.env.PDF_VIDEO_TEXT_PROMPT
  ?? "帮一家社区咖啡馆做一条30秒、9:16的短视频，面向周边上班族，目标是吸引他们工作日来买手冲咖啡和早餐，突出出品快和环境安静适合办公。先给我编导稿和分镜方案，信息不足按合理默认值处理，直接开始。";

type E2EAsset = {
  id: number;
  title: string;
  library_kind: string;
  content_type: string;
  metadata?: {
    whole_page_visual?: boolean;
    source_context_text?: string;
    understanding?: { tags?: string[] };
  };
};

// --- one-off instrumentation for the manual timing/quality report ---
const marks: { label: string; t: number }[] = [];
function mark(label: string) {
  marks.push({ label, t: Date.now() });
}
function elapsedTable() {
  const rows: { phase: string; seconds: number }[] = [];
  for (let i = 1; i < marks.length; i += 1) {
    rows.push({ phase: `${marks[i - 1].label} → ${marks[i].label}`, seconds: +((marks[i].t - marks[i - 1].t) / 1000).toFixed(1) });
  }
  const total = marks.length > 1 ? +((marks[marks.length - 1].t - marks[0].t) / 1000).toFixed(1) : 0;
  return { rows, total };
}

function recordStoryboardCopyNote(label: string, text: string, pattern: RegExp) {
  if (!pattern.test(text)) {
    test.info().annotations.push({
      type: "storyboard-copy-note",
      description: `${label} 未在本次实时编导稿中出现`,
    });
  }
}

async function waitForConversationPost(page: Page) {
  return page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 12 * 60_000 },
  );
}

async function sendComposerMessage(page: Page, text: string) {
  await page.getByLabel("输入对话内容").fill(text);
  const responsePromise = waitForConversationPost(page);
  await page.getByRole("button", { name: "发送" }).click();
  const response = await responsePromise;
  expect(response.ok(), `conversation POST failed: ${response.status()}`).toBe(true);
  await expect(page.locator("article.user").filter({ hasText: text.slice(0, 18) }).last()).toBeVisible();
  return response;
}

async function refreshAfterQueuedGeneration(page: Page, response: Awaited<ReturnType<typeof waitForConversationPost>>) {
  if (!pollGenerationJob || response.status() !== 202) return;
  const payload = await response.json() as {
    conversation_id?: string;
    generation_job?: { id?: string };
  };
  const conversationId = payload.conversation_id;
  const jobId = payload.generation_job?.id;
  const authorization = response.request().headers().authorization;
  if (!conversationId || !jobId || !authorization) return;
  const apiBaseUrl = new URL(response.url()).origin;
  const deadline = Date.now() + 6 * 60_000;
  while (Date.now() < deadline) {
    const jobResponse = await page.request.get(
      `${apiBaseUrl}/v1/assets/generation-jobs/${encodeURIComponent(jobId)}`,
      { headers: { authorization } },
    );
    expect(jobResponse.ok(), `generation job fetch failed: ${jobResponse.status()}`).toBe(true);
    const job = await jobResponse.json() as {
      status?: string;
      error_code?: string | null;
      error_message?: string | null;
    };
    if (job.status === "completed") {
      await page.goto(`/app/assets?conversation=${encodeURIComponent(conversationId)}`);
      await expect(
        page.getByRole("region", { name: "Content generation conversation" }),
      ).toBeVisible();
      return;
    }
    if (job.status === "failed") {
      throw new Error(
        `Asset generation failed (${job.error_code ?? "unknown"}): ${job.error_message ?? "no detail"}`,
      );
    }
    await page.waitForTimeout(2500);
  }
  throw new Error(`Timed out waiting for asset generation job ${jobId}`);
}

async function enterLocalWorkspace(page: Page) {
  await page.goto("/app/assets");
  const loginHeading = page.getByRole("heading", { name: "登录你的创作工作台" });
  const workspaceHeading = page.getByRole("heading", { name: "今天想做什么内容？" });
  const entry = await Promise.race([
    loginHeading.waitFor({ state: "visible", timeout: 30_000 }).then(() => "login" as const),
    workspaceHeading.waitFor({ state: "visible", timeout: 30_000 }).then(() => "workspace" as const),
  ]);
  if (entry === "login") {
    if (testEmail && testPassword) {
      await page.getByLabel("邮箱或手机号").fill(testEmail);
      await page.getByLabel("密码").fill(testPassword);
      await page.locator("form").getByRole("button", { name: "登录" }).click();
    } else {
      await page.locator(".multimix-auth-switch").getByRole("button", { name: "注册" }).click();
      await page.getByLabel("邮箱或手机号").fill(`pdf-video-${Date.now()}@${testEmailDomain}`);
      await page.getByLabel("密码").fill("local-pdf-video-2026");
      await page.locator("form").getByRole("button", { name: "注册" }).click();
    }
  }
  await expect(workspaceHeading).toBeVisible({ timeout: 30_000 });
}

async function waitForVideoProject(page: Page) {
  const deadline = Date.now() + (existingConversationId ? 45_000 : 15 * 60_000);
  let lastHandledAssistant = "";
  let fallbackConfirmCount = 0;
  while (Date.now() < deadline) {
    const exportButton = page.getByRole("button", { name: /导出/ }).last();
    if (await exportButton.isVisible().catch(() => false)) return exportButton;
    const editButton = page.getByRole("button", { name: "编辑", exact: true });
    if (await editButton.isVisible().catch(() => false)) return editButton;

    const failedState = page.getByText(/视频(?:工程)?生成失败|生成失败 · 可重试/).last();
    if (await failedState.isVisible().catch(() => false)) {
      throw new Error(`Video project generation failed: ${await failedState.innerText()}`);
    }

    const pendingCard = page.locator('.shadcn-prototype-confirm-card.pending').last();
    if (await pendingCard.isVisible().catch(() => false)) {
      const confirm = pendingCard.locator("button.shadcn-prototype-confirm-primary");
      if (await confirm.isEnabled().catch(() => false)) {
        const responsePromise = waitForConversationPost(page);
        await confirm.click();
        const response = await responsePromise;
        expect(response.ok(), `confirmation POST failed: ${response.status()}`).toBe(true);
        await page.waitForTimeout(1000);
        continue;
      }
    }

    const composer = page.getByLabel("输入对话内容");
    const sending = await page.getByRole("button", { name: "停止生成" }).isVisible().catch(() => false);
    const lastMessage = page.locator(".shadcn-prototype-thread article").last();
    const lastMessageClass = await lastMessage.getAttribute("class").catch(() => "");
    const lastMessageText = await lastMessage.innerText().catch(() => "");
    if (
      !sending
      && fallbackConfirmCount < 6
      && lastMessageClass?.includes("assistant")
      && lastMessageText
      && lastMessageText !== lastHandledAssistant
      && /确认.*生成.*视频工程|确认后.*生成/.test(lastMessageText)
      && !/进入生成队列|失败|不可达|暂时/.test(lastMessageText)
      && await composer.isVisible().catch(() => false)
    ) {
      lastHandledAssistant = lastMessageText;
      fallbackConfirmCount += 1;
      await sendComposerMessage(
        page,
        `按你推荐的方案继续，确认生成30秒、${ratioLabel}的可编辑视频工程。MG数量按每个分镜内容独立判断，不设固定上限。`,
      );
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("Timed out waiting for video_project_ready");
}

async function waitForRenderedMgOverlay(
  page: Page,
  apiBaseUrl: string,
  authorization: string | undefined,
  assetId: number,
) {
  const deadline = Date.now() + 15 * 60_000;
  let lastTrackIds = "none";
  while (Date.now() < deadline) {
    const response = await page.request.get(`${apiBaseUrl}/v1/video/projects/${assetId}`, {
      headers: authorization ? { authorization } : {},
    });
    expect(response.ok(), `video project fetch failed: ${response.status()}`).toBe(true);
    const payload = await response.json() as {
      project?: { tracks?: Array<{ id?: string; overlay?: boolean }> };
      tracks?: Array<{ id?: string; overlay?: boolean }>;
    };
    const tracks = payload.project?.tracks ?? payload.tracks ?? [];
    lastTrackIds = tracks.map((track) => track.id ?? "unknown").join(", ") || "none";
    if (tracks.some((track) => track.id === "track-overlay" || track.overlay === true)) return;
    await page.waitForTimeout(3000);
  }
  throw new Error(`Timed out waiting for persisted MG overlay (last tracks: ${lastTrackIds})`);
}

async function exportVerifiedVideo(page: Page, exportPath: string) {
  const deadline = Date.now() + 12 * 60_000;
  let exportStarted = false;
  let automaticDownload: Download | null = null;
  const captureUnexpectedDownload = (download: Download) => {
    automaticDownload ??= download;
  };
  page.on("download", captureUnexpectedDownload);

  try {
    while (Date.now() < deadline) {
      if (automaticDownload) {
        throw new Error(
          "Export started a browser download without the required 下载成片 click",
        );
      }

      const failedButton = page.getByRole("button", { name: "导出失败，重试", exact: true });
      if (await failedButton.isVisible().catch(() => false)) {
        const alert = page.getByRole("alert").filter({ hasText: "导出失败" }).last();
        const detail = await alert.innerText().catch(() => "编辑器未返回错误详情");
        throw new Error(`Export failed in editor:\n${detail}`);
      }

      const downloadButton = page.getByRole("button", { name: "下载成片", exact: true });
      if (await downloadButton.isEnabled({ timeout: 500 }).catch(() => false)) {
        const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
        await downloadButton.click();
        const download = await downloadPromise;
        await download.saveAs(exportPath);
        return;
      }

      const exportButton = page.getByRole("button", { name: "导出视频", exact: true });
      if (!exportStarted && await exportButton.isEnabled({ timeout: 500 }).catch(() => false)) {
        await exportButton.click();
        exportStarted = true;
      }

      await page.waitForTimeout(5000);

      const qualityPanel = page.getByLabel("视频质量检查");
      if (await qualityPanel.isVisible().catch(() => false)) {
        const text = await qualityPanel.innerText();
        if (/不阻止导出/.test(text)) continue;
        if (!/MG 尚未完成|MG 与内容不一致|MG 渲染失败/.test(text)) {
          throw new Error(`Export blocked by quality gate:\n${text}`);
        }
        await page.waitForTimeout(5000);
        const recheck = qualityPanel.getByRole("button", { name: "重新检查" });
        if (await recheck.isEnabled().catch(() => false)) await recheck.click();
      }
    }
    throw new Error("Timed out waiting for verified MP4 download");
  } finally {
    page.off("download", captureUnexpectedDownload);
  }
}

test("uploads a real PDF through the UI and downloads only a verified MP4", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  if (!pdfPath || !fs.existsSync(pdfPath)) throw new Error(`PDF_VIDEO_PATH is missing: ${pdfPath ?? ""}`);
  if (!resultDir) throw new Error("PDF_VIDEO_RESULT_DIR is required");
  fs.mkdirSync(resultDir, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  // Capture backend JSON we care about, newest-wins, dumped at the end.
  const captured: Record<string, unknown> = {};
  let uploadBody: unknown = null;
  page.on("response", async (response) => {
    const url = response.url();
    try {
      if (/\/v1\/assets\/upload\b/.test(url) && response.request().method() === "POST") {
        uploadBody = await response.json();
      } else if (/\/v1\/video\/projects\/\d+(\?|$)/.test(url) && response.request().method() === "GET") {
        captured.videoProject = await response.json();
      } else if (/\/v1\/assets\/conversations\/messages\b/.test(url) && response.request().method() === "POST") {
        captured.lastMessages = await response.json();
      }
    } catch {
      /* non-JSON or race; ignore */
    }
  });

  mark("test_start");
  await enterLocalWorkspace(page);
  const uploadResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url().includes("/v1/assets/upload"),
    { timeout: 180_000 },
  );
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传 PDF 或文档" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(pdfPath);
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.ok(), `upload failed: ${uploadResponse.status()}`).toBe(true);
  const uploadedSource = await uploadResponse.json();
  expect(uploadedSource.metadata?.full_page_visuals_created).toBe(false);
  expect(uploadedSource.metadata?.document_embedded_image_count).toBeGreaterThan(0);
  const derivedImageIds = uploadedSource.metadata?.derived_visual_asset_ids ?? [];
  expect(derivedImageIds.length).toBeGreaterThan(0);
  const authorization = uploadResponse.request().headers().authorization;
  const apiBaseUrl = new URL(uploadResponse.url()).origin;
  const listAssets = async () => {
    const response = await page.request.get(`${apiBaseUrl}/v1/assets`, {
      headers: authorization ? { authorization } : {},
    });
    expect(response.ok(), `asset list failed: ${response.status()}`).toBe(true);
    return response.json();
  };
  const assetsAfterUpload = await listAssets() as E2EAsset[];
  const documentImages = assetsAfterUpload.filter((asset) => (
    derivedImageIds.includes(asset.id)
  ));
  expect(documentImages).toHaveLength(derivedImageIds.length);
  for (const image of documentImages) {
    expect(image.library_kind).toBe("image");
    expect(image.content_type).toBe("document_embedded_image");
    expect(image.metadata?.whole_page_visual).toBe(false);
    expect(image.metadata?.understanding?.tags?.length).toBeGreaterThan(0);
    expect(image.metadata?.source_context_text).toBeTruthy();
  }
  await expect(page.getByText("上传完成", { exact: true })).toBeVisible({ timeout: 180_000 });
  mark("upload_ingested");
  if (uploadBody) fs.writeFileSync(path.join(resultDir, "upload-asset.json"), JSON.stringify(uploadBody, null, 2));

  await sendComposerMessage(
    page,
    `请严格基于刚上传的商业计划书，生成一条30秒、${ratioLabel}的中文讲解视频。总时长允许27到33秒；MG按每个分镜内容独立判断，不设数量上限；数据必须来自PDF；字幕最多两行。先给我编导稿和分镜方案，确认后生成可编辑视频工程。`,
  );

  const exportButton = await waitForVideoProject(page);
  await expect(exportButton).toBeVisible();
  mark("storyboard_ready");
  const assetsAfterProject = await listAssets();
  const serializedProjectAssets = JSON.stringify(assetsAfterProject);
  expect(serializedProjectAssets).not.toContain("/pdf-pages/");
  expect(serializedProjectAssets).not.toContain("pdf_page_visual");
  const storyboardText = await page.getByLabel("分镜摘要").innerText();
  // Live LLM phrasing is diagnostic evidence, not a hard gate for the
  // MG/project/export path. Keep it in the result while allowing valid
  // source-grounded wording to vary between runs.
  recordStoryboardCopyNote("商家或门店定位", storyboardText, /商家|门店/);
  recordStoryboardCopyNote("素材理解", storyboardText, /素材理解|理解.{0,6}素材|素材.{0,6}理解/);
  recordStoryboardCopyNote("外部内容情报", storyboardText, /情报拆解|拆解热点|热点.{0,6}拆解|外部内容情报/);
  recordStoryboardCopyNote("可发布内容", storyboardText, /编排生成|自动生成内容|生成可发布内容|交付可发布|可发布.{0,8}短视频/);
  expect.soft(storyboardText).not.toMatch(/数字证据\s*30\s*秒/);
  const editButton = page.getByRole("button", { name: "编辑", exact: true });
  // MG overlays render serially on Modal; a PDF that plans 4 MGs can exceed
  // 5min. Widen to 15min so the edit gate reflects real render time, not a
  // too-tight harness bound. Test-level cap is 30min (setTimeout above).
  await expect(editButton).toBeEnabled({ timeout: 15 * 60_000 });
  const projectAsset = (assetsAfterProject as E2EAsset[]).find(
    (asset) => asset.content_type === "video_project",
  );
  expect(projectAsset, "video project asset is missing from the library").toBeDefined();
  await waitForRenderedMgOverlay(page, apiBaseUrl, authorization, projectAsset!.id);
  await page.reload();
  await expect(editButton).toBeEnabled({ timeout: 30_000 });
  await editButton.click();
  const readyExportButton = page.getByRole("button", { name: "导出视频", exact: true });
  await expect(readyExportButton).toBeEnabled({ timeout: 8 * 60_000 });
  const editor = page.frameLocator('iframe[title="视频剪辑器"]');
  const clips = editor.locator('[data-testid="filmstrip"] .shadcn-prototype-filmstrip-clip');
  const clipCount = await clips.count();
  let renderedMgFound = false;
  for (let index = 0; index < clipCount; index += 1) {
    await clips.nth(index).click();
    if (await editor.getByText("已启用字卡", { exact: true }).isVisible().catch(() => false)) {
      renderedMgFound = true;
      break;
    }
  }
  expect(renderedMgFound, "storyboard planned MG but the editor received no rendered overlay").toBe(true);
  mark("editor_ready");
  await page.screenshot({ path: path.join(resultDir, "project-ready.png"), fullPage: true });

  const exportPath = path.join(resultDir, "verified-export.mp4");
  await exportVerifiedVideo(page, exportPath);
  mark("export_verified");
  expect(fs.statSync(exportPath).size).toBeGreaterThan(1000);
  await expect(page.getByRole("button", { name: /再次下载|再次导出/ })).toBeVisible();
  await page.screenshot({ path: path.join(resultDir, "export-verified.png"), fullPage: true });

  const timing = elapsedTable();
  if (captured.videoProject) {
    fs.writeFileSync(path.join(resultDir, "video-project.json"), JSON.stringify(captured.videoProject, null, 2));
  }
  if (captured.lastMessages) {
    fs.writeFileSync(path.join(resultDir, "last-messages.json"), JSON.stringify(captured.lastMessages, null, 2));
  }
  fs.writeFileSync(
    path.join(resultDir, "browser-result.json"),
    JSON.stringify({
      pdfPath,
      exportPath,
      videoLayout,
      storyboardText,
      timing,
      consoleErrors,
      documentImages: documentImages.map((image) => ({
        id: image.id,
        title: image.title,
        libraryKind: image.library_kind,
        contentType: image.content_type,
        metadata: image.metadata,
      })),
    }, null, 2),
  );
});

// Guards the wider blast radius of defaulting the semantic-scene-fields flag ON:
// video generation that does NOT start from an uploaded PDF must still produce a
// storyboard and a verified MP4 end-to-end through the flag-extended LLM prompt.
test("generates a verified MP4 from a text-only prompt (no PDF) with the flag on", async ({ page }) => {
  test.setTimeout(30 * 60_000);
  if (!resultDir) throw new Error("PDF_VIDEO_RESULT_DIR is required");
  const outDir = path.join(resultDir, "non-pdf");
  fs.mkdirSync(outDir, { recursive: true });
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const captured: Record<string, unknown> = {};
  page.on("response", async (response) => {
    const url = response.url();
    try {
      if (/\/v1\/video\/projects\/\d+(\?|$)/.test(url) && response.request().method() === "GET") {
        captured.videoProject = await response.json();
      } else if (/\/v1\/assets\/conversations\/messages\b/.test(url) && response.request().method() === "POST") {
        captured.lastMessages = await response.json();
      }
    } catch {
      /* non-JSON or race; ignore */
    }
  });

  mark("test_start");
  await enterLocalWorkspace(page);
  if (existingConversationId) {
    const productQuery = existingProductId
      ? `&product=${encodeURIComponent(existingProductId)}`
      : "";
    await page.goto(
      `/app/assets?conversation=${encodeURIComponent(existingConversationId)}${productQuery}`,
    );
    await expect(
      page.getByRole("region", { name: "Content generation conversation" }),
    ).toBeVisible();
  } else {
    // Specific enough (product + audience + goal + duration + ratio) to skip the
    // clarification gate and go straight to brief + storyboard generation.
    const initialResponse = await sendComposerMessage(
      page,
      textOnlyPrompt,
    );
    await refreshAfterQueuedGeneration(page, initialResponse);
  }

  const exportButton = await waitForVideoProject(page);
  await expect(exportButton).toBeVisible();
  mark("storyboard_ready");
  const storyboardText = await page.getByLabel("分镜摘要").innerText();
  const editButton = page.getByRole("button", { name: "编辑", exact: true });
  await expect(editButton).toBeEnabled({ timeout: 5 * 60_000 });
  await editButton.click();
  const readyExportButton = page.getByRole("button", { name: "导出视频", exact: true });
  await expect(readyExportButton).toBeEnabled({ timeout: 180_000 });
  mark("editor_ready");

  const exportPath = path.join(outDir, "verified-export.mp4");
  await exportVerifiedVideo(page, exportPath);
  mark("export_verified");
  expect(fs.statSync(exportPath).size).toBeGreaterThan(1000);
  await expect(page.getByRole("button", { name: /再次下载|再次导出/ })).toBeVisible();

  // Flag-on marker: the LLM should have emitted brief_positioning. Soft so a
  // wording/omission variance records rather than aborts the export proof.
  const meta = (captured.lastMessages as { product?: { metadata?: Record<string, unknown> } } | undefined)?.product?.metadata;
  if (!existingConversationId) {
    expect.soft(meta?.brief_positioning, "flag-on run should carry LLM brief_positioning").toBeTruthy();
  }

  const timing = elapsedTable();
  if (captured.videoProject) {
    fs.writeFileSync(path.join(outDir, "video-project.json"), JSON.stringify(captured.videoProject, null, 2));
  }
  if (captured.lastMessages) {
    fs.writeFileSync(path.join(outDir, "last-messages.json"), JSON.stringify(captured.lastMessages, null, 2));
  }
  fs.writeFileSync(
    path.join(outDir, "browser-result.json"),
    JSON.stringify({ exportPath, prompt: textOnlyPrompt, storyboardText, timing, consoleErrors }, null, 2),
  );
});
