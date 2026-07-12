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

async function expectProportionalFramelessSurface(page: Page, surface: ReturnType<Page["locator"]>, expectedRatio: number) {
  await expect(surface).toBeVisible();
  await expect(surface).toHaveCSS("border-top-width", "0px");
  await expect(surface).toHaveCSS("border-right-width", "0px");
  await expect(surface).toHaveCSS("border-bottom-width", "0px");
  await expect(surface).toHaveCSS("border-left-width", "0px");
  await expect(surface).toHaveCSS("box-shadow", "none");

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

test("CASE-01 shows a director draft without project controls", async ({ page }) => {
  const workspace = await openCase(page, "case-01-director-draft");
  await expect(workspace.locator("article.shadcn-prototype-copy-document")).toBeVisible();
  await expect(workspace.getByLabel("视频工程预览")).toHaveCount(0);
  await expect(workspace.getByLabel("分镜摘要")).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "导出视频", exact: true })).toHaveCount(0);
});

test("CASE-02 shows the saved asset reference", async ({ page }) => {
  const workspace = await openCase(page, "case-02-saved-asset-match");
  await expect(workspace.getByText("测试门店素材", { exact: false }).first()).toBeVisible();
});

test("CASE-03 tells public fallback apart from saved assets", async ({ page }) => {
  const workspace = await openCase(page, "case-03-no-asset-hit");
  await expect(workspace.getByText("未命中素材", { exact: false }).first()).toBeVisible();
  await expect(workspace.getByText("基于 3 个公共素材生成", { exact: false })).toBeVisible();
  await expect(workspace.getByText("测试门店素材", { exact: false })).toHaveCount(0);
});

test("CASE-04 stays in progress after reload", async ({ page }) => {
  const workspace = await openCase(page, "case-04-project-running");
  await expect(workspace.getByText("视频工程生成中", { exact: false }).first()).toBeVisible();
  await page.reload();
  await expect(workspace.getByText("视频工程生成中", { exact: false }).first()).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
});

test("CASE-05 shows its stable failure and retry", async ({ page }) => {
  const workspace = await openCase(page, "case-05-project-failed");
  const failure = workspace.getByRole("alert");
  await expect(failure.getByText("素材合成步骤失败", { exact: false })).toBeVisible();
  await expect(failure.getByRole("button", { name: /重试生成/ })).toBeVisible();
});

test("CASE-06 is editable but has no video element", async ({ page }) => {
  const workspace = await openCase(page, "case-06-project-ready-no-mp4");
  await expect(workspace.getByLabel("轻量分镜预览")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await expect(workspace.locator("video")).toHaveCount(0);
  await expectProportionalFramelessSurface(page, workspace.locator(".shadcn-prototype-project-preview-screen"), 16 / 9);
});

test("CASE-07 loads a real MP4 and seeks by segment", async ({ page }) => {
  test.setTimeout(60_000);
  const workspace = await openCase(page, "case-07-project-ready-mp4");
  const video = workspace.locator("video").first();
  const player = workspace.locator(".shadcn-prototype-preview-player");
  const segmentList = workspace.locator(".shadcn-prototype-segment-cards > ol");
  await expect(video).toBeVisible();
  await expect(video).toHaveCSS("object-fit", "contain");
  await expect(segmentList).toHaveCSS("overflow-y", "auto");
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  await workspace.getByRole("button", { name: /分镜 2|服务过程/ }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(2.5);
  await expectProportionalFramelessSurface(page, player, 16 / 9);
});

test("CASE-08 keeps the project editable when MG fails", async ({ page }) => {
  const workspace = await openCase(page, "case-08-mg-failed-project-ready");
  await expect(workspace.getByText("MG 渲染失败", { exact: false }).first()).toBeVisible();
  await expect(workspace.getByText("原分镜仍保留", { exact: false }).first()).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
});
