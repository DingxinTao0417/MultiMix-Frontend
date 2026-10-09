import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { AssetConversationResponse, ContentAsset, ContentAssetVersion } from "../lib/api";

const execFileAsync = promisify(execFile);

type SeedResult = {
  conversation_ids: Record<string, string>;
  asset_ids: Record<string, number>;
};

const seed = JSON.parse(process.env.DISPLAY_COVERAGE_SEED_JSON ?? "{}") as Partial<SeedResult>;
const desktopEvidenceDirectory = resolve(
  process.env.MULTIMIX_VISUAL_EVIDENCE_DIR ?? resolve(process.cwd(), "test-results/display-coverage/evidence"),
);

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

async function openCase(page: Page, caseId: string, expectProductWorkspace = true) {
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
  if (expectProductWorkspace) await expect(workspace).toBeVisible();
  return workspace;
}

test("narrow existing-project chat keeps header actions and send control inside the viewport", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-01-director-draft"];
  const assetId = seed.asset_ids?.["case-01-director-draft"];
  if (!conversationId || !assetId) throw new Error("Missing seeded CASE-01 project");
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const expectedMissingRequirements = message.location().url.endsWith(`/v1/assets/conversations/${conversationId}/requirements/current`)
      && message.text().includes("404");
    if (!expectedMissingRequirements) consoleErrors.push(message.text());
  });

  await page.route("**/v1/assets/conversations**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET"
      || (pathname !== "/v1/assets/conversations" && pathname !== `/v1/assets/conversations/${conversationId}`)) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as AssetConversationResponse | AssetConversationResponse[];
    for (const row of Array.isArray(payload) ? payload : [payload]) {
      if (row.id !== conversationId) continue;
      row.project_resource_summary = { sources: 1, historical_sources: 0, copies: 0, covers: 0, videos: 0 };
    }
    await route.fulfill({ response, json: payload });
  });

  for (const width of [320, 375, 390, 430, 520, 521, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/app/assets?conversation=${conversationId}&product=asset-${assetId}`);
    await expect(page).toHaveTitle("MultiMix");
    const chat = page.getByRole("region", { name: "Content generation conversation" });
    await expect(chat).toBeVisible();
    await expect(chat.getByText("确认视频方案")).toBeVisible();
    await expect(page.locator("[data-nextjs-dialog-overlay], .nextjs-dialog-overlay")).toHaveCount(0);
    const composer = chat.getByRole("textbox", { name: "输入对话内容" });
    await composer.fill("窄屏草稿，不发送");
    await expect(chat.getByRole("button", { name: /^项目资料/ })).toBeVisible();

    await mkdir(desktopEvidenceDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(desktopEvidenceDirectory, `narrow-existing-project-${width}x844.png`),
      animations: "disabled",
    });

    const controls = [
      ...(width <= 1180 ? [chat.getByRole("button", { name: "展开侧边栏" })] : []),
      chat.getByRole("button", { name: /^项目资料/ }),
      chat.getByRole("button", { name: "诊断", exact: true }),
      composer,
      chat.getByRole("button", { name: "发送", exact: true }),
    ];
    for (const control of controls) {
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box, `Missing control box at ${width}px`).not.toBeNull();
      if (box) {
        expect(box.x, `Control starts outside the ${width}px viewport`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `Control ends outside the ${width}px viewport`).toBeLessThanOrEqual(width);
      }
    }
    const titleBox = await chat.locator(".shadcn-prototype-chat-head > strong").boundingBox();
    expect(titleBox?.width, `Project title has too little readable space at ${width}px`).toBeGreaterThanOrEqual(120);
    if (width <= 520) {
      const actionsBox = await chat.locator(".shadcn-prototype-chat-head-actions").boundingBox();
      expect(actionsBox?.y, `Header actions should be below the title at ${width}px`).toBeGreaterThanOrEqual(
        (titleBox?.y ?? 0) + (titleBox?.height ?? 0),
      );
    }
    await expect(composer).toHaveValue("窄屏草稿，不发送");
  }
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("narrow pending video confirmation starts with its primary action unobscured", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-01-director-draft"];
  if (!conversationId) throw new Error("Missing seeded CASE-01 project");

  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`/app/assets?conversation=${conversationId}`);
    const button = page.getByRole("button", { name: "确认生成视频工程" });
    await expect(button).toBeVisible();
    await expect.poll(async () => button.evaluate((element) => {
      const thread = element.closest(".shadcn-prototype-thread");
      if (!thread) return false;
      const buttonBox = element.getBoundingClientRect();
      const threadBox = thread.getBoundingClientRect();
      const hit = document.elementFromPoint(buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2);
      return buttonBox.top >= threadBox.top
        && buttonBox.bottom <= threadBox.bottom
        && (hit === element || element.contains(hit));
    })).toBe(true);
  }
});

test("narrow new-project capability strip explains that more abilities can be viewed", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/app/assets");
  const capabilities = page.getByRole("region", { name: "可组合的视频制作能力" });
  await expect(capabilities.getByText("左右滑动查看更多")).toBeVisible();
  const widths = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("narrow project resources keep real saved-asset names readable", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-02-saved-asset-match"];
  const assetId = seed.asset_ids?.["case-02-saved-asset-match"];
  if (!conversationId || !assetId) throw new Error("Missing seeded CASE-02 project");

  for (const width of [320, 375, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/app/assets?conversation=${conversationId}&product=asset-${assetId}`);
    const resourcesButton = page.getByRole("region", { name: "Content generation conversation" })
      .getByRole("button", { name: /^项目资料/ });
    await expect(resourcesButton).toBeVisible();
    await resourcesButton.click();
    const drawer = page.getByRole("dialog", { name: /的项目资源/ });
    await expect(drawer).toBeVisible();
    const resourceName = drawer.getByRole("button", { name: "测试门店素材", exact: true });
    await expect(resourceName).toBeVisible();
    if (width <= 380) {
      const isNameUnclipped = await resourceName.evaluate((node) => node.scrollWidth <= node.clientWidth + 1);
      expect(isNameUnclipped, `Saved-asset name is visually clipped at ${width}px`).toBe(true);
      const nameBox = await resourceName.boundingBox();
      const actionsBox = await drawer.locator(".shadcn-prototype-project-resource-actions").first().boundingBox();
      expect(actionsBox?.y, `Resource actions should follow the name at ${width}px`).toBeGreaterThanOrEqual(
        (nameBox?.y ?? 0) + (nameBox?.height ?? 0),
      );
    }
    if (width <= 520) {
      const action = drawer.getByRole("button", { name: "用于本轮" });
      const actionBox = await action.boundingBox();
      expect(actionBox?.height, `Resource action is too small at ${width}px`).toBeGreaterThanOrEqual(44);
    }
    await mkdir(desktopEvidenceDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(desktopEvidenceDirectory, `project-resources-${width}x844.png`),
      animations: "disabled",
    });
    await drawer.getByRole("button", { name: "关闭项目资源" }).click();
    await expect(drawer).toBeHidden();
  }
});

test("project source opens exact detail and remains recoverable when it is the only historical source", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-02-saved-asset-match"];
  const assetId = seed.asset_ids?.["case-02-saved-asset-match"];
  if (!conversationId || !assetId) throw new Error("Missing seeded CASE-02 project");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/app/assets?conversation=${conversationId}&product=asset-${assetId}`);
  await expect(page).toHaveTitle("MultiMix");
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  const resourceEntry = chat.getByRole("button", { name: /^项目资料/ });
  await expect(resourceEntry).toBeVisible();
  await resourceEntry.click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "测试门店素材", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await expect(detail).toBeVisible();
  await expect(page.getByText(/正在为项目.*添加素材/)).toHaveCount(0);
  await mkdir(desktopEvidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "project-source-exact-detail-390.png"), animations: "disabled" });

  await page.goto(`/app/assets?conversation=${conversationId}&product=asset-${assetId}`);
  await expect(resourceEntry).toBeVisible();
  await resourceEntry.click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: "移出项目", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "将素材移出项目？" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "移出项目", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "重新加入项目" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭项目资源" }).click();
  await page.reload();
  await expect(resourceEntry).toBeVisible();
  await resourceEntry.click();
  await expect(drawer.getByRole("button", { name: "素材 1" })).toBeVisible();
  await expect(drawer.getByText("已移出或从资源库归档的资料仍保留历史引用；仅可用的已移出资料可重新加入。")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "重新加入项目" })).toBeVisible();
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "project-source-historical-only-390.png"), animations: "disabled" });
  await drawer.getByRole("button", { name: "重新加入项目" }).click();
  await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭项目资源" }).click();

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.reload();
  await expect(resourceEntry).toBeVisible();
  await resourceEntry.click();
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "project-source-restored-1280.png"), animations: "disabled" });
  expect(pageErrors).toEqual([]);
});

test("saved source removal remains acknowledged when project detail refresh fails", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-02-saved-asset-match"];
  const sourceId = seed.asset_ids?.["case-02-saved-asset-match"];
  if (!projectId || !sourceId) throw new Error("Missing seeded CASE-02 project");

  await page.goto(`/app/assets?conversation=${projectId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  let failedDetailReads = 0;
  await page.route(`**/v1/assets/conversations/${projectId}?*`, async (route) => {
    if (route.request().method() === "GET" && failedDetailReads < 2) {
      failedDetailReads += 1;
      await route.fulfill({ status: 503, json: { detail: "Temporary read failure" } });
      return;
    }
    await route.continue();
  });

  await drawer.getByRole("button", { name: "移出项目", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "将素材移出项目？" });
  await confirmation.getByRole("button", { name: "移出项目", exact: true }).click();
  await expect(page.getByText("已移出项目并保存，但资料暂未同步。请重试加载。", { exact: true })).toBeVisible();
  await expect(confirmation).toBeHidden();
  await expect(drawer).toBeHidden();
  await expect(chat.getByRole("button", { name: "重试加载" })).toBeVisible();
  await expect(chat.getByRole("button", { name: /^项目资料/ })).toBeVisible();
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  await expect(drawer.getByRole("button", { name: "重新加入项目" })).toBeVisible();
  await drawer.getByRole("button", { name: "关闭项目资源" }).click();
  expect(failedDetailReads).toBe(2);

  await chat.getByRole("button", { name: "重试加载" }).click();
  await expect(chat.getByRole("button", { name: "重试加载" })).toBeHidden();
  await expect(chat.getByRole("button", { name: /^项目资料/ })).toBeVisible();
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  await expect(drawer.getByRole("button", { name: "重新加入项目" })).toBeVisible();
  await drawer.getByRole("button", { name: "重新加入项目" }).click();
  await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
});

test("project resources remain accessible when conversation detail and snapshot reads fail", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-02-saved-asset-match"];
  if (!projectId) throw new Error("Missing seeded CASE-02 project");
  await page.route("**/v1/assets/conversations/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === "GET" && (
      pathname === `/v1/assets/conversations/${projectId}`
      || pathname === `/v1/assets/conversations/${projectId}/snapshot`
    )) {
      await route.fulfill({ status: 503, json: { detail: "Temporary detail failure" } });
      return;
    }
    await route.continue();
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/app/assets?conversation=${projectId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await expect(chat.getByText("对话内容加载失败。")).toBeVisible();
  const entry = chat.getByRole("button", { name: "项目资料，共 1 项" });
  await expect(entry).toBeVisible();
  await entry.click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "用于本轮" })).toHaveCount(0);
  await mkdir(desktopEvidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "detail-error-resources-1280x720.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "用于本轮" })).toHaveCount(0);
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "detail-error-resources-390x844.png"), animations: "disabled" });
});

test("retrying a failed conversation also recovers its independent resource summary", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-02-saved-asset-match"];
  if (!projectId) throw new Error("Missing seeded CASE-02 project");
  let summaryShouldFail = true;
  let summaryReads = 0;
  await page.route("**/v1/assets/conversations/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (pathname === `/v1/assets/conversations/${projectId}/resources/summary`) {
      summaryReads += 1;
      if (summaryShouldFail) {
        await route.fulfill({ status: 503, json: { detail: "Temporary summary failure" } });
        return;
      }
    } else if (pathname === `/v1/assets/conversations/${projectId}`
      || pathname === `/v1/assets/conversations/${projectId}/snapshot`) {
      await route.fulfill({ status: 503, json: { detail: "Temporary detail failure" } });
      return;
    }
    await route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/app/assets?conversation=${projectId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await expect(chat.getByText("对话内容加载失败。")).toBeVisible();
  await expect.poll(() => summaryReads).toBeGreaterThan(0);
  await expect(chat.getByRole("button", { name: /^项目资料/ })).toHaveCount(0);
  const initialSummaryReads = summaryReads;
  summaryShouldFail = false;
  await chat.getByRole("button", { name: "重试加载" }).click();
  await expect.poll(() => summaryReads).toBeGreaterThan(initialSummaryReads);
  await expect(chat.getByRole("button", { name: "项目资料，共 1 项" })).toBeVisible();
  await chat.getByRole("button", { name: "项目资料，共 1 项" }).click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  await mkdir(desktopEvidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "summary-retry-detail-error-1280x720.png"), animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "summary-retry-detail-error-390x844.png"), animations: "disabled" });
});

test("saved source removal is not reported as failed when requirement refresh fails", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-02-saved-asset-match"];
  const sourceId = seed.asset_ids?.["case-02-saved-asset-match"];
  if (!projectId || !sourceId) throw new Error("Missing seeded CASE-02 project");

  let sourceWriteStarted = false;
  await page.route(`**/v1/assets/conversations/${projectId}*`, async (route) => {
    const isProjectDetail = new URL(route.request().url()).pathname === `/v1/assets/conversations/${projectId}`;
    if (route.request().method() !== "GET" || !isProjectDetail || sourceWriteStarted) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as AssetConversationResponse;
    payload.updated_at = new Date(Date.now() - 120_000).toISOString();
    await route.fulfill({ response, json: payload });
  });
  await page.goto(`/app/assets?conversation=${projectId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  if (await drawer.getByRole("button", { name: "重新加入项目" }).count()) {
    await drawer.getByRole("button", { name: "重新加入项目" }).click();
    await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
  }
  let membershipWrites = 0;
  await page.route(`**/v1/assets/conversations/${projectId}/sources/*`, async (route) => {
    if (route.request().method() === "PUT" || route.request().method() === "DELETE") membershipWrites += 1;
    await route.continue();
  });
  const requirementsUrl = `**/v1/assets/conversations/${projectId}/requirements/current`;
  let requirementReads = 0;
  let retryWrites = 0;
  let failRequirements = true;
  await page.route(requirementsUrl, async (route) => {
    requirementReads += 1;
    if (failRequirements) await route.fulfill({ status: 503, json: { detail: "Temporary read failure" } });
    else await route.continue();
  });
  await page.route(`**/v1/assets/conversations/${projectId}/requirements/analyze`, async (route) => {
    if (route.request().method() === "POST") retryWrites += 1;
    await route.continue();
  });

  await drawer.getByRole("button", { name: "移出项目", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "将素材移出项目？" });
  sourceWriteStarted = true;
  await confirmation.getByRole("button", { name: "移出项目", exact: true }).click();
  await expect(page.getByText("已移出项目并保存，但需求理解暂未同步。", { exact: true })).toBeVisible();
  await expect(confirmation).toBeHidden();
  await expect(drawer.getByRole("button", { name: "重新加入项目" })).toBeVisible();
  await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeVisible();
  expect(membershipWrites).toBe(1);
  expect(requirementReads).toBe(1);
  failRequirements = false;
  const retryRead = page.waitForResponse((response) => response.url().endsWith(`/v1/assets/conversations/${projectId}/requirements/current`)
    && response.request().method() === "GET");
  await drawer.getByRole("button", { name: "重新同步需求" }).click();
  expect((await retryRead).status()).toBe(404);
  await expect(page.getByText("需求分析仍未成功，已保留上一版内容；可稍后重试。", { exact: true })).toBeVisible();
  await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeVisible();
  expect(membershipWrites).toBe(1);
  expect(retryWrites).toBe(1);
  expect(requirementReads).toBe(3);
  await drawer.getByRole("button", { name: "重新加入项目" }).click();
  await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
  const readsAfterReadd = requirementReads;
  await drawer.getByRole("button", { name: "关闭项目资源" }).click();
  const otherProjectId = seed.conversation_ids?.["case-01-director-draft"];
  if (!otherProjectId) throw new Error("Missing seeded CASE-01 project");
  const otherProjectLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${otherProjectId}"]`);
  if (await otherProjectLink.count() === 0) await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await otherProjectLink.click();
  await expect(otherProjectLink).toHaveAttribute("aria-current", "page");
  const projectLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${projectId}"]`);
  if (await projectLink.count() === 0) await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await projectLink.click();
  await expect(projectLink).toHaveAttribute("aria-current", "page");
  await expect.poll(() => requirementReads).toBe(readsAfterReadd + 1);
});

test("an obsolete requirement retry cannot report success after another source change", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-02-saved-asset-match"];
  if (!projectId) throw new Error("Missing seeded CASE-02 project");

  await page.goto(`/app/assets?conversation=${projectId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  if (await drawer.getByRole("button", { name: "重新加入项目" }).count()) {
    await drawer.getByRole("button", { name: "重新加入项目" }).click();
    await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
  }

  let releaseObsoleteRead: (() => void) | undefined;
  const obsoleteReadGate = new Promise<void>((resolve) => { releaseObsoleteRead = resolve; });
  const requirementsUrl = `**/v1/assets/conversations/${projectId}/requirements/current`;
  let requirementReads = 0;
  await page.route(requirementsUrl, async (route) => {
    requirementReads += 1;
    if (requirementReads === 2) {
      await obsoleteReadGate;
      await route.fulfill({ status: 200, json: {
        id: "superseded-retry-snapshot",
        conversation_id: projectId,
        version: 1,
        parent_snapshot_id: null,
        status: "ready",
        trigger_kind: "manual_refresh",
        conversation_text: "过期重试结果",
        conversation_media: [],
        payload: null,
        error_code: null,
        error_message: null,
        created_at: "2026-09-12T08:00:00Z",
        completed_at: "2026-09-12T08:00:01Z",
      } });
      return;
    }
    await route.fulfill({ status: 503, json: { detail: "Temporary read failure" } });
  });

  try {
    await drawer.getByRole("button", { name: "移出项目", exact: true }).click();
    await page.getByRole("dialog", { name: "将素材移出项目？" }).getByRole("button", { name: "移出项目", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "重新加入项目" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "重新同步需求" })).toBeVisible();
    expect(requirementReads).toBe(1);

    await drawer.getByRole("button", { name: "重新同步需求" }).click();
    await expect.poll(() => requirementReads).toBe(2);
    await drawer.getByRole("button", { name: "重新加入项目" }).click();
    await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
    expect(requirementReads).toBe(3);

    const obsoleteResponse = page.waitForResponse((response) => response.url().endsWith(`/v1/assets/conversations/${projectId}/requirements/current`)
      && response.status() === 200);
    await page.evaluate(() => {
      const observedWindow = window as Window & { __requirementSuccessNotices?: number };
      observedWindow.__requirementSuccessNotices = 0;
      const observer = new MutationObserver(() => {
        if (document.body.textContent?.includes("需求理解已同步。")) observedWindow.__requirementSuccessNotices! += 1;
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    releaseObsoleteRead?.();
    await obsoleteResponse;
    await expect(drawer.getByRole("button", { name: "重新同步需求" })).toBeEnabled();
    await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as Window & { __requirementSuccessNotices?: number }).__requirementSuccessNotices)).toBe(0);
  } finally {
    releaseObsoleteRead?.();
  }
});

test("a requirement read started before source removal cannot restore an obsolete snapshot", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-02-saved-asset-match"];
  const otherProjectId = seed.conversation_ids?.["case-01-director-draft"];
  if (!projectId || !otherProjectId) throw new Error("Missing seeded projects");

  const initialRequirementRead = page.waitForResponse((response) => response.url().endsWith(`/v1/assets/conversations/${projectId}/requirements/current`)
    && response.request().method() === "GET");
  await page.goto(`/app/assets?conversation=${projectId}`);
  await initialRequirementRead;
  const otherProjectLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${otherProjectId}"]`);
  if (await otherProjectLink.count() === 0) await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await otherProjectLink.click();
  await expect(otherProjectLink).toHaveAttribute("aria-current", "page");

  let releaseOldRead: (() => void) | undefined;
  const oldReadGate = new Promise<void>((resolve) => { releaseOldRead = resolve; });
  const requirementsUrl = `**/v1/assets/conversations/${projectId}/requirements/current`;
  let requirementReads = 0;
  await page.route(requirementsUrl, async (route) => {
    requirementReads += 1;
    if (requirementReads !== 1) {
      await route.continue();
      return;
    }
    await oldReadGate;
    await route.fulfill({ status: 200, json: {
      id: "obsolete-requirement-snapshot",
      conversation_id: projectId,
      version: 1,
      parent_snapshot_id: null,
      status: "ready",
      trigger_kind: "source_added",
      conversation_text: "过期需求不应重新出现",
      conversation_media: [],
      payload: {
        schema_version: "project_requirement_snapshot_v1",
        summary: "过期需求不应重新出现",
        goal: "旧目标",
        audience: "旧受众",
        intent: { operation: "supplement", scope: "project_default", target_item_ids: [], replacement_source_asset_id: null },
        deliverables: [], facts: [], requirements: [], asset_usages: [], conflicts: [], source_asset_ids: [],
        diff: { added_item_ids: [], removed_item_ids: [], changed_item_ids: [], new_conflict_ids: [], resolved_conflict_ids: [], usage_changed_asset_ids: [] },
      },
      error_code: null,
      error_message: null,
      created_at: "2026-09-12T08:00:00Z",
      completed_at: "2026-09-12T08:00:01Z",
    } });
  });

  try {
    const projectLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${projectId}"]`);
    if (await projectLink.count() === 0) await page.getByRole("button", { name: "查看全部", exact: true }).click();
    await projectLink.click();
    await expect(projectLink).toHaveAttribute("aria-current", "page");
    await expect.poll(() => requirementReads).toBe(1);
    const chat = page.getByRole("region", { name: "Content generation conversation" });
    await chat.getByRole("button", { name: /^项目资料/ }).click();
    const drawer = page.getByRole("dialog", { name: /的项目资源/ });
    await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
    if (await drawer.getByRole("button", { name: "重新加入项目" }).count()) {
      await drawer.getByRole("button", { name: "重新加入项目" }).click();
      await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
    }
    await drawer.getByRole("button", { name: "移出项目", exact: true }).click();
    await page.getByRole("dialog", { name: "将素材移出项目？" }).getByRole("button", { name: "移出项目", exact: true }).click();
    await expect(drawer.getByRole("button", { name: "重新加入项目" })).toBeVisible();
    const oldReadResponse = page.waitForResponse((response) => response.url().endsWith(`/v1/assets/conversations/${projectId}/requirements/current`)
      && response.status() === 200);
    releaseOldRead?.();
    await oldReadResponse;
    await expect(chat.getByText("过期需求不应重新出现", { exact: true })).toHaveCount(0);
    await drawer.getByRole("button", { name: "重新加入项目" }).click();
    await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
  } finally {
    releaseOldRead?.();
  }
});

test("library source addition refreshes requirements even when the project time label stays the same", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-01-director-draft"];
  if (!projectId) throw new Error("Missing seeded CASE-01 project");

  const fixedUpdatedAt = new Date().toISOString();
  await page.route("**/v1/assets/conversations**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET"
      || (pathname !== "/v1/assets/conversations" && pathname !== `/v1/assets/conversations/${projectId}`)) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as AssetConversationResponse | AssetConversationResponse[];
    for (const row of Array.isArray(payload) ? payload : [payload]) {
      if (row.id === projectId) row.updated_at = fixedUpdatedAt;
    }
    await route.fulfill({ response, json: payload });
  });

  let sourceWriteCompleted = false;
  let postWriteRequirementReads = 0;
  await page.route(`**/v1/assets/conversations/${projectId}/sources/*`, async (route) => {
    if (route.request().method() !== "PUT") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    sourceWriteCompleted = response.ok();
    await route.fulfill({ response });
  });
  await page.route(`**/v1/assets/conversations/${projectId}/requirements/current`, async (route) => {
    if (!sourceWriteCompleted || route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    postWriteRequirementReads += 1;
    await route.fulfill({ status: 200, json: {
      id: "new-library-source-requirements",
      conversation_id: projectId,
      version: 2,
      parent_snapshot_id: null,
      status: "ready",
      latest_analysis_version: 2,
      latest_analysis_status: "ready",
      trigger_kind: "source_added",
      conversation_text: "已纳入新加入的门店素材",
      conversation_media: [],
      payload: null,
      error_code: null,
      error_message: null,
      created_at: fixedUpdatedAt,
      completed_at: fixedUpdatedAt,
    } });
  });

  await page.goto(`/app/assets?conversation=${projectId}`);
  await expect(page.getByRole("region", { name: "Content generation conversation" })).toBeVisible();
  await page.getByRole("button", { name: "图片库", exact: true }).click();
  await page.getByLabel("图片库列表").getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.getByRole("button", { name: "加入项目…" }).click();
  const picker = page.getByRole("dialog", { name: "选择目标项目" });
  await picker.getByRole("button", { name: /^CASE-01 普通编导稿，/ }).click();

  await expect(page.getByText("已加入项目，并立即保存。", { exact: true })).toBeVisible();
  expect(sourceWriteCompleted).toBe(true);
  await expect.poll(() => postWriteRequirementReads).toBeGreaterThanOrEqual(1);
  await detail.getByRole("button", { name: "关闭详情" }).click();
  const projectLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${projectId}"]`);
  if (await projectLink.count() === 0) await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await projectLink.click();
  await expect(page.getByRole("region", { name: "Content generation conversation" })
    .getByText("已纳入新加入的门店素材", { exact: true })).toBeVisible();
});

test("library source addition keeps the saved membership when requirement refresh fails", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-01-director-draft"];
  if (!projectId) throw new Error("Missing seeded CASE-01 project");

  let sourceWrites = 0;
  let failRequirementRead = true;
  let postWriteRequirementReads = 0;
  await page.route(`**/v1/assets/conversations/${projectId}/sources/*`, async (route) => {
    if (route.request().method() === "PUT") sourceWrites += 1;
    await route.continue();
  });
  await page.route(`**/v1/assets/conversations/${projectId}/requirements/current`, async (route) => {
    if (route.request().method() !== "GET" || sourceWrites === 0) {
      await route.continue();
      return;
    }
    postWriteRequirementReads += 1;
    if (failRequirementRead) {
      await route.fulfill({ status: 503, json: { detail: "Temporary requirement read failure" } });
      return;
    }
    await route.fulfill({ status: 200, json: {
      id: "recovered-library-source-requirements",
      conversation_id: projectId,
      version: 2,
      parent_snapshot_id: null,
      status: "ready",
      latest_analysis_version: 2,
      latest_analysis_status: "ready",
      trigger_kind: "source_added",
      conversation_text: "需求理解已恢复",
      conversation_media: [],
      payload: null,
      error_code: null,
      error_message: null,
      created_at: "2026-10-01T08:00:00Z",
      completed_at: "2026-10-01T08:00:01Z",
    } });
  });

  await page.goto("/app/assets");
  await page.getByRole("button", { name: "图片库", exact: true }).click();
  await page.getByLabel("图片库列表").getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.getByRole("button", { name: "加入项目…" }).click();
  await page.getByRole("dialog", { name: "选择目标项目" })
    .getByRole("button", { name: /^CASE-01 普通编导稿，/ }).click();

  await expect(page.getByText("已加入项目并保存，但需求理解暂未同步。", { exact: true })).toBeVisible();
  expect(sourceWrites).toBe(1);
  expect(postWriteRequirementReads).toBeGreaterThanOrEqual(1);
  await detail.getByRole("button", { name: "关闭详情" }).click();
  const projectLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${projectId}"]`);
  if (await projectLink.count() === 0) await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await projectLink.click();
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeVisible();

  failRequirementRead = false;
  await drawer.getByRole("button", { name: "重新同步需求" }).click();
  await expect(page.getByText("需求理解已同步。", { exact: true })).toBeVisible();
  await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeHidden();
  expect(sourceWrites).toBe(1);
});

test("new source analysis failure keeps the older requirement visibly out of date", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-01-director-draft"];
  if (!projectId) throw new Error("Missing seeded CASE-01 project");
  let sourceWritten = false;
  let analysisRecovered = false;
  let latestAnalysisVersion = 2;
  let retryAttempts = 0;
  await page.route(`**/v1/assets/conversations/${projectId}/sources/*`, async (route) => {
    const response = await route.fetch();
    if (route.request().method() === "PUT") sourceWritten = response.ok();
    await route.fulfill({ response });
  });
  await page.route(`**/v1/assets/conversations/${projectId}/requirements/current`, async (route) => {
    if (!sourceWritten || route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, json: {
      id: analysisRecovered ? "recovered-snapshot" : "previous-stable-snapshot",
      conversation_id: projectId,
      version: analysisRecovered ? latestAnalysisVersion : 1,
      parent_snapshot_id: null,
      status: "ready",
      latest_analysis_version: latestAnalysisVersion,
      latest_analysis_status: analysisRecovered ? "ready" : "failed",
      trigger_kind: "source_added",
      conversation_text: "上一版项目需求",
      conversation_media: [],
      payload: null,
      error_code: null,
      error_message: null,
      created_at: "2026-10-02T08:00:00Z",
      completed_at: "2026-10-02T08:00:01Z",
    } });
  });
  await page.route(`**/v1/assets/conversations/${projectId}/requirements/versions`, async (route) => {
    await route.fulfill({ status: 200, json: [{
      id: `failed-snapshot-${latestAnalysisVersion}`,
      conversation_id: projectId,
      version: latestAnalysisVersion,
      parent_snapshot_id: null,
      status: "failed",
      trigger_kind: "source_added",
      conversation_text: "需求分析失败，请重试。",
      conversation_media: [],
      payload: null,
      error_code: "RuntimeError",
      error_message: "需求分析失败，请重试。",
      created_at: "2026-10-02T08:00:00Z",
      completed_at: "2026-10-02T08:00:01Z",
    }] });
  });
  await page.route(`**/v1/assets/conversations/${projectId}/requirements/analyze`, async (route) => {
    const body = route.request().postDataJSON() as { retry_failed_snapshot_id?: string };
    expect(body.retry_failed_snapshot_id).toBe(`failed-snapshot-${latestAnalysisVersion}`);
    retryAttempts += 1;
    latestAnalysisVersion += 1;
    analysisRecovered = retryAttempts === 2;
    await route.fulfill({ status: 200, json: {
      id: analysisRecovered ? "recovered-snapshot" : `failed-snapshot-${latestAnalysisVersion}`,
      conversation_id: projectId,
      version: latestAnalysisVersion,
      parent_snapshot_id: body.retry_failed_snapshot_id,
      status: analysisRecovered ? "ready" : "failed",
      trigger_kind: "manual_refresh",
      conversation_text: analysisRecovered ? "需求理解已恢复" : "需求分析失败，请重试。",
      conversation_media: [],
      payload: null,
      error_code: analysisRecovered ? null : "RuntimeError",
      error_message: analysisRecovered ? null : "需求分析失败，请重试。",
      created_at: "2026-10-02T08:00:00Z",
      completed_at: "2026-10-02T08:00:01Z",
    } });
  });

  await page.goto("/app/assets");
  await page.getByRole("button", { name: "图片库", exact: true }).click();
  await page.getByLabel("图片库列表").getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.getByRole("button", { name: "加入项目…" }).click();
  await page.getByRole("dialog", { name: "选择目标项目" })
    .getByRole("button", { name: /^CASE-01 普通编导稿，/ }).click();
  await expect(page.getByText("已加入项目并保存，但新资料尚未计入需求理解；当前显示上一版内容。", { exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "关闭详情" }).click();
  const projectLink = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${projectId}"]`);
  if (await projectLink.count() === 0) await page.getByRole("button", { name: "查看全部", exact: true }).click();
  await projectLink.click();
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "重新同步需求" }).click();
  await expect(page.getByText("需求分析仍未成功，已保留上一版内容；可稍后重试。", { exact: true })).toBeVisible();
  await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeVisible();
  expect(retryAttempts).toBe(1);
  await drawer.getByRole("button", { name: "重新同步需求" }).click();
  await expect(page.getByText("需求理解已同步。", { exact: true })).toBeVisible();
  await expect(drawer.getByText("需求理解暂未同步，不影响已保存的项目资料。", { exact: true })).toBeHidden();
  expect(retryAttempts).toBe(2);
});

test("library source addition remains acknowledged when target project detail refresh fails", async ({ page }) => {
  const projectId = seed.conversation_ids?.["case-01-director-draft"];
  if (!projectId) throw new Error("Missing seeded CASE-01 project");

  await page.goto("/app/assets");
  await page.getByRole("button", { name: "图片库", exact: true }).click();
  await page.getByLabel("图片库列表").getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.getByRole("button", { name: "加入项目…" }).click();
  const picker = page.getByRole("dialog", { name: "选择目标项目" });
  await expect(picker).toBeVisible();
  let failedDetailReads = 0;
  await page.route(`**/v1/assets/conversations/${projectId}?*`, async (route) => {
    if (route.request().method() === "GET" && failedDetailReads < 2) {
      failedDetailReads += 1;
      await route.fulfill({ status: 503, json: { detail: "Temporary read failure" } });
      return;
    }
    await route.continue();
  });

  await picker.getByRole("button", { name: /^CASE-01 普通编导稿，/ }).click();
  await expect(page.getByText("已加入项目并保存，但资料暂未同步。进入该项目后可重试加载。", { exact: true })).toBeVisible();
  await expect(picker).toBeHidden();
  expect(failedDetailReads).toBe(2);
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await page.goto(`/app/assets?conversation=${projectId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await chat.getByRole("button", { name: /^项目资料/ }).click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "移出项目", exact: true })).toBeVisible();
});

test("archived project source stays traceable and opens read-only history detail", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-02-saved-asset-match"];
  const assetId = seed.asset_ids?.["case-02-saved-asset-match"];
  if (!conversationId || !assetId) throw new Error("Missing seeded CASE-02 project");

  await page.route(`**/v1/assets/detail/${assetId}`, async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as { asset: ContentAsset };
    payload.asset.title = "测试门店素材";
    payload.asset.asset_kind = "image";
    payload.asset.content_type = "uploaded_image";
    payload.asset.archived = true;
    payload.asset.status = "archived";
    await route.fulfill({ response, json: payload });
  });

  await page.route("**/v1/assets/conversations**", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (requestUrl.pathname === `/v1/assets/conversations/${conversationId}/resources`) {
      await route.fulfill({ json: {
        items: [{
          id: assetId,
          title: "测试门店素材",
          kind: "source",
          membership_state: "unavailable",
          historical_reference_count: 1,
          status: "archived",
          readd_status: "archived",
          asset_kind: "image",
          content_type: "uploaded_image",
          source_type: "upload",
          updated_at: "2026-09-30T00:00:00Z",
        }],
        total: 1,
        offset: 0,
        limit: 20,
      } });
      return;
    }
    if (requestUrl.pathname !== `/v1/assets/conversations/${conversationId}`) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as AssetConversationResponse;
    payload.project_resource_summary = { sources: 0, historical_sources: 1, copies: 0, covers: 0, videos: 0 };
    await route.fulfill({ response, json: payload });
  });

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/app/assets?conversation=${conversationId}&product=asset-${assetId}`);
    const chat = page.getByRole("region", { name: "Content generation conversation" });
    await chat.getByRole("button", { name: /^项目资料/ }).click();
    const drawer = page.getByRole("dialog", { name: /的项目资源/ });
    await expect(drawer.getByRole("button", { name: "测试门店素材", exact: true })).toBeVisible();
    await expect(drawer.getByText("源文件已从资源库归档，暂不能用于后续创作")).toBeVisible();
    await expect(drawer.getByRole("button", { name: "重新加入项目" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "移出项目" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "永久删除源文件" })).toHaveCount(0);
    await mkdir(desktopEvidenceDirectory, { recursive: true });
    await page.screenshot({
      path: resolve(desktopEvidenceDirectory, `project-source-archived-history-${width}.png`),
      animations: "disabled",
    });
    await drawer.getByRole("button", { name: "测试门店素材", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
    await expect(detail.getByText(/仅可查看历史内容/)).toBeVisible();
    await expect(detail.getByText(/归档前未完成素材理解/)).toBeVisible();
    await expect(detail.getByText(/等待开始素材理解/)).toHaveCount(0);
    for (const action of ["用于创作", "加入项目…", "重新解析素材", "下载", "删除"]) {
      await expect(detail.getByRole("button", { name: action })).toHaveCount(0);
    }
    await page.screenshot({
      path: resolve(desktopEvidenceDirectory, `project-source-archived-detail-${width}.png`),
      animations: "disabled",
    });
  }
});

test("archiving the only project source in the library refreshes project history without a page reload", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-02-saved-asset-match"];
  if (!conversationId) throw new Error("Missing seeded CASE-02 project");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/app/assets?conversation=${conversationId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  const resourceEntry = chat.getByRole("button", { name: /^项目资料/ });
  const initialPagePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/v1/assets/conversations/${conversationId}/resources`
  ));
  await resourceEntry.click();
  const initialPage = await initialPagePromise;
  const initialResources = await initialPage.json() as { items: Array<Record<string, unknown>> };
  const source = initialResources.items.find((item) => item.kind === "source");
  if (!source || typeof source.id !== "number") throw new Error("Missing seeded project source");
  const sourceId = source.id;
  await page.getByRole("dialog", { name: /的项目资源/ }).getByRole("button", { name: "关闭项目资源" }).click();

  let archived = false;
  await page.route(`**/v1/assets/${sourceId}?mode=archive`, async (route) => {
    archived = true;
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/v1/assets?**", async (route) => {
    const response = await route.fetch();
    const assets = await response.json() as Array<{ id: number }>;
    await route.fulfill({ response, json: archived ? assets.filter((asset) => asset.id !== sourceId) : assets });
  });
  await page.route("**/v1/assets/conversations/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!archived || route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (pathname === `/v1/assets/conversations/${conversationId}/resources`) {
      await route.fulfill({ json: { items: [{ ...source, membership_state: "unavailable", readd_status: "archived", status: "archived" }], total: 1, offset: 0, limit: 20 } });
      return;
    }
    if (pathname === `/v1/assets/conversations/${conversationId}`) {
      const response = await route.fetch();
      const payload = await response.json() as AssetConversationResponse;
      payload.project_resource_summary = { ...payload.project_resource_summary!, sources: 0, historical_sources: 1 };
      await route.fulfill({ response, json: payload });
      return;
    }
    await route.continue();
  });

  await page.getByRole("navigation", { name: "资源库" }).getByRole("button", { name: "图片库" }).click();
  const imageGrid = page.getByLabel("图片库列表");
  await imageGrid.getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.locator('summary[aria-label="更多操作"]').click();
  await detail.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog", { name: "删除「测试门店素材」？" }).getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("已删除。", { exact: true })).toBeVisible();
  await page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`).click();
  await expect(resourceEntry).toBeVisible();
  await resourceEntry.click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "素材 1" })).toBeVisible();
  await expect(drawer.getByText("源文件已从资源库归档，暂不能用于后续创作")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "移出项目" })).toHaveCount(0);
  await mkdir(desktopEvidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "project-source-archived-same-session-1280.png"), animations: "disabled" });
  await page.reload();
  await resourceEntry.click();
  await expect(drawer.getByRole("button", { name: "素材 1" })).toBeVisible();
  await expect(drawer.getByText("源文件已从资源库归档，暂不能用于后续创作")).toBeVisible();
});

test("project detail can retry after the library archive refresh fails once", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-02-saved-asset-match"];
  if (!conversationId) throw new Error("Missing seeded CASE-02 project");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/app/assets?conversation=${conversationId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  const resourceEntry = chat.getByRole("button", { name: /^项目资料/ });
  await expect(resourceEntry).toBeVisible();
  const initialPagePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/v1/assets/conversations/${conversationId}/resources`
  ));
  await resourceEntry.click();
  const initialResources = await (await initialPagePromise).json() as { items: Array<Record<string, unknown>> };
  const source = initialResources.items.find((item) => item.kind === "source");
  if (!source || typeof source.id !== "number") throw new Error("Missing seeded project source");
  const sourceId = source.id;
  await page.getByRole("dialog", { name: /的项目资源/ }).getByRole("button", { name: "关闭项目资源" }).click();

  let archived = false;
  let failedAttempts = 0;
  await page.route(`**/v1/assets/${sourceId}?mode=archive`, async (route) => {
    archived = true;
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route(`**/v1/assets/conversations/${conversationId}?*`, async (route) => {
    if (!archived || route.request().method() !== "GET") {
      await route.continue();
      return;
    }
    if (failedAttempts < 2) {
      failedAttempts += 1;
      await route.fulfill({ status: 503, json: { detail: "temporary test failure" } });
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as AssetConversationResponse;
    payload.project_resource_summary = { ...payload.project_resource_summary!, sources: 0, historical_sources: 1 };
    await route.fulfill({ response, json: payload });
  });

  await page.getByRole("navigation", { name: "资源库" }).getByRole("button", { name: "图片库" }).click();
  const imageGrid = page.getByLabel("图片库列表");
  await imageGrid.getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.locator('summary[aria-label="更多操作"]').click();
  await detail.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog", { name: "删除「测试门店素材」？" }).getByRole("button", { name: "删除" }).click();
  await expect.poll(() => failedAttempts).toBe(2);
  await page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`).click();
  await expect(chat.getByText("对话内容加载失败。")).toBeVisible();
  await chat.getByRole("button", { name: "重试加载" }).click();
  await expect(chat.getByText("对话内容加载失败。")).toHaveCount(0);
  await expect(chat.getByRole("button", { name: "项目资料，共 1 项" })).toBeVisible();
  expect(failedAttempts).toBe(2);
});

test("a pre-archive project detail response cannot replace the refreshed project", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-02-saved-asset-match"];
  if (!conversationId) throw new Error("Missing seeded CASE-02 project");
  let archived = false;
  let detailCalls = 0;
  let oldDetailDelivered = false;
  let freshDetailDelivered = false;
  let releaseOldDetail: (() => void) | undefined;
  const oldDetailGate = new Promise<void>((resolve) => { releaseOldDetail = resolve; });
  await page.route(`**/v1/assets/conversations/${conversationId}?*`, async (route) => {
    const callNumber = ++detailCalls;
    const response = await route.fetch();
    const payload = await response.json() as AssetConversationResponse;
    if (callNumber === 1) {
      payload.title = "归档前的旧详情";
      await oldDetailGate;
    } else if (archived) {
      payload.title = "归档后的新详情";
      payload.project_resource_summary = { ...payload.project_resource_summary!, sources: 0, historical_sources: 1 };
    }
    await route.fulfill({ response, json: payload });
    if (callNumber === 1) oldDetailDelivered = true;
    else if (archived) freshDetailDelivered = true;
  });
  await page.route("**/v1/assets/*?mode=archive", async (route) => {
    archived = true;
    await route.fulfill({ status: 204, body: "" });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/app/assets?conversation=${conversationId}`);
  await expect.poll(() => detailCalls).toBeGreaterThanOrEqual(1);
  await page.getByRole("navigation", { name: "资源库" }).getByRole("button", { name: "图片库" }).click();
  await page.getByLabel("图片库列表").getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.locator('summary[aria-label="更多操作"]').click();
  await detail.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog", { name: "删除「测试门店素材」？" }).getByRole("button", { name: "删除" }).click();
  await expect.poll(() => freshDetailDelivered).toBe(true);
  await page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`).click();
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  await expect(chat.getByText("归档后的新详情")).toBeVisible();
  releaseOldDetail?.();
  await expect.poll(() => oldDetailDelivered).toBe(true);
  await page.waitForTimeout(200);
  await expect(chat.getByText("归档前的旧详情")).toHaveCount(0);
});

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

test("new conversation keeps the workspace single-column until an artifact exists", async ({ page }) => {
  await page.goto("/app/assets?conversation=new");

  for (let pass = 0; pass < 2; pass++) {
    await expect(page.locator(".shadcn-prototype-workspace.conversation-only-mode")).toBeVisible();
    await expect(page.getByRole("region", { name: "创作起点" })).toHaveCount(0);
    await expect(page.getByRole("separator", { name: "调整对话和展示区宽度" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "新建视频项目" })).toBeVisible();
    for (const name of ["从想法开始", "用素材创作", "修改现有视频"]) {
      await expect(page.getByRole("button", { name: new RegExp(name) })).toBeVisible();
    }
    await expect(page.getByText(/口播型|真人口播|口播清理|Presenter/)).toHaveCount(0);
    if (pass === 0) await page.reload();
  }
  await captureDesktopEvidence(page, "new-conversation-single-column");
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
  const workspace = await openCase(page, "case-04-project-running", false);
  const composer = page.getByRole("region", { name: "Content generation conversation" })
    .getByRole("textbox", { name: "输入对话内容" });
  await expect(composer).toHaveAttribute("placeholder", /视频正在制作/);
  const progress = page.getByRole("region", { name: "Content generation conversation" })
    .getByText("视频生成中", { exact: false }).first();
  await expect(progress).toBeVisible();
  await expect(page.locator(".shadcn-prototype-workspace.conversation-only-mode")).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await expect(page.getByRole("separator", { name: "调整对话和展示区宽度" })).toHaveCount(0);
  await expect(page.locator(".shadcn-prototype-product-card")).toHaveCount(0);
  await expect(workspace.locator(".shadcn-prototype-product-pending")).toHaveCount(0);
  await expect(workspace.getByLabel("时间轴预览")).toHaveCount(0);
  await page.reload();
  await expect(progress).toBeVisible();
  await expect(page.locator(".shadcn-prototype-workspace.conversation-only-mode")).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await expect(workspace.locator(".shadcn-prototype-product-pending")).toHaveCount(0);
  await expect(workspace.getByLabel("时间轴预览")).toHaveCount(0);
  await expect(workspace.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
  await expect(composer).toHaveAttribute("placeholder", /视频正在制作/);
  await captureDesktopEvidence(page, "generating");
});

test("CASE-05 keeps one recovery action in the timeline", async ({ page }) => {
  const workspace = await openCase(page, "case-05-project-failed", false);
  const thread = page.getByRole("region", { name: "Content generation conversation" });
  await expect(page.locator(".shadcn-prototype-workspace.conversation-only-mode")).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await expect(page.getByRole("separator", { name: "调整对话和展示区宽度" })).toHaveCount(0);
  await expect(page.locator(".shadcn-prototype-product-card")).toHaveCount(0);
  const retryAction = thread.getByRole("button", { name: "重试", exact: true });
  await expect(retryAction).toHaveCount(1);
  await expect(retryAction).toBeVisible();
  await expect(thread.getByRole("textbox", { name: "输入对话内容" })).toHaveAttribute("placeholder", /视频未完成/);
  const detailsToggle = thread.getByRole("button", { name: "查看失败步骤" });
  await expect(detailsToggle).toBeVisible();
  const controlledId = await detailsToggle.getAttribute("aria-controls");
  expect(controlledId).toBeTruthy();
  const controlledDetails = page.locator(`[id="${controlledId}"]`);
  await expect(controlledDetails).toBeHidden();
  await expect(thread.getByRole("list", { name: "视频关键进展" })).toHaveCount(0);
  await detailsToggle.click();
  await expect(controlledDetails).toBeVisible();
  await expect(thread.getByRole("list", { name: "视频关键进展" })).toBeVisible();
  await thread.getByRole("button", { name: "收起失败步骤" }).click();
  await expect(controlledDetails).toBeHidden();
  await expect(retryAction).toBeVisible();
  const composer = thread.getByRole("textbox", { name: "输入对话内容" });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    const fits = await composer.evaluate((element) => {
      const textarea = element as HTMLTextAreaElement;
      const style = window.getComputedStyle(textarea);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) return false;
      context.font = style.font;
      const available = textarea.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
      return context.measureText(textarea.placeholder).width <= available + 1;
    });
    expect(fits, `Failure placeholder should fit one line at ${width}px`).toBe(true);
  }
  await mkdir(desktopEvidenceDirectory, { recursive: true });
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "failure-390x844.png"), animations: "disabled" });
  await captureDesktopEvidence(page, "failure");
});

test("CASE-09 keeps an invalid video-render record out of the legacy preview", async ({ page }) => {
  const workspace = await openCase(page, "case-09-invalid-video-render", false);
  await expect(page.locator(".shadcn-prototype-workspace.conversation-only-mode")).toBeVisible();
  await expect(workspace).toHaveCount(0);
  await expect(page.locator(".shadcn-prototype-product-card")).toHaveCount(0);
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
  await expect.poll(() => cards.count()).toBeGreaterThan(48);
  await expect(page.getByRole("button", { name: "加载更多内容" })).toHaveCount(0);
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
      product_status: "completed",
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

test("CASE-07 version comparison keeps unmatched scenes honest across viewports", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-07-project-ready-mp4"];
  const assetId = seed.asset_ids?.["case-07-project-ready-mp4"];
  if (!conversationId || !assetId) throw new Error("Missing seeded CASE-07 identity");
  const evidenceDir = process.env.MULTIMIX_VISUAL_EVIDENCE_DIR;
  const runId = process.env.DISPLAY_COVERAGE_RUN_ID;
  let previousMp4Ref = "local://video-orchestration/display-sample.mp4";
  let currentMp4Ref = previousMp4Ref;
  if (evidenceDir && runId) {
    const mediaDir = resolve(homedir(), "Desktop", "multimix-test-results", "e2e-runtime", "display-coverage", runId, "artifacts", "video-orchestration");
    const source = resolve(mediaDir, "display-sample.mp4");
    const makeVisualVersion = async (name: string, filter: string) => {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", source,
        "-vf", filter, "-an", "-c:v", "libx264", "-preset", "ultrafast",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", resolve(mediaDir, name),
      ]);
      return `local://video-orchestration/${name}`;
    };
    [previousMp4Ref, currentMp4Ref] = await Promise.all([
      makeVisualVersion("display-comparison-before.mp4", "transpose=1,hue=s=0"),
      makeVisualVersion("display-comparison-after.mp4", "transpose=1"),
    ]);
  }

  const versionRows: ContentAssetVersion[] = [1, 2].map((version) => ({
    id: 41000 + version,
    asset_id: assetId,
    version,
    title: "CASE-07 视频工程",
    body: "",
    instruction: version === 2 ? "调整开场和收束" : null,
    created_at: "2026-09-27T00:00:00Z",
  }));
  const comparisonAsset = (original: ContentAsset, side: "previous" | "current"): ContentAsset => {
    const asset = structuredClone(original);
    const metadata = asset.metadata;
    const project = metadata.video_project as Record<string, unknown>;
    const scenes = project.segments as Array<Record<string, unknown>>;
    const endScene = scenes[2];
    endScene.id = side === "previous" ? "scene-removed" : "scene-added";
    endScene.title = side === "previous" ? "旧版收束" : "新版收束";
    endScene.narration = side === "previous" ? "旧版结束" : "新版结束";
    scenes[0].narration = side === "previous" ? "旧版开场" : "新版开场";
    const mainTrack = (project.tracks as Array<Record<string, unknown>>)[0];
    const elements = mainTrack.elements as Array<Record<string, unknown>>;
    elements[2].id = `element-${endScene.id}`;
    elements[2].segmentId = endScene.id;
    elements[2].name = endScene.title;
    project.ratio = "9:16";
    project.mp4_ref = side === "previous" ? previousMp4Ref : currentMp4Ref;
    (project.settings as Record<string, unknown>).width = 1080;
    (project.settings as Record<string, unknown>).height = 1920;
    metadata.video_segments = scenes;
    (metadata.video_plan as Record<string, unknown>).scenes = scenes;
    asset.versions = side === "previous" ? versionRows.slice(0, 1) : versionRows;
    return asset;
  };

  let historicalAsset: ContentAsset | null = null;
  const targetConversationPath = `/v1/assets/conversations/${conversationId}`;
  await page.route("**/v1/assets/conversations**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET"
      || (pathname !== "/v1/assets/conversations" && pathname !== targetConversationPath)) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as AssetConversationResponse | AssetConversationResponse[];
    const rows = Array.isArray(payload) ? payload : [payload];
    for (const row of rows) {
      if (row.id !== conversationId) continue;
      row.products = row.products.map((asset) => {
        if (asset.id !== assetId) return asset;
        historicalAsset = comparisonAsset(asset, "previous");
        return comparisonAsset(asset, "current");
      });
    }
    await route.fulfill({ response, json: payload });
  });
  await page.route(`**/v1/assets/${assetId}/versions/${versionRows[0].id}/preview`, async (route) => {
    if (!historicalAsset) throw new Error("Historical comparison asset was not prepared");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historicalAsset) });
  });
  // The comparison versions exist only in this UI fixture, so their neutral
  // feedback must use the same identity rather than querying unrelated seed data.
  await page.route(`**/v1/video-feedback/${assetId}`, async (route) => {
    if (route.request().method() !== "GET") { await route.continue(); return; }
    await route.fulfill({ status: 200, json: {
      asset_id: assetId, version_id: versionRows[1].id, decision: null, published: false,
    } });
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // This seeded conversation has no optional requirements snapshot; the
    // adapter deliberately handles that endpoint's 404 as an empty snapshot.
    const expectedMissingRequirements = message.location().url.endsWith(`${targetConversationPath}/requirements/current`)
      && message.text().includes("404");
    if (!expectedMissingRequirements) browserErrors.push(message.text());
  });
  const workspace = await openCase(page, "case-07-project-ready-mp4");
  expect(await page.title()).toContain("MultiMix");
  await workspace.getByRole("button", { name: "版本对比" }).click();
  const comparison = workspace.getByRole("region", { name: "版本对比" });
  await expect(comparison).toBeVisible();
  await expect(comparison.getByText("修改后已保存", { exact: false })).toBeVisible();
  const players = comparison.locator(".shadcn-prototype-preview-player");
  await expect(players).toHaveCount(2);
  await expect(comparison.locator(".shadcn-prototype-video-comparison-sync")).toHaveCount(0);
  await expect(comparison.locator(".shadcn-prototype-video-comparison-player-media[inert]")).toHaveCount(0);
  await expect(comparison.getByRole("button", { name: /查看 \d+ 处受影响分镜/ })).toHaveCSS("font-size", "12px");
  await expect(comparison.getByRole("button", { name: "修改前 · v1：播放视频" })).toBeVisible();
  await expect(comparison.getByRole("slider", { name: "修改前 · v1：播放进度" })).toBeVisible();
  await expect(comparison.getByRole("button", { name: "修改后 · v2：播放视频" })).toBeVisible();
  await expect(comparison.getByRole("slider", { name: "修改后 · v2：播放进度" })).toBeVisible();
  if (evidenceDir && runId) {
    const refs = await comparison.locator("video").evaluateAll((nodes) => nodes.map((node) => (node as HTMLVideoElement).currentSrc));
    expect(refs[0]).not.toBe(refs[1]);
  }
  for (const video of await comparison.locator("video").all()) {
    await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState)).toBeGreaterThanOrEqual(1);
  }
  const sceneJump = comparison.getByRole("button", { name: /查看 3 处受影响分镜/ });
  const jumpBox = await sceneJump.boundingBox();
  expect(jumpBox).not.toBeNull();
  if (jumpBox) expect(jumpBox.y + jumpBox.height).toBeLessThanOrEqual(720);
  if (evidenceDir) {
    await mkdir(evidenceDir, { recursive: true });
    await page.screenshot({ path: resolve(evidenceDir, "comparison-1280x720.png"), animations: "disabled" });
  }

  await comparison.getByRole("button", { name: "试听修改前" }).click();
  await sceneJump.focus();
  await page.keyboard.press("Enter");
  const changesRegion = comparison.getByRole("region", { name: "受影响的分镜" });
  await expect(changesRegion).toBeFocused();
  const firstChange = comparison.locator(".shadcn-prototype-video-comparison-changes ol li button").first();
  const firstBox = await firstChange.boundingBox();
  expect(firstBox).not.toBeNull();
  if (firstBox) expect(firstBox.y + firstBox.height).toBeLessThanOrEqual(720);
  if (evidenceDir) await page.screenshot({ path: resolve(evidenceDir, "comparison-scenes-1280x720.png"), animations: "disabled" });
  await comparison.getByRole("button", { name: /新版收束/ }).click();
  const previousAbsent = comparison.getByText("修改前无对应分镜", { exact: true });
  await expect(previousAbsent).toBeVisible();
  await expect(previousAbsent).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(comparison.getByText("仅定位有此分镜的一侧", { exact: false })).toBeVisible();
  await expect(comparison.getByRole("button", { name: "试听修改前" })).toHaveCount(0);
  await expect(comparison.locator("#comparison-active-details")).toContainText("修改前没有对应分镜");
  const comparisonPlayers = comparison.getByRole("group", { name: "对比分镜播放器" });
  await expect(comparisonPlayers).toBeFocused();
  await comparison.getByRole("button", { name: /新版收束/ }).focus();
  await page.keyboard.press("Enter");
  await expect(comparisonPlayers).toBeFocused();
  await expect(comparison.getByRole("button", { name: /新版收束/ })).toHaveAttribute("aria-expanded", "true");
  await expect(comparison.locator("#comparison-active-details")).toBeVisible();
  const beforeVideo = comparison.locator("video").nth(0);
  const afterVideo = comparison.locator("video").nth(1);
  await expect.poll(() => beforeVideo.evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
  await expect.poll(() => afterVideo.evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);
  await expect.poll(() => afterVideo.evaluate((node: HTMLVideoElement) => node.currentTime)).toBeGreaterThanOrEqual(5);
  const playersBox = await players.first().boundingBox();
  expect(playersBox).not.toBeNull();
  if (playersBox) expect(playersBox.y + playersBox.height).toBeLessThanOrEqual(720);
  if (evidenceDir) await page.screenshot({ path: resolve(evidenceDir, "comparison-added-1280x720.png"), animations: "disabled" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await comparison.getByRole("button", { name: /旧版收束/ }).click();
  await expect(comparison.getByText("修改后无对应分镜", { exact: true })).toBeVisible();
  await expect.poll(() => beforeVideo.evaluate((node: HTMLVideoElement) => node.muted)).toBe(false);
  await expect.poll(() => afterVideo.evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
  if (evidenceDir) await page.screenshot({ path: resolve(evidenceDir, "comparison-removed-1440x900.png"), animations: "disabled" });

  await page.setViewportSize({ width: 390, height: 844 });
  await comparison.getByRole("button", { name: /新版收束/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
  await expect(comparison.getByText("修改前无对应分镜", { exact: true })).toBeVisible();
  await expect(comparison.locator(".shadcn-prototype-video-comparison-changes > header")).toHaveCSS("flex-direction", "column");
  if (evidenceDir) await page.screenshot({ path: resolve(evidenceDir, "comparison-added-390x844.png"), animations: "disabled" });
  expect(browserErrors).toEqual([]);
});

test("library page header keeps search and import actions inside narrow viewports", async ({ page }) => {
  for (const view of ["assets", "copy", "image", "video"]) {
    await page.goto(`/app/assets?view=${view}`);
    const header = page.locator(".shadcn-prototype-library-page-header");
    await expect(header.getByRole("textbox")).toBeVisible();
    for (const width of [320, 375, 390, 430, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      const geometry = await header.evaluate((element) => {
        const shell = element.getBoundingClientRect();
        return {
          left: shell.left, right: shell.right,
          overflow: element.scrollWidth - element.clientWidth,
          controls: Array.from(element.querySelectorAll("input, .shadcn-prototype-library-search, button"), (control) => {
            const box = control.getBoundingClientRect();
            return { name: control.getAttribute("aria-label") ?? control.textContent, left: box.left, right: box.right, width: box.width };
          }).filter((control) => control.width > 0),
        };
      });
      expect(geometry.overflow, `${view} header overflow at ${width}px`).toBeLessThanOrEqual(1);
      for (const control of geometry.controls) {
        expect(control.left, `${view} ${control.name} at ${width}px`).toBeGreaterThanOrEqual(geometry.left);
        expect(control.right, `${view} ${control.name} at ${width}px`).toBeLessThanOrEqual(geometry.right + 1);
      }
      if (view === "video" && width === 390) {
        await mkdir(desktopEvidenceDirectory, { recursive: true });
        await page.screenshot({ path: resolve(desktopEvidenceDirectory, "video-library-page-header-390.png"), animations: "disabled" });
      }
    }
  }
});

// Browse-only checks precede editor tests that change the shared CASE-07 project and invalidate its export.
test("video library detail retains its media and actions across narrow viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.goto("/app/assets?view=video");
  const openVideo = async () => {
    await page.getByRole("textbox", { name: "搜索视频库" }).fill("CASE-07");
    await page.getByLabel("视频库列表").getByRole("button", { name: /CASE-07/ }).click();
  };
  await openVideo();
  const detail = page.getByRole("dialog", { name: /CASE-07.*详情/ });
  const media = detail.locator("video");
  await expect.poll(() => media.evaluate((video: HTMLVideoElement) => video.readyState)).toBe(4);
  for (const width of [320, 375, 390, 430, 768, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await detail.evaluate((dialog) => {
      const shell = dialog.getBoundingClientRect();
      const body = dialog.querySelector(".shadcn-prototype-library-detail-body")!;
      const selectors = [
        ".shadcn-prototype-library-detail-header",
        ".shadcn-prototype-library-detail-body",
        ".shadcn-prototype-library-actions",
        "video",
        'button[aria-label="关闭详情"]',
        ".shadcn-prototype-library-actions > button",
        '.shadcn-prototype-library-actions summary[aria-label="更多操作"]',
      ];
      return {
        left: shell.left,
        right: shell.right,
        bodyOverflow: body.scrollWidth - body.clientWidth,
        children: selectors.flatMap((selector) => Array.from(dialog.querySelectorAll(selector), (element) => {
          const box = element.getBoundingClientRect();
          return { selector, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        })),
      };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(width);
    expect(geometry.bodyOverflow, `body overflow at ${width}px`).toBeLessThanOrEqual(1);
    for (const child of geometry.children) {
      expect(child.left, `${child.selector} at ${width}px`).toBeGreaterThanOrEqual(geometry.left);
      expect(child.right, `${child.selector} at ${width}px`).toBeLessThanOrEqual(geometry.right + 1);
      if (child.selector.includes("actions")) {
        expect(child.top).toBeGreaterThanOrEqual(0);
        expect(child.bottom).toBeLessThanOrEqual(844);
      }
    }
    expect(await media.evaluate((video: HTMLVideoElement) => ({ error: video.error?.code ?? null, fit: getComputedStyle(video).objectFit })))
      .toEqual({ error: null, fit: "contain" });
    if (width === 390 || width === 1280) {
      await mkdir(desktopEvidenceDirectory, { recursive: true });
      await page.screenshot({ path: resolve(desktopEvidenceDirectory, `video-library-detail-${width}.png`), animations: "disabled" });
    }
  }
  await detail.getByRole("button", { name: "关闭详情" }).click();
  await page.reload();
  await openVideo();
  await expect.poll(() => media.evaluate((video: HTMLVideoElement) => video.readyState)).toBe(4);
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

  expect(exportRequests.filter((item) => item.method === "PUT" && item.pathname === `/v1/video/projects/${assetId}`)).toHaveLength(0);
  expect(exportRequests.filter((item) => item.method === "GET" && item.pathname.endsWith("/quality") && item.search.includes("stage=export_preflight"))).toHaveLength(2);
  expect(exportRequests.filter((item) => item.method === "POST" && item.pathname.endsWith("/exports"))).toHaveLength(2);
  expect(exportRequests.filter((item) => item.pathname.endsWith("/exports/finalize"))).toHaveLength(0);
});

test("CASE-07 embedded exports reject edits during preflight and recover failed saves", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  const consoleMessages: Array<{ level: string; text: string }> = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) consoleMessages.push({ level: message.type(), text: message.text() });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const workspace = await openCase(page, "case-07-project-ready-mp4");
  const assetId = seed.asset_ids?.["case-07-project-ready-mp4"];
  if (!assetId) throw new Error("Missing seeded asset id for CASE-07");
  await expect(page).toHaveURL(/app\/assets/);
  expect(await page.title()).not.toBe("");
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="视频剪辑器"]');
  const clips = editor.locator('[data-testid="filmstrip"] .shadcn-prototype-filmstrip-clip');
  await expect(clips.first()).toBeVisible({ timeout: 90_000 });
  await clips.first().click();

  let finishPreflight!: () => void;
  const heldPreflight = new Promise<void>((resolve) => { finishPreflight = resolve; });
  let preflightStarted = false;
  let exportRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === `/v1/video/projects/${assetId}/exports`) exportRequests += 1;
  });
  await page.route(`**/v1/video/projects/${assetId}/quality?stage=export_preflight`, async (route) => {
    preflightStarted = true;
    await heldPreflight;
    await route.continue();
  });
  await chooseVideoExport(workspace);
  await expect.poll(() => preflightStarted).toBe(true);

  let finishSave!: () => void;
  const heldSave = new Promise<void>((resolve) => { finishSave = resolve; });
  let saveStarted = false;
  await page.route(`**/v1/video/projects/${assetId}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    saveStarted = true;
    await heldSave;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Test save failure" }) });
  });
  await editor.getByRole("button", { name: "✂ 分割", exact: true }).click();
  await expect(workspace.getByRole("button", { name: "正在保存修改…", exact: true })).toBeDisabled();
  await expect.poll(() => saveStarted).toBe(true);
  await captureDesktopEvidence(page, "embedded-export-saving");
  finishPreflight();
  // This response belongs to the pre-edit export and must never register a candidate.
  await page.waitForResponse((response) => response.url().includes("stage=export_preflight"));
  expect(exportRequests).toBe(0);
  finishSave();
  await expect(workspace.getByRole("button", { name: "保存失败，先重试", exact: true })).toBeDisabled();
  await expect(workspace.getByRole("button", { name: "重试保存", exact: true })).toBeVisible();
  await captureDesktopEvidence(page, "embedded-export-save-failure");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(workspace.getByRole("button", { name: "保存失败，先重试", exact: true })).toBeDisabled();
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "embedded-export-save-failure-390x844.png"), animations: "disabled" });
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.unroute(`**/v1/video/projects/${assetId}`);
  await page.unroute(`**/v1/video/projects/${assetId}/quality?stage=export_preflight`);
  await workspace.getByRole("button", { name: "重试保存", exact: true }).dispatchEvent("click");
  const exportButton = workspace.getByRole("button", { name: "导出视频", exact: true });
  await expect(exportButton).toBeEnabled({ timeout: 60_000 });
  await chooseVideoExport(workspace);
  await expect.poll(() => exportRequests, { timeout: 180_000 }).toBe(1);
  await expect(exportButton).toBeEnabled({ timeout: 180_000 });
  const downloadPromise = page.waitForEvent("download");
  await chooseVideoExport(workspace);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.mp4$/i);
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  if (downloadPath) expect((await stat(downloadPath)).size).toBeGreaterThan(0);
  expect(exportRequests).toBe(1);
  await captureDesktopEvidence(page, "embedded-export-recovered");
  // The devtools portal exists on healthy Next.js pages too.
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
  expect(errors).toEqual([]);
  await writeFile(resolve(desktopEvidenceDirectory, "embedded-export-console.json"), JSON.stringify(consoleMessages, null, 2));
});

test("CASE-07 serializes slow saves and preserves edits during exit refresh", async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const workspace = await openCase(page, "case-07-project-ready-mp4");
  const assetId = seed.asset_ids?.["case-07-project-ready-mp4"];
  const conversationId = seed.conversation_ids?.["case-07-project-ready-mp4"];
  if (!assetId || !conversationId) throw new Error("Missing seeded CASE-07 identity");
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="视频剪辑器"]');
  const clips = editor.locator('[data-testid="filmstrip"] .shadcn-prototype-filmstrip-clip');
  await expect(clips.first()).toBeVisible({ timeout: 90_000 });
  const initialCount = await clips.count();
  const revisions: string[] = [];
  const acknowledgements: string[] = [];
  let releaseSave!: () => void;
  const heldSave = new Promise<void>((resolve) => { releaseSave = resolve; });
  page.on("response", async (response) => {
    if (response.request().method() === "PUT" && new URL(response.url()).pathname === `/v1/video/projects/${assetId}` && response.ok()) {
      const body = await response.json() as { project_fingerprint: string };
      acknowledgements.push(body.project_fingerprint);
    }
  });
  await page.route(`**/v1/video/projects/${assetId}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    revisions.push(route.request().headers()["if-match"]);
    if (revisions.length === 1) await heldSave;
    await route.continue();
  });
  await clips.first().click();
  await editor.getByRole("button", { name: "✂ 分割", exact: true }).click();
  await expect.poll(() => revisions.length).toBe(1);
  await clips.last().click();
  await editor.getByRole("button", { name: "✂ 分割", exact: true }).click();
  await expect(clips).toHaveCount(initialCount + 2);
  await captureDesktopEvidence(page, "save-queue-latest-edit");
  expect(revisions).toHaveLength(1);
  releaseSave();
  await expect.poll(() => acknowledgements.length, { timeout: 60_000 }).toBe(2);
  expect(revisions[1]).toBe(`"${acknowledgements[0]}"`);
  await expect(workspace.getByRole("button", { name: "导出视频", exact: true })).toBeEnabled();

  let releaseRefresh!: () => void;
  const heldRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  let refreshStarted = false;
  await page.route(`**/v1/assets/conversations/${conversationId}?**`, async (route) => {
    if (route.request().method() !== "GET" || refreshStarted) return route.continue();
    const response = await route.fetch();
    refreshStarted = true;
    await heldRefresh;
    await route.fulfill({ response });
  });
  await workspace.getByRole("button", { name: "完成编辑", exact: true }).dispatchEvent("click");
  await expect.poll(() => refreshStarted).toBe(true);
  await clips.last().click();
  await editor.getByRole("button", { name: "✂ 分割", exact: true }).click();
  releaseRefresh();
  await expect(clips).toHaveCount(initialCount + 3);
  await expect.poll(() => acknowledgements.length, { timeout: 60_000 }).toBe(3);
  await expect(page.locator('iframe[title="视频剪辑器"]')).toBeVisible();
  await captureDesktopEvidence(page, "exit-refresh-new-edit-preserved");
  await page.unroute(`**/v1/assets/conversations/${conversationId}?**`);
  await workspace.getByRole("button", { name: "完成编辑", exact: true }).dispatchEvent("click");
  await expect(page.locator('iframe[title="视频剪辑器"]')).toHaveCount(0);
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(clips).toHaveCount(initialCount + 3, { timeout: 90_000 });
  const storedUser = await page.evaluate(() => JSON.parse(window.localStorage.getItem("multimix_local_user") ?? "{}") as { token: string });
  const response = await page.request.get(`http://127.0.0.1:${process.env.DISPLAY_COVERAGE_BACKEND_PORT}/v1/video/projects/${assetId}`, {
    headers: { Authorization: `Bearer ${storedUser.token}` },
  });
  expect(response.ok()).toBe(true);
  expect((await response.json()).project_fingerprint).toBe(acknowledgements[2]);
  await captureDesktopEvidence(page, "saved-edit-reopened");
  await expect(page.locator("[data-nextjs-dialog-overlay]")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("CASE-07 rejects an obsolete editor without overwriting a newer project", async ({ page }) => {
  test.setTimeout(180_000);
  const workspace = await openCase(page, "case-07-project-ready-mp4");
  const assetId = seed.asset_ids?.["case-07-project-ready-mp4"];
  if (!assetId) throw new Error("Missing seeded CASE-07 identity");
  await workspace.getByRole("button", { name: "编辑", exact: true }).click();
  const editor = page.frameLocator('iframe[title="视频剪辑器"]');
  const clips = editor.locator('[data-testid="filmstrip"] .shadcn-prototype-filmstrip-clip');
  await expect(clips.first()).toBeVisible({ timeout: 90_000 });
  const initialCount = await clips.count();
  const storedUser = await page.evaluate(() => JSON.parse(window.localStorage.getItem("multimix_local_user") ?? "{}") as { token: string });
  const url = `http://127.0.0.1:${process.env.DISPLAY_COVERAGE_BACKEND_PORT}/v1/video/projects/${assetId}`;
  const headers = { Authorization: `Bearer ${storedUser.token}` };
  const current = await (await page.request.get(url, { headers })).json();
  const project = { ...current.project, metadata: { ...current.project.metadata, title: "另一编辑窗口保存的新版本" } };
  const updated = await page.request.put(url, { headers: { ...headers, "If-Match": `"${current.project_fingerprint}"` }, data: project });
  expect(updated.status()).toBe(200);
  const updatedBody = await updated.json();
  expect(updatedBody.project_fingerprint).not.toBe(current.project_fingerprint);
  const rejectedSave = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === `/v1/video/projects/${assetId}`);
  await clips.first().click();
  await editor.getByRole("button", { name: "✂ 分割", exact: true }).click();
  expect((await rejectedSave).status()).toBe(412);
  await expect(workspace.getByRole("button", { name: "保存失败，先重试", exact: true })).toBeDisabled();
  await expect(workspace.getByText(/工程已有新的修改/).first()).toBeVisible();
  await expect(clips).toHaveCount(initialCount + 1);
  const rejectedRetry = page.waitForResponse((response) => response.request().method() === "PUT" && new URL(response.url()).pathname === `/v1/video/projects/${assetId}`);
  await workspace.getByRole("button", { name: "重试保存", exact: true }).dispatchEvent("click");
  expect((await rejectedRetry).status()).toBe(412);
  await expect(page.locator('iframe[title="视频剪辑器"]')).toBeVisible();
  const persisted = await (await page.request.get(url, { headers })).json();
  expect(persisted.project.metadata.title).toBe(project.metadata.title);
  expect(persisted.project_fingerprint).toBe(updatedBody.project_fingerprint);
  await captureDesktopEvidence(page, "version-conflict-edit-preserved");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(desktopEvidenceDirectory, "version-conflict-edit-preserved-390x844.png"), animations: "disabled" });
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

// Keep this destructive fixture check last: earlier CASE-02 checks need its live source.
test("real archive API keeps the project source in read-only history", async ({ page }) => {
  const conversationId = seed.conversation_ids?.["case-02-saved-asset-match"];
  if (!conversationId) throw new Error("Missing seeded CASE-02 project");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/app/assets?conversation=${conversationId}`);
  const chat = page.getByRole("region", { name: "Content generation conversation" });
  const resourceEntry = chat.getByRole("button", { name: /^项目资料/ });
  const initialPagePromise = page.waitForResponse((response) => (
    new URL(response.url()).pathname === `/v1/assets/conversations/${conversationId}/resources`
  ));
  await resourceEntry.click();
  const initialResources = await (await initialPagePromise).json() as { items: Array<Record<string, unknown>> };
  const source = initialResources.items.find((item) => item.kind === "source");
  if (!source || typeof source.id !== "number") throw new Error("Missing seeded project source");
  await page.getByRole("dialog", { name: /的项目资源/ }).getByRole("button", { name: "关闭项目资源" }).click();

  await page.getByRole("navigation", { name: "资源库" }).getByRole("button", { name: "图片库" }).click();
  await page.getByLabel("图片库列表").getByRole("button", { name: /测试门店素材/ }).click();
  const detail = page.getByRole("dialog", { name: "测试门店素材详情" });
  await detail.locator('summary[aria-label="更多操作"]').click();
  await detail.getByRole("button", { name: "删除", exact: true }).click();
  const deleted = page.waitForResponse((response) => (
    response.request().method() === "DELETE"
    && new URL(response.url()).pathname === `/v1/assets/${source.id}`
  ));
  await page.getByRole("dialog", { name: "删除「测试门店素材」？" }).getByRole("button", { name: "删除" }).click();
  expect((await deleted).status()).toBe(204);
  await expect(page.getByLabel("图片库列表")).toBeVisible();
  await expect(page.getByRole("region", { name: "Content generation conversation" })).toBeHidden();
  await expect(page.getByText("已删除。", { exact: true })).toBeVisible();
  await page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`).click();
  await resourceEntry.click();
  const drawer = page.getByRole("dialog", { name: /的项目资源/ });
  await expect(drawer.getByRole("button", { name: "素材 1" })).toBeVisible();
  await expect(drawer.getByText("源文件已从资源库归档，暂不能用于后续创作")).toBeVisible();
  await page.reload();
  await resourceEntry.click();
  await expect(drawer.getByText("源文件已从资源库归档，暂不能用于后续创作")).toBeVisible();
});
