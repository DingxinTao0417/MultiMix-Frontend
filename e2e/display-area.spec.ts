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
  await expect(workspace.getByText("基于 3 段兜底素材生成", { exact: false })).toBeVisible();
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
  await expect(workspace.getByLabel("视频工程预览")).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
  await expect(workspace.locator("video")).toHaveCount(0);
});

test("CASE-07 loads a real MP4 and seeks by segment", async ({ page }) => {
  test.setTimeout(60_000);
  const workspace = await openCase(page, "case-07-project-ready-mp4");
  const video = workspace.locator("video").first();
  const segmentList = workspace.locator(".shadcn-prototype-segment-cards > ol");
  await expect(video).toBeVisible();
  await expect(segmentList).toHaveCSS("overflow-y", "auto");
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  await workspace.getByRole("button", { name: /分镜 2|服务过程/ }).click();
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(2.5);
});

test("CASE-08 keeps the project editable when MG fails", async ({ page }) => {
  const workspace = await openCase(page, "case-08-mg-failed-project-ready");
  await expect(workspace.getByText("MG 渲染失败", { exact: false }).first()).toBeVisible();
  await expect(workspace.getByText("原分镜仍保留", { exact: false }).first()).toBeVisible();
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
});
