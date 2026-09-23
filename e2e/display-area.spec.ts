import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

type SeedResult = {
  conversation_ids: Record<string, string>;
  asset_ids: Record<string, number>;
};

const seed = JSON.parse(process.env.DISPLAY_COVERAGE_SEED_JSON ?? "{}") as Partial<SeedResult>;
const desktopEvidenceDirectory = resolve(process.cwd(), "artifacts/qa/desktop-ui-ux-remediation-20260917");

async function captureDesktopEvidence(page: Page, slug: string) {
  await mkdir(desktopEvidenceDirectory, { recursive: true });
  for (const viewport of [
    { width: 1280, height: 720, suffix: "1280x720" },
    { width: 1440, height: 900, suffix: "1440x900" },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.screenshot({
      path: resolve(desktopEvidenceDirectory, `${slug}-${viewport.suffix}.png`),
      animations: "disabled",
    });
  }
}

async function openCase(page: Page, caseId: string) {
  const conversationId = seed.conversation_ids?.[caseId];
  if (!conversationId) throw new Error(`Missing seeded conversation id for ${caseId}`);
  await page.goto("/app/assets");
  const conversationLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`);
  if (await conversationLink.count() === 0) {
    const showAllProjects = page.getByRole("button", { name: "查看全部", exact: true });
    await expect(showAllProjects).toBeVisible();
    await showAllProjects.click();
  }
  await expect(conversationLink).toBeVisible();
  await conversationLink.click();
  await expect(conversationLink).toHaveAttribute("aria-current", "page");
  const workspace = page.getByRole("region", { name: "Current product workspace" });
  await expect(workspace).toBeVisible();
  return workspace;
}

async function chooseVideoExport(
  workspace: ReturnType<Page["locator"]>,
  variant: "原始成片" | "品牌展示版" = "原始成片",
) {
  await workspace.getByRole("button", { name: "导出视频", exact: true }).click();
  await workspace.getByRole("menuitem", { name: variant, exact: true }).click();
}

async function resizeProductPaneAndExpectRatio(page: Page, surface: ReturnType<Page["locator"]>, expectedRatio: number) {
  await expect(surface).toBeVisible();
  const before = await surface.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return { width: rect.width, ratio: rect.width / rect.height };
  });
  expect(Math.abs(before.ratio - expectedRatio)).toBeLessThan(0.01);

  const divider = page.getByRole("separator", { name: "调整对话和展示区宽度" });
  const dividerBox = await divider.boundingBox();
  const viewport = page.viewportSize();
  expect(dividerBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!dividerBox || !viewport) return;

  const y = dividerBox.y + dividerBox.height / 2;
  await page.mouse.move(dividerBox.x + dividerBox.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(viewport.width - 160, y, { steps: 8 });
  await page.mouse.up();

  await expect.poll(() => surface.evaluate((node) => node.getBoundingClientRect().width)).toBeLessThan(before.width - 10);
  const afterRatio = await surface.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width / rect.height;
  });
  expect(Math.abs(afterRatio - expectedRatio)).toBeLessThan(0.01);
}

async function expectProportionalFramelessMediaCanvas(page: Page, surface: ReturnType<Page["locator"]>, expectedRatio: number) {
  await expect(surface).toHaveCSS("border-top-width", "0px");
  await expect(surface).toHaveCSS("border-right-width", "0px");
  await expect(surface).toHaveCSS("border-bottom-width", "0px");
  await expect(surface).toHaveCSS("border-left-width", "0px");
  await expect(surface).toHaveCSS("box-shadow", "none");
  await resizeProductPaneAndExpectRatio(page, surface, expectedRatio);
}

function environmentSnapshotName(name: string) {
  if (!process.env.CI) return name;
  return name.replace(/\.png$/, "-ci.png");
}

async function expectApprovedVideoPreviewShell(
  page: Page,
  player: ReturnType<Page["locator"]>,
  video: ReturnType<Page["locator"]>,
  expectedRatio: number,
) {
  await expect(player).toBeVisible();
  await expect(player).toHaveCSS("border-top", "1px solid rgb(234, 231, 225)");
  await expect(player).toHaveCSS("border-radius", "20px");
  await expect(player).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(player).toHaveCSS("padding-top", "7px");
  await expect(player).toHaveCSS("padding-right", "7px");
  await expect(player).toHaveCSS("padding-bottom", "7px");
  await expect(player).toHaveCSS("padding-left", "7px");
  await expect(player).toHaveCSS("box-shadow", /rgba\(32, 31, 30, 0\.05\).*rgba\(32, 31, 30, 0\.07\)/);
  await video.evaluate((node: HTMLVideoElement) => {
    node.pause();
    node.currentTime = 0;
  });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
  const screen = player.locator(".shadcn-prototype-preview-player-screen");
  const playIcon = screen.locator("svg");
  const progress = player.getByRole("slider", { name: "播放进度" });
  await expect(playIcon).toHaveCSS("width", "16px");
  await expect(playIcon).toHaveCSS("height", "16px");
  await expect(playIcon).toHaveCSS("padding", "14px");
  await expect(progress).toHaveCSS("height", "3px");
  await expect(progress).toHaveCSS("appearance", "none");
  await expect(player.locator(".shadcn-prototype-project-preview-controls")).toHaveCSS("padding", "8px 6px 4px");
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeLessThan(0.1);
  await expect(player).toHaveScreenshot(environmentSnapshotName("video-preview-shell.png"), {
    animations: "disabled",
    // The MP4 frame is intentionally verified by the readiness/seek checks
    // above.  Mask it here so this screenshot remains a deterministic check
    // of the player shell, controls, and spacing rather than codec seek noise.
    mask: [video],
    maskColor: "#111111",
    // Keep the visual assertion stable across tiny browser text/vector
    // anti-aliasing differences. Structural shell checks above remain exact.
    maxDiffPixels: 20,
  });
  await resizeProductPaneAndExpectRatio(page, screen, expectedRatio);
}

test("new conversation shows a non-interactive creative start in the display area", async ({ page }) => {
  await page.goto("/app/assets?conversation=new");

  const start = page.getByRole("region", { name: "创作起点" });
  await expect(start).toBeVisible();
  await expect(start.getByRole("heading", { name: "你的作品会在这里逐步成形" })).toBeVisible();
  const steps = start.getByRole("list", { name: "作品形成路径" });
  await expect(steps).toContainText("明确目标");
  await expect(steps).toContainText("形成编导方案");
  await expect(steps).toContainText("生成可编辑视频");
  await expect(start.getByText("先在左侧说说想做什么，或加入资料。", { exact: true })).toBeVisible();
  await expect(start.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "新建视频项目" })).toBeVisible();
  await captureDesktopEvidence(page, "creative-start");
});

test("CASE-01 shows a director draft with its bound video-plan confirmation", async ({ page }) => {
  const workspace = await openCase(page, "case-01-director-draft");
  await expect(workspace.locator("article.shadcn-prototype-copy-document")).toBeVisible();
  await expect(page.getByText("确认视频方案", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认生成视频工程" })).toBeVisible();
  await expect(workspace.getByLabel("视频预览")).toHaveCount(0);
  await expect(workspace.getByLabel("分镜摘要")).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "导出视频", exact: true })).toHaveCount(0);
  await captureDesktopEvidence(page, "copy-result");
});

test("CASE-14 exports distinct original and branded images and downloads the brand kit", async ({ page }) => {
  const workspace = await openCase(page, "case-14-image-export");
  const downloadMenu = workspace.getByRole("button", { name: "下载", exact: true });
  await expect(downloadMenu).toBeEnabled();
  await captureDesktopEvidence(page, "image-result");

  const originalDownloadPromise = page.waitForEvent("download");
  await downloadMenu.click();
  await workspace.getByRole("menuitem", { name: "下载原图", exact: true }).click();
  const originalDownload = await originalDownloadPromise;
  expect(originalDownload.suggestedFilename()).toBe("CASE-14 已生成图片.png");
  const originalPath = await originalDownload.path();
  expect(originalPath).not.toBeNull();
  const originalBytes = await readFile(originalPath!);

  const brandDownloadPromise = page.waitForEvent("download");
  await downloadMenu.click();
  await workspace.getByRole("menuitem", { name: "下载品牌展示版", exact: true }).click();
  const brandDownload = await brandDownloadPromise;
  expect(brandDownload.suggestedFilename()).toBe("CASE-14 已生成图片-multimix-brand.png");
  const brandPath = await brandDownload.path();
  expect(brandPath).not.toBeNull();
  const brandBytes = await readFile(brandPath!);
  expect(brandBytes.equals(originalBytes)).toBe(false);

  const kitDownloadPromise = page.waitForEvent("download");
  await downloadMenu.click();
  await workspace.getByRole("menuitem", { name: "下载 MultiMix 品牌包", exact: true }).click();
  const kitDownload = await kitDownloadPromise;
  expect(kitDownload.suggestedFilename()).toBe("multimix-brand-kit.zip");
  const kitPath = await kitDownload.path();
  expect(kitPath).not.toBeNull();
  const kitBytes = await readFile(kitPath!);
  expect([...kitBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  expect(kitBytes.includes(Buffer.from("multimix-brand-kit/README.md"))).toBe(true);
});

test("CASE-02 shows the saved asset reference", async ({ page }) => {
  const workspace = await openCase(page, "case-02-saved-asset-match");
  await workspace.getByLabel("来源引用").first().locator("summary").click();
  await expect(workspace.getByText("测试门店素材", { exact: false }).first()).toBeVisible();
});

test("CASE-03 tells public fallback apart from saved assets", async ({ page }) => {
  const workspace = await openCase(page, "case-03-no-asset-hit");
  await expect(workspace.getByText("已找到 3 个公共素材候选", { exact: false })).toBeVisible();
  await expect(workspace.getByText("测试门店素材", { exact: false })).toHaveCount(0);
});

test("CASE-04 stays in progress after reload", async ({ page }) => {
  const workspace = await openCase(page, "case-04-project-running");
  const progress = workspace.getByRole("status").filter({ hasText: "视频生成中" });
  await expect(progress).toBeVisible();
  await expect(workspace.locator(".shadcn-prototype-product-pending")).toHaveCount(0);
  await expect(workspace.getByLabel("时间轴预览")).toHaveCount(0);
  await page.reload();
  await expect(progress).toBeVisible();
  await expect(workspace.locator(".shadcn-prototype-product-pending")).toHaveCount(0);
  await expect(workspace.getByLabel("时间轴预览")).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await captureDesktopEvidence(page, "generating");
});

test("CASE-05 keeps one recovery action in the timeline", async ({ page }) => {
  const workspace = await openCase(page, "case-05-project-failed");
  const failure = workspace.getByRole("alert");
  const thread = page.getByRole("region", { name: "Content generation conversation" });
  await expect(failure.getByText("视频生成未能完成，请重试。", { exact: true })).toBeVisible();
  await expect(failure.getByText("请在左侧重试失败步骤", { exact: false })).toBeVisible();
  await expect(failure.getByRole("button", { name: /重试生成/ })).toHaveCount(0);
  const retryAction = thread.getByRole("button", { name: "重试", exact: true });
  await expect(retryAction).toHaveCount(1);
  await expect(retryAction).toBeVisible();
  await captureDesktopEvidence(page, "failure");
});

test("CASE-09 keeps an invalid video-render record out of the legacy preview", async ({ page }) => {
  const workspace = await openCase(page, "case-09-invalid-video-render");
  const recovery = workspace.getByRole("alert");

  await expect(recovery.getByText("视频失败", { exact: false })).toBeVisible();
  await expect(workspace.getByLabel("编导脚本预览")).toHaveCount(0);
  await expect(workspace.getByText("当前是可编辑编导脚本", { exact: false })).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
});

test("CASE-06 renders the ready engineering preview without opening the editable editor", async ({ page }) => {
  test.setTimeout(120_000);
  const editorMessages: Array<Record<string, unknown>> = [];
  await page.exposeFunction("__recordEditorBridgeMessage", (message: Record<string, unknown>) => {
    editorMessages.push(message);
  });
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (event.data?.source === "multimix-editor") {
        const recorder = (window as typeof window & {
          __recordEditorBridgeMessage?: (message: Record<string, unknown>) => Promise<void>;
        }).__recordEditorBridgeMessage;
        void recorder?.(event.data as Record<string, unknown>);
      }
    });
  });
  const editorRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/editor") editorRequests.push(request.url());
  });
  const workspace = await openCase(page, "case-06-project-ready-no-mp4");
  const player = workspace.getByLabel("视频工程播放器");
  const screen = player.locator(".shadcn-prototype-preview-player-screen");
  const previewFrame = workspace.getByTitle("视频工程预播");
  const playButton = workspace.getByRole("button", { name: "点击画面播放视频" });
  const progress = player.getByRole("slider", { name: "播放进度" });

  await expect(player).toBeVisible();
  await expect(previewFrame).toBeVisible();
  await expect(previewFrame).toHaveAttribute("src", /mode=preview/);
  await expect(workspace.getByTitle("视频剪辑器")).toHaveCount(0);
  const readLoadMessage = () => (
    editorMessages.find((message) => (
      message.type === "multimix-editor-ready" || message.type === "multimix-editor-error"
    )) ?? null
  );
  // A fresh isolated Next instance compiles the large /editor bundle on first
  // access. Wait for the editor's bridge result, not merely iframe load.
  await expect.poll(readLoadMessage, { timeout: 75_000 }).not.toBeNull();
  expect(editorRequests).toHaveLength(1);
  const loadMessage = await readLoadMessage();
  expect(loadMessage, `editor bridge failed: ${JSON.stringify(loadMessage)}`).toMatchObject({
    type: "multimix-editor-ready",
  });
  await expect(playButton).toBeEnabled({ timeout: 75_000 });
  await expect(progress).toBeEnabled({ timeout: 75_000 });
  const previewDocument = previewFrame.contentFrame();
  await expect(previewDocument.locator(".preview-canvas-controls")).toHaveCSS("display", "none");
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await expect(workspace.locator("video")).toHaveCount(0);
  await expect(player).toHaveCSS("border-top", "1px solid rgb(234, 231, 225)");
  await expect(player).toHaveCSS("border-radius", "20px");
  await expect(player).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(player).toHaveCSS("padding", "7px");
  await expect(player).toHaveCSS("box-shadow", /rgba\(32, 31, 30, 0\.05\).*rgba\(32, 31, 30, 0\.07\)/);
  await expect(playButton.locator("svg")).toHaveCSS("width", "16px");
  await expect(playButton.locator("svg")).toHaveCSS("padding", "14px");
  await expect(progress).toHaveCSS("height", "3px");
  await expect(player.locator(".shadcn-prototype-project-preview-controls")).toHaveCSS("padding", "8px 6px 4px");

  await workspace.getByRole("button", { name: /分镜 2|服务过程/ }).click();
  await expect.poll(async () => Number(await progress.inputValue())).toBeGreaterThanOrEqual(2.5);
  await previewFrame.evaluate((iframe) => {
    (iframe as HTMLIFrameElement).contentWindow?.postMessage(
      { source: "multimix-workspace", type: "multimix-editor-preview-pause" },
      window.location.origin,
    );
  });
  await expect(workspace.getByRole("button", { name: "点击画面播放视频" })).toBeVisible();
  await progress.fill("3");
  await expect(progress).toHaveValue("3");
  await expect.poll(() => {
    const previewStates = editorMessages.filter((message) => message.type === "multimix-editor-preview-state");
    return Number(previewStates.at(-1)?.time ?? -1);
  }).toBe(3);
  await page.waitForTimeout(100);
  await page.mouse.move(0, 0);

  await expect(player).toHaveScreenshot(environmentSnapshotName("video-preview-storyboard-shell.png"), {
    animations: "disabled",
    // The embedded renderer can settle on an adjacent deterministic canvas frame
    // after a seek. Shell geometry and styling remain covered by exact CSS checks.
    maxDiffPixels: 2_000,
  });
  await expectProportionalFramelessMediaCanvas(page, screen, 16 / 9);
  await captureDesktopEvidence(page, "video-engineering");
});

test("CASE-07 recovers the same export after API and worker restart", async ({ page }) => {
  test.skip(process.env.DISPLAY_EXPORT_RECOVERY !== "true", "Dedicated recovery runner only");
  test.setTimeout(300_000);

  const signalPath = process.env.DISPLAY_EXPORT_RECOVERY_SIGNAL_PATH;
  const resultPath = process.env.DISPLAY_EXPORT_RECOVERY_RESULT_PATH;
  if (!signalPath || !resultPath) throw new Error("Missing export recovery coordination paths");

  let exportStartCount = 0;
  await page.exposeFunction("__recordExportRecoveryMessage", (message: Record<string, unknown>) => {
    if (message.type === "multimix-editor-export-start") exportStartCount += 1;
  });
  await page.addInitScript(() => {
    window.addEventListener("message", (event) => {
      if (event.data?.source !== "multimix-editor") return;
      const recorder = (window as typeof window & {
        __recordExportRecoveryMessage?: (message: Record<string, unknown>) => Promise<void>;
      }).__recordExportRecoveryMessage;
      void recorder?.(event.data as Record<string, unknown>);
    });
  });

  const assetId = seed.asset_ids?.["case-07-project-ready-mp4"];
  if (!assetId) throw new Error("Missing seeded asset id for CASE-07");
  const exportRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === `/v1/video/projects/${assetId}/exports`) {
      exportRequests.push(request.url());
    }
  });

  const workspace = await openCase(page, "case-07-project-ready-mp4");
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="视频剪辑器"]');
  const clips = editor.locator('[data-testid="filmstrip"] .shadcn-prototype-filmstrip-clip');
  await expect(clips).toHaveCount(3, { timeout: 90_000 });
  await clips.first().click();
  const saveResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "PUT"
      && url.pathname === `/v1/video/projects/${assetId}`;
  });
  await editor.getByRole("button", { name: "✂ 分割", exact: true }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);
  await page.getByRole("button", { name: "完成编辑", exact: true }).dispatchEvent("click");
  await expect(workspace.locator("video")).toHaveCount(0);
  const exportButton = workspace.getByRole("button", { name: "导出视频", exact: true });
  await expect(exportButton).toBeEnabled({ timeout: 90_000 });
  const exportResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST"
      && url.pathname === `/v1/video/projects/${assetId}/exports`;
  });
  await chooseVideoExport(workspace);
  const exportResponse = await exportResponsePromise;
  expect(exportResponse.status()).toBe(202);
  const createdJob = await exportResponse.json() as { job_id?: string };
  expect(createdJob.job_id).toMatch(/^video-export-/);
  await expect(workspace.getByRole("button", { name: "原始成片 · 正在检查", exact: true })).toBeDisabled();

  const currentResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === `/v1/video/projects/${assetId}/exports/current`
      && response.status() === 200;
  });
  await page.reload();
  const currentResponse = await currentResponsePromise;
  const recoveredJob = await currentResponse.json() as { job_id?: string };
  expect(recoveredJob.job_id).toBe(createdJob.job_id);
  const recoveredWorkspace = page.getByRole("region", { name: "Current product workspace" });
  await expect(recoveredWorkspace.getByRole("button", { name: "原始成片 · 正在检查", exact: true })).toBeDisabled();

  await writeFile(signalPath, JSON.stringify({ assetId, jobId: createdJob.job_id }), "utf8");

  const downloadButton = recoveredWorkspace.getByRole("button", { name: "导出视频", exact: true });
  await expect(downloadButton).toBeEnabled({ timeout: 180_000 });
  await expect.poll(async () => {
    try {
      return await readFile(resultPath, "utf8");
    } catch {
      return "";
    }
  }, { timeout: 30_000 }).not.toBe("");
  const workerResultText = await readFile(resultPath, "utf8");
  const workerResult = JSON.parse(workerResultText) as {
    public_id?: string;
    initial_status?: string;
    initial_attempts?: number;
    status?: string;
    stage?: string;
    attempts?: number;
  };
  expect(workerResult).toMatchObject({
    public_id: createdJob.job_id,
    initial_status: "queued",
    initial_attempts: 0,
    status: "completed",
    stage: "done",
    attempts: 1,
  });

  const downloadPromise = page.waitForEvent("download");
  await chooseVideoExport(recoveredWorkspace);
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(download.suggestedFilename()).toMatch(/\.mp4$/i);
  expect(downloadPath).not.toBeNull();
  if (downloadPath) expect((await stat(downloadPath)).size).toBeGreaterThan(0);
  expect(exportStartCount).toBe(1);
  expect(exportRequests).toHaveLength(1);
});

test("video library renders one bounded page without eager video elements", async ({ page }) => {
  const listRequests: URL[] = [];
  const mediaRequests: URL[] = [];
  let captureLibraryMedia = false;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/v1/assets" && url.searchParams.get("library_kind") === "video") {
      listRequests.push(url);
    }
    if (captureLibraryMedia && request.resourceType() === "media") {
      mediaRequests.push(url);
    }
  });
  await page.goto("/app/assets");
  captureLibraryMedia = true;
  await page.locator(".shadcn-prototype-nav").getByRole("button", { name: "视频库", exact: true }).click();

  const grid = page.getByLabel("视频库列表");
  const cards = grid.locator("button.shadcn-prototype-library-media-card");
  const shell = page.locator("main.shadcn-prototype-shell");
  await expect(grid).toBeVisible();
  await expect(cards).toHaveCount(48);
  await expect(grid.locator("video")).toHaveCount(0);
  expect(mediaRequests).toHaveLength(0);
  expect(listRequests).toHaveLength(1);
  expect(listRequests[0].searchParams.get("limit")).toBe("49");
  expect(listRequests[0].searchParams.get("offset")).toBe("0");

  const collapseStartedAt = Date.now();
  await page.getByRole("button", { name: "隐藏侧边栏" }).click();
  await expect(shell).toHaveClass(/sidebar-collapsed/);
  expect(Date.now() - collapseStartedAt).toBeLessThan(1_500);
  await page.getByRole("button", { name: "展开侧边栏" }).click();
  await expect(shell).not.toHaveClass(/sidebar-collapsed/);

  await expect(page.getByText("当前显示 48 项", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "加载更多内容" }).click();
  await expect(cards).toHaveCount(65);
  await expect(grid.locator("video")).toHaveCount(0);
  expect(mediaRequests).toHaveLength(0);
  expect(listRequests).toHaveLength(2);
  expect(listRequests[1].searchParams.get("limit")).toBe("49");
  expect(listRequests[1].searchParams.get("offset")).toBe("48");
});

test("library cross-type details and interaction states stay consistent", async ({ page }) => {
  const updatedAt = "2026-09-17T10:00:00Z";
  const copyAsset = {
    id: 9101,
    library_kind: "copy",
    asset_kind: "copy",
    content_type: "social_post",
    title: "秋季门店焕新推广文案",
    status: "ready",
    body: "秋日焕新，从一扇更安静的窗开始。\n\n我们把隔音、保温和采光写进每一个生活细节，让家的舒适被真实感知。\n\n到店可查看真实案例与材料样板。",
    source_type: "conversation",
    source_filename: null,
    original_ref: null,
    markdown_ref: null,
    metadata: { reference_count: 3, artifact_category: "文案稿" },
    source_mapping: [{ title: "门店活动需求", source_type: "conversation", asset_id: 701 }],
    linked_asset_ids: [],
    linked_event_ids: [],
    versions: [{ version: 1, instruction: "初稿" }, { version: 2, instruction: "强化到店行动" }],
    updated_at: updatedAt,
  };
  const legacyDirectorAsset = {
    ...copyAsset,
    id: 9102,
    library_kind: "video",
    asset_kind: "video",
    content_type: "video_script",
    title: "生产验收编导稿",
    body: "# 生产验收编导稿\n\n这是连续文字编导内容，不应显示播放器。",
    metadata: { reference_count: 1, artifact_category: "编导稿" },
    versions: [{ version: 1, instruction: "确认编导方案" }],
  };
  const baseVideoAsset = {
    library_kind: "video",
    asset_kind: "video",
    content_type: "generated_video",
    status: "ready",
    body: "镜头一：门店外景与品牌标识。\n\n镜头二：隔音窗细节和实际体验。\n\n镜头三：顾客到店咨询与行动引导。",
    source_type: "generation",
    source_filename: "store-campaign.mp4",
    source_content_type: "video/mp4",
    original_ref: null,
    markdown_ref: null,
    metadata: {
      reference_count: 1,
      artifact_category: "生成视频素材",
      understanding: { status: "ready", caption: "门店焕新推广视频", tags: ["门店", "隔音窗", "到店"] },
    },
    source_mapping: [],
    linked_asset_ids: [],
    linked_event_ids: [],
    versions: [],
    updated_at: updatedAt,
  };
  const videoAssets = Array.from({ length: 52 }, (_, index) => ({
    ...baseVideoAsset,
    ...(index === 0 ? {
      content_type: "video_project",
      body: "第一步：说出你的营销想法，系统整理目标和受众。\n\n第二步：AI 生成可确认的编导方案并匹配画面。\n\n第三步：继续通过对话调整分镜、节奏和字幕。",
      metadata: { ...baseVideoAsset.metadata, artifact_category: "视频工程" },
      versions: [
        { version: 3, instruction: "global-revision:before" },
        { version: 4, instruction: "video.project.set_ratio" },
        { version: 5, instruction: "video.project.reorder_scenes" },
      ],
    } : {}),
    id: 9201 + index,
    title: index === 0 ? "门店焕新推广视频" : `门店视频素材 ${String(index + 1).padStart(2, "0")}`,
  }));
  const sourceAsset = {
    id: 9301,
    library_kind: "assets",
    asset_kind: "asset",
    content_type: "pdf",
    title: "门窗行业获客白皮书",
    status: "ready",
    body: "本资料汇总本地门窗门店的短视频获客路径。\n\n重点包括到店线索、案例可信度、内容频次和咨询转化。",
    source_type: "upload",
    source_filename: "门窗行业获客白皮书.pdf",
    source_content_type: "application/pdf",
    original_ref: "local://fixtures/window-industry-report.pdf",
    markdown_ref: null,
    metadata: {
      reference_count: 2,
      understanding: { status: "ready", caption: "门窗门店短视频获客与转化摘要", tags: ["门窗", "获客", "转化"] },
    },
    source_mapping: [{ title: "白皮书第 3 章", source_type: "document", state: "ready" }],
    linked_asset_ids: [],
    linked_event_ids: [],
    versions: [],
    updated_at: updatedAt,
  };

  await page.route("**/v1/assets?**", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const url = new URL(route.request().url());
    const kind = url.searchParams.get("library_kind");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "49");
    const rows = kind === "copy" ? [copyAsset, legacyDirectorAsset] : kind === "video" ? videoAssets : kind === "assets" ? [sourceAsset] : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows.slice(offset, offset + limit)) });
  });
  await page.route("**/v1/assets/search?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
  await page.route("**/v1/assets/semantic-search?**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));

  await page.goto("/app/assets");
  const navigation = page.locator(".shadcn-prototype-nav");

  await navigation.getByRole("button", { name: "文案库", exact: true }).click();
  const copyGrid = page.getByLabel("文案库列表");
  await copyGrid.locator("button.shadcn-prototype-library-text-card").first().click();
  let detail = page.getByRole("dialog", { name: "秋季门店焕新推广文案详情" });
  await expect(detail.getByText("秋日焕新，从一扇更安静的窗开始。", { exact: true })).toBeVisible();
  await expect(detail.locator(".shadcn-prototype-library-detail-primary")).toHaveText("用于创作");
  await captureDesktopEvidence(page, "copy-detail");
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();

  const directorCard = copyGrid.getByRole("button").filter({ hasText: "生产验收编导稿" });
  await expect(directorCard).toHaveCount(1);
  await directorCard.click();
  detail = page.getByRole("dialog", { name: "生产验收编导稿详情" });
  await expect(detail.getByText("这是连续文字编导内容，不应显示播放器。", { exact: true })).toBeVisible();
  await expect(detail.locator(".shadcn-prototype-library-video-preview")).toHaveCount(0);
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();

  await page.getByRole("textbox", { name: "搜索文案库" }).fill("不存在的内容");
  await expect(page.getByText("没有找到匹配内容", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除搜索和筛选", exact: true }).click();
  await expect(copyGrid.locator("button.shadcn-prototype-library-text-card")).toHaveCount(2);
  await page.getByRole("button", { name: "选题方案", exact: true }).click();
  await expect(page.getByText("没有找到匹配内容", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除搜索和筛选", exact: true }).click();

  await navigation.getByRole("button", { name: "视频库", exact: true }).click();
  const videoGrid = page.getByLabel("视频库列表");
  await expect(page.getByText("当前显示 48 项", { exact: true })).toBeVisible();
  await videoGrid.locator("button.shadcn-prototype-library-media-card").first().click();
  detail = page.getByRole("dialog", { name: "门店焕新推广视频详情" });
  await expect(detail.getByText("规格", { exact: true })).toBeVisible();
  await expect(detail.getByText("用于创作", { exact: true })).toBeVisible();
  const previewSection = detail.locator(".shadcn-prototype-library-content").nth(1);
  const versionSection = detail.locator(".shadcn-prototype-library-keywords");
  const [previewBox, versionBox] = await Promise.all([previewSection.boundingBox(), versionSection.boundingBox()]);
  expect(previewBox).not.toBeNull();
  expect(versionBox).not.toBeNull();
  if (previewBox && versionBox) {
    expect(previewBox.y + previewBox.height).toBeLessThanOrEqual(versionBox.y);
  }
  await captureDesktopEvidence(page, "video-detail");
  await detail.getByRole("button", { name: "关闭详情", exact: true }).click();
  await page.getByRole("button", { name: "加载更多内容", exact: true }).click();
  await expect(videoGrid.locator("button.shadcn-prototype-library-media-card")).toHaveCount(52);
  await expect(page.getByRole("button", { name: "加载更多内容", exact: true })).toHaveCount(0);

  await navigation.getByRole("button", { name: "资产库", exact: true }).click();
  const assetGrid = page.getByLabel("资产库列表");
  await assetGrid.locator("button.shadcn-prototype-library-text-card").first().click();
  detail = page.getByRole("dialog", { name: "门窗行业获客白皮书详情" });
  await expect(detail.getByRole("heading", { name: /AI 摘要/ })).toBeVisible();
  await expect(detail.getByText("本资料汇总本地门窗门店的短视频获客路径。", { exact: true })).toBeVisible();
  await detail.getByLabel("更多操作").click();
  await expect(detail.getByRole("button", { name: "查看来源", exact: true })).toBeVisible();
  await captureDesktopEvidence(page, "asset-detail");
});

test("CASE-07 loads a real MP4 and seeks by segment", async ({ page }) => {
  test.setTimeout(240_000);
  const workspace = await openCase(page, "case-07-project-ready-mp4");
  const assetId = seed.asset_ids?.["case-07-project-ready-mp4"];
  if (!assetId) throw new Error("Missing seeded asset id for CASE-07");
  const video = workspace.locator("video").first();
  const player = workspace.locator(".shadcn-prototype-preview-player");
  const segmentList = workspace.locator(".shadcn-prototype-segment-cards > ol");
  const segmentCards = workspace.locator(".shadcn-prototype-segment-cards");
  await expect(video).toBeVisible();
  await expect(video).toHaveCSS("object-fit", "contain");
  await expect(segmentList).toHaveCSS("overflow-y", "auto");
  await expect(workspace.getByRole("separator", { name: "调整视频预览高度" })).toHaveCount(0);
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  await workspace.getByRole("button", { name: /分镜 2|服务过程/ }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(2.5);
  await expectApprovedVideoPreviewShell(page, player, video, 16 / 9);
  const layoutGap = await Promise.all([player.boundingBox(), segmentCards.boundingBox()]);
  expect(layoutGap[0]).not.toBeNull();
  expect(layoutGap[1]).not.toBeNull();
  if (layoutGap[0] && layoutGap[1]) {
    expect(layoutGap[1].y - (layoutGap[0].y + layoutGap[0].height)).toBeLessThan(32);
  }
  await captureDesktopEvidence(page, "video-complete");

  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="视频剪辑器"]');
  const clips = editor.locator('[data-testid="filmstrip"] .shadcn-prototype-filmstrip-clip');
  await expect(clips).toHaveCount(3, { timeout: 75_000 });
  await clips.first().click();
  const saveResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "PUT"
      && url.pathname === `/v1/video/projects/${assetId}`;
  });
  await editor.getByRole("button", { name: "✂ 分割", exact: true }).click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.status()).toBe(200);

  await page.getByRole("button", { name: "完成编辑", exact: true }).dispatchEvent("click");
  await expect(workspace.locator("video")).toHaveCount(0);
  const exportButton = workspace.getByRole("button", { name: "导出视频", exact: true });
  await expect(exportButton).toBeEnabled();

  const exportRequests: Array<{ method: string; pathname: string; search: string }> = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith(`/v1/video/projects/${assetId}`)) {
      exportRequests.push({ method: request.method(), pathname: url.pathname, search: url.search });
    }
  });
  const originalExportResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST"
      && url.pathname === `/v1/video/projects/${assetId}/exports`;
  });
  await chooseVideoExport(workspace);
  const originalExportResponse = await originalExportResponsePromise;
  expect(originalExportResponse.status()).toBe(202);
  const originalJob = await originalExportResponse.json() as {
    job_id?: string;
    export_variant?: string;
    brand_spec_version?: string | null;
  };
  expect(originalJob).toMatchObject({ export_variant: "original", brand_spec_version: null });
  await expect(workspace.getByRole("button", { name: /^原始成片 · 正在/ })).toBeDisabled({ timeout: 30_000 });
  await expect(exportButton).toBeEnabled({ timeout: 180_000 });

  const downloadPromise = page.waitForEvent("download");
  await chooseVideoExport(workspace);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/i);
  expect(download.suggestedFilename()).not.toContain("-multimix-brand");
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (downloadPath) expect((await stat(downloadPath)).size).toBeGreaterThan(0);

  const brandExportResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "POST"
      && url.pathname === `/v1/video/projects/${assetId}/exports`
      && url.searchParams.get("export_variant") === "brand_showcase";
  });
  await chooseVideoExport(workspace, "品牌展示版");
  const brandExportResponse = await brandExportResponsePromise;
  expect(brandExportResponse.status()).toBe(202);
  const brandJob = await brandExportResponse.json() as {
    job_id?: string;
    export_variant?: string;
    brand_spec_version?: string | null;
  };
  expect(brandJob).toMatchObject({
    export_variant: "brand_showcase",
    brand_spec_version: "multimix-brand-showcase:v1",
  });
  expect(brandJob.job_id).not.toBe(originalJob.job_id);
  await expect(workspace.getByRole("button", { name: /^品牌展示版 · 正在/ })).toBeDisabled({ timeout: 30_000 });
  await expect(exportButton).toBeEnabled({ timeout: 180_000 });

  const brandDownloadPromise = page.waitForEvent("download");
  await chooseVideoExport(workspace, "品牌展示版");
  const brandDownload = await brandDownloadPromise;
  expect(brandDownload.suggestedFilename()).toMatch(/-multimix-brand\.mp4$/i);
  const brandDownloadPath = await brandDownload.path();
  expect(brandDownloadPath).not.toBeNull();
  if (brandDownloadPath) expect((await stat(brandDownloadPath)).size).toBeGreaterThan(0);

  const storedUser = await page.evaluate(() => JSON.parse(
    window.localStorage.getItem("multimix_local_user") ?? "{}",
  ) as { token?: string });
  expect(storedUser.token).toBeTruthy();
  const backendUrl = `http://127.0.0.1:${process.env.DISPLAY_COVERAGE_BACKEND_PORT}`;
  const headers = { Authorization: `Bearer ${storedUser.token}` };
  const [currentOriginalResponse, currentBrandResponse] = await Promise.all([
    page.request.get(`${backendUrl}/v1/video/projects/${assetId}/exports/current?export_variant=original`, { headers }),
    page.request.get(
      `${backendUrl}/v1/video/projects/${assetId}/exports/current?export_variant=brand_showcase&brand_spec_version=multimix-brand-showcase%3Av1`,
      { headers },
    ),
  ]);
  expect(currentOriginalResponse.status()).toBe(200);
  expect(currentBrandResponse.status()).toBe(200);
  const currentOriginal = await currentOriginalResponse.json() as { job_id?: string; mp4_ref?: string };
  const currentBrand = await currentBrandResponse.json() as { job_id?: string; mp4_ref?: string };
  expect(currentOriginal.job_id).toBe(originalJob.job_id);
  expect(currentBrand.job_id).toBe(brandJob.job_id);
  expect(currentOriginal.mp4_ref).toBeTruthy();
  expect(currentBrand.mp4_ref).toBeTruthy();
  expect(currentBrand.mp4_ref).not.toBe(currentOriginal.mp4_ref);

  expect(exportRequests.filter((item) => item.method === "PUT" && item.pathname === `/v1/video/projects/${assetId}`)).toHaveLength(2);
  expect(exportRequests.filter((item) => item.method === "GET" && item.pathname.endsWith("/quality") && item.search.includes("stage=export_preflight"))).toHaveLength(2);
  expect(exportRequests.filter((item) => item.method === "POST" && item.pathname.endsWith("/exports"))).toHaveLength(2);
  expect(exportRequests.filter((item) => item.pathname.endsWith("/exports/finalize"))).toHaveLength(0);
});

test("desktop start and image library keep the approved hierarchy", async ({ page }) => {
  await page.goto("/app/assets");
  await page.getByRole("button", { name: "新建项目", exact: true }).first().click();
  await expect(page.getByRole("heading", { name: "新建视频项目", exact: true })).toBeVisible();
  const sidebar = page.getByRole("complementary", { name: "Workspace navigation" });
  const projectRows = sidebar.locator(".shadcn-prototype-conversation-row");
  const projectSection = sidebar.locator(".shadcn-prototype-conversation-section");
  const libraryNavigation = sidebar.getByRole("navigation", { name: "资源库" });
  const libraryButtons = libraryNavigation.getByRole("button");
  await expect(sidebar.getByText("最近项目", { exact: true })).toBeVisible();
  await expect(libraryNavigation.getByText("资源库", { exact: true })).toBeVisible();
  await expect(libraryButtons).toHaveCount(4);
  await expect(libraryNavigation.getByRole("button", { name: "资产库", exact: true })).toContainText("资产");
  await expect(libraryNavigation.getByRole("button", { name: "文案库", exact: true })).toContainText("文案");
  await expect(libraryNavigation.getByRole("button", { name: "图片库", exact: true })).toContainText("图片");
  await expect(libraryNavigation.getByRole("button", { name: "视频库", exact: true })).toContainText("视频");
  await expect.poll(async () => libraryNavigation.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(2);
  await expect(projectRows).toHaveCount(8);
  await expect(sidebar.getByText("可继续编辑", { exact: true })).toHaveCount(0);
  await expect(sidebar.getByText("待完善需求", { exact: true })).toHaveCount(0);
  await expect(page.getByText("你的素材可以开始做视频了", { exact: true })).toHaveCount(0);
  const [projectBox, libraryBox] = await Promise.all([projectSection.boundingBox(), libraryNavigation.boundingBox()]);
  expect(projectBox).not.toBeNull();
  expect(libraryBox).not.toBeNull();
  if (projectBox && libraryBox) expect(libraryBox.y).toBeGreaterThan(projectBox.y);
  await sidebar.getByRole("button", { name: "查看全部", exact: true }).click();
  await expect(projectRows).toHaveCount(14);
  await sidebar.getByRole("button", { name: "收起项目", exact: true }).click();
  await expect(projectRows).toHaveCount(8);
  await captureDesktopEvidence(page, "new-project");

  await page.locator(".shadcn-prototype-nav").getByRole("button", { name: "图片库", exact: true }).click();
  const breadcrumb = page.locator(".shadcn-prototype-topbar .shadcn-prototype-breadcrumb");
  await expect(breadcrumb).toContainText("资源库");
  await expect(breadcrumb).toContainText("图片库");
  await expect(page.getByRole("heading", { name: "图片库", exact: true })).toBeVisible();
  await expect(page.getByText("管理封面图、素材图和可以复用的分镜画面。", { exact: true })).toBeVisible();
  await expect(page.getByLabel("图片库筛选")).toBeVisible();
  await expect(page.getByRole("group", { name: "内容类型" })).toBeVisible();
  await expect(page.getByRole("group", { name: "处理状态" })).toBeVisible();
  const grid = page.getByLabel("图片库列表");
  const firstCard = grid.locator("button.shadcn-prototype-library-media-card").first();
  await expect(firstCard).toBeVisible();
  await captureDesktopEvidence(page, "image-library");

  await firstCard.click();
  const detailDialog = page.getByRole("dialog", { name: /详情$/ });
  await expect(detailDialog).toBeVisible();
  await expect(detailDialog.locator(".shadcn-prototype-library-detail-primary")).toHaveCount(1);
  await expect(detailDialog.locator(".shadcn-prototype-library-detail-body")).toHaveCSS("overflow-y", "auto");
  await expect(detailDialog.locator(".shadcn-prototype-library-actions")).toBeVisible();
  await captureDesktopEvidence(page, "image-detail");
  await detailDialog.getByLabel("更多操作").click();
  await expect(detailDialog.getByRole("button", { name: "下载", exact: true })).toBeVisible();
  await expect(detailDialog.getByRole("button", { name: "删除", exact: true })).toBeVisible();
  await captureDesktopEvidence(page, "image-detail-more");
  await detailDialog.getByLabel("更多操作").click();
  await page.getByRole("button", { name: "关闭详情", exact: true }).click();

  await page.locator(".shadcn-prototype-nav").getByRole("button", { name: "资产库", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 720 });
  const assetHeader = page.locator(".shadcn-prototype-library-page-header");
  await expect(page.getByRole("heading", { name: "资产库", exact: true })).toBeVisible();
  await expect(assetHeader.getByRole("textbox", { name: "搜索资产库" })).toBeVisible();
  await expect(assetHeader.getByRole("button", { name: "读取网页", exact: true })).toBeVisible();
  await expect(assetHeader.getByRole("button", { name: "公开素材搜索", exact: true })).toBeVisible();
  await expect(assetHeader.getByRole("button", { name: "上传", exact: true })).toBeVisible();
  const [assetHeaderBox, viewport] = await Promise.all([
    assetHeader.boundingBox(),
    page.evaluate(() => ({ width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth })),
  ]);
  expect(assetHeaderBox).not.toBeNull();
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width);
  if (assetHeaderBox) expect(assetHeaderBox.x + assetHeaderBox.width).toBeLessThanOrEqual(viewport.width);
  await captureDesktopEvidence(page, "asset-library");
});

test("CASE-08 marks the video failed when a planned MG effect fails", async ({ page }, testInfo) => {
  const workspace = await openCase(page, "case-08-mg-failed-project-ready");
  const thread = page.getByRole("region", { name: "Content generation conversation" });
  const failure = workspace.getByRole("alert");
  await expect(failure.getByText("第 2 镜动效未能完成", { exact: false })).toBeVisible();
  await expect(failure.getByText("请在左侧重试失败步骤", { exact: false })).toBeVisible();
  await expect(failure.getByRole("button", { name: /重试生成/ })).toHaveCount(0);
  const retryAction = thread.getByRole("button", { name: "重试", exact: true });
  await expect(retryAction).toHaveCount(1);
  await expect(retryAction).toBeVisible();
  await expect(thread.getByText(/视频已生成，可立即编辑/)).toHaveCount(0);
  await expect(page.getByText(/视频已生成，可立即编辑/)).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "导出视频", exact: true })).toHaveCount(0);
  await testInfo.attach("lly-32-case-08-full-page", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});

for (const scenario of [
  { id: "case-10-required-media-optional-compile-failed", text: "补充或重新选择素材", pending: false },
  { id: "case-11-non-retryable-reframe-failed", text: "请调整编导脚本后重新生成", pending: false },
  { id: "case-13-required-native-pending", text: "视频生成中", pending: true },
]) {
  test(`${scenario.id} blocks completion and keeps recovery consistent after reload`, async ({ page }, testInfo) => {
    const workspace = await openCase(page, scenario.id);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      const notice = workspace.getByRole(scenario.pending ? "status" : "alert").filter({ hasText: scenario.text });
      await expect(notice).toBeVisible();
      await expect(page.getByText(/视频已生成，可立即编辑/)).toHaveCount(0);
      await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
      await expect(workspace.getByRole("button", { name: "导出视频", exact: true })).toHaveCount(0);
      if (!scenario.pending) {
        await expect(notice.getByRole("button", { name: "修改编导脚本", exact: true })).toBeVisible();
        await expect(workspace.getByRole("button", { name: /重试/ })).toHaveCount(0);
      }
    }
    await testInfo.attach(scenario.id, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  });
}

test("case-12-only-optional-compile-failed remains editable with a warning after reload", async ({ page }, testInfo) => {
  const workspace = await openCase(page, "case-12-only-optional-compile-failed");
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
    await expect(workspace.getByText("部分可选图形动效未能完成", { exact: false })).toBeVisible();
  }
  await testInfo.attach("case-12-only-optional-compile-failed", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
