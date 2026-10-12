import { expect, type Locator, type Page } from "@playwright/test";

// Workspace navigation (projects, libraries, account) lives in an on-demand
// panel opened from the header project switcher; there is no persistent
// sidebar. These helpers open the panel the way a user would before reaching
// into it, so specs never depend on navigation being permanently on screen.

const PANEL_NAME = "工作台导航";

export function navigationPanel(page: Page): Locator {
  return page.getByRole("dialog", { name: PANEL_NAME });
}

export async function openNavigation(page: Page): Promise<Locator> {
  const panel = navigationPanel(page);
  if (await panel.count() === 0) {
    await page.getByRole("button", { name: /^切换项目或资源库/ }).first().click();
  }
  await expect(panel).toBeVisible();
  return panel;
}

export async function openLibrary(page: Page, name: "资产库" | "文案库" | "图片库" | "视频库"): Promise<void> {
  const panel = await openNavigation(page);
  await panel.getByRole("navigation", { name: "资源库" }).getByRole("button", { name, exact: true }).click();
  await expect(panel).toHaveCount(0);
}

// Project rows show eight recent projects by default; expand the list when the
// wanted project is beyond them. Returns the row link inside the open panel.
export async function projectLink(page: Page, conversationId: string): Promise<Locator> {
  const panel = await openNavigation(page);
  const link = panel.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`);
  if (await link.count() === 0) {
    await panel.getByRole("button", { name: "查看全部", exact: true }).click();
  }
  await expect(link).toBeVisible();
  return link;
}

// Opens a project and confirms the switch landed: the panel closes and the URL
// carries the project (the row's aria-current is gone once the panel closes).
export async function openProject(page: Page, conversationId: string): Promise<void> {
  await (await projectLink(page, conversationId)).click();
  await expect(navigationPanel(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`[?&]conversation=${conversationId}(?:&|$)`));
}
