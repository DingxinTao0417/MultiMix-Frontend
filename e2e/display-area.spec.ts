import { expect, test, type Page } from "@playwright/test";

type SeedResult = {
  conversation_ids: Record<string, string>;
};

const seed = JSON.parse(process.env.DISPLAY_COVERAGE_SEED_JSON ?? "{}") as Partial<SeedResult>;

async function openCase(page: Page, caseId: string) {
  const conversationId = seed.conversation_ids?.[caseId];
  if (!conversationId) throw new Error(`Missing seeded conversation id for ${caseId}`);
  await page.goto("/app/assets");
  const conversationLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`);
  await expect(conversationLink).toBeVisible();
  await conversationLink.click();
  await expect(conversationLink).toHaveAttribute("aria-current", "page");
  const workspace = page.getByRole("region", { name: "Current product workspace" });
  await expect(workspace).toBeVisible();
  return workspace;
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
  const screen = player.locator(".shadcn-prototype-preview-player-screen");
  const playIcon = screen.locator("svg");
  const progress = player.getByRole("slider", { name: "播放进度" });
  await expect(playIcon).toHaveCSS("width", "16px");
  await expect(playIcon).toHaveCSS("height", "16px");
  await expect(playIcon).toHaveCSS("padding", "14px");
  await expect(progress).toHaveCSS("height", "3px");
  await expect(progress).toHaveCSS("appearance", "none");
  await expect(player.locator(".shadcn-prototype-project-preview-controls")).toHaveCSS("padding", "8px 6px 4px");
  await video.evaluate((node: HTMLVideoElement) => {
    node.pause();
    node.currentTime = 0;
  });
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeLessThan(0.1);
  await expect(player).toHaveScreenshot("video-preview-shell.png", {
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

test("CASE-01 shows a director draft without project controls", async ({ page }) => {
  const workspace = await openCase(page, "case-01-director-draft");
  await expect(workspace.locator("article.shadcn-prototype-copy-document")).toBeVisible();
  await expect(workspace.getByLabel("视频预览")).toHaveCount(0);
  await expect(workspace.getByLabel("分镜摘要")).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "导出视频", exact: true })).toHaveCount(0);
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
  await page.reload();
  await expect(progress).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
});

test("CASE-05 shows its stable failure and retry", async ({ page }) => {
  const workspace = await openCase(page, "case-05-project-failed");
  const failure = workspace.getByRole("alert");
  await expect(failure.getByText("素材合成步骤失败", { exact: false })).toBeVisible();
  await expect(failure.getByRole("button", { name: /重试生成/ })).toBeVisible();
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

  await expect(player).toHaveScreenshot("video-preview-storyboard-shell.png", {
    animations: "disabled",
    // The embedded renderer can settle on an adjacent deterministic canvas frame
    // after a seek. Shell geometry and styling remain covered by exact CSS checks.
    maxDiffPixels: 2_000,
  });
  await expectProportionalFramelessMediaCanvas(page, screen, 16 / 9);
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

  await page.getByRole("button", { name: "加载更多" }).click();
  await expect(cards).toHaveCount(61);
  await expect(grid.locator("video")).toHaveCount(0);
  expect(mediaRequests).toHaveLength(0);
  expect(listRequests).toHaveLength(2);
  expect(listRequests[1].searchParams.get("limit")).toBe("49");
  expect(listRequests[1].searchParams.get("offset")).toBe("48");
});

test("CASE-07 loads a real MP4 and seeks by segment", async ({ page }) => {
  test.setTimeout(60_000);
  const workspace = await openCase(page, "case-07-project-ready-mp4");
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
});

test("CASE-08 marks the video failed when a planned MG effect fails", async ({ page }) => {
  const workspace = await openCase(page, "case-08-mg-failed-project-ready");
  const failure = workspace.getByRole("alert");
  await expect(failure.getByText("第 2 镜动效未能完成", { exact: false })).toBeVisible();
  await expect(failure.getByRole("button", { name: /重试生成/ })).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
});
