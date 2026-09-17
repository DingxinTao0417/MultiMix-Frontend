import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const resultDir = process.env.CREATIVE_MEMORY_RESULT_DIR;
const runId = process.env.CREATIVE_MEMORY_RUN_ID;
const backendRoot = process.env.CREATIVE_MEMORY_BACKEND_ROOT;
const python = process.env.CREATIVE_MEMORY_PYTHON;
const databaseUrl = process.env.CREATIVE_MEMORY_DATABASE_URL;
if (!resultDir || !runId || !backendRoot || !python || !databaseUrl) {
  throw new Error("Creative-memory E2E requires the isolated runner environment");
}
fs.mkdirSync(resultDir, { recursive: true });

test("completed video prompts for typed long-term memory and survives refresh", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `creative-memory-${runId}@example.com`;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/assets");
  await page.locator(".multimix-auth-switch").getByRole("button", { name: "注册" }).click();
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("密码").fill("creative-memory-e2e-2026");
  await page.getByRole("checkbox", { name: /服务条款.*隐私政策/ }).check();
  await page.locator("form").getByRole("button", { name: "注册" }).click();
  await expect(page.getByRole("heading", { name: "新建视频项目" })).toBeVisible({ timeout: 30_000 });
  const startOptOut = page.getByRole("checkbox", { name: "本项目不使用创作档案" });
  await expect(startOptOut).toBeVisible();
  await expect(startOptOut).toHaveCSS("width", "18px");
  await page.screenshot({ path: path.join(resultDir, "creative-memory-start-opt-out.png"), fullPage: true });
  await startOptOut.check();
  const messageProjects: string[] = [];
  await page.route("**/v1/assets/conversations/messages", async (route) => {
    const payload = route.request().postDataJSON() as { conversation_id?: string };
    messageProjects.push(payload.conversation_id ?? "");
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ detail: "LLY-77 测试注入失败" }),
    });
  });
  const createdProjectResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/v1/assets/conversations"
    && response.request().method() === "POST");
  await page.getByRole("textbox", { name: "输入对话内容" }).fill("制作一条烘焙视频；这个项目不使用创作档案。");
  await page.getByRole("button", { name: "发送" }).click();
  const projectResponse = await createdProjectResponse;
  expect(projectResponse.request().postDataJSON()).toMatchObject({ ignore_profile: true });
  const createdProject = await projectResponse.json() as { id: string };
  await expect.poll(() => messageProjects.length).toBe(1);
  expect(messageProjects[0]).toBe(createdProject.id);
  const projectDetail = await page.request.get(
    new URL(`/v1/assets/conversations/${createdProject.id}`, projectResponse.url()).toString(),
    { headers: { authorization: projectResponse.request().headers()["authorization"] ?? "" } },
  );
  expect(projectDetail.ok()).toBe(true);
  expect((await projectDetail.json() as { metadata?: { creative_memory_ignore_profile?: boolean } })
    .metadata?.creative_memory_ignore_profile).toBe(true);
  await page.getByRole("textbox", { name: "输入对话内容" }).fill("失败后重试，仍保持项目关闭档案。");
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => messageProjects.length).toBe(2);
  expect(messageProjects[1]).toBe(createdProject.id);
  await page.unroute("**/v1/assets/conversations/messages");

  const output = execFileSync(python, [
    "-m", "app.tests.seed_creative_memory_e2e", "--email", email, "--run-id", runId,
  ], {
    cwd: backendRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      MULTIMIX_ENV: "local",
      MULTIMIX_AUTH_PROVIDER: "local",
      MULTIMIX_DATABASE_URL: databaseUrl,
    },
  }).trim();
  const [conversationId] = output.split(/\s+/);
  expect(conversationId).toMatch(/^asset-conversation-lly77-/);

  await page.reload();
  await expect(page.getByText(`LLY-77 创作档案验收 ${runId}`).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText(`LLY-77 创作档案验收 ${runId}`).first().click();
  const prompt = page.getByRole("region", { name: "保存创作偏好" });
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt.getByText("附近的烘焙新手")).toBeVisible();
  await expect(prompt.getByText("夸张标题")).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(prompt).toBeVisible();
  await prompt.scrollIntoViewIfNeeded();
  await expect(prompt).toHaveCSS("background-color", "rgb(250, 248, 245)");
  await expect(prompt).toHaveCSS("border-top-style", "solid");
  await expect(prompt.getByRole("checkbox", { name: "保存附近的烘焙新手" })).toHaveCSS("width", "18px");
  await page.screenshot({ path: path.join(resultDir, "creative-memory-mobile-before-save.png"), fullPage: true });
  await prompt.getByRole("checkbox", { name: "保存附近的烘焙新手" }).click();
  await prompt.getByRole("button", { name: "保存 1 项" }).click();
  await expect(page.getByRole("status").filter({ hasText: "已保存到创作档案" })).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await page.getByText(`LLY-77 创作档案验收 ${runId}`).first().click();
  await expect(page.getByRole("region", { name: "保存创作偏好" })).toHaveCount(0);
  await page.getByRole("button", { name: "创作档案" }).last().click();
  await expect(page.getByText("附近的烘焙新手")).toBeVisible();
  await page.screenshot({ path: path.join(resultDir, "creative-memory-profile-after-save.png"), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  const profilePanel = page.getByRole("dialog", { name: "创作档案" });
  await expect(profilePanel).toBeVisible();
  const panelBounds = await profilePanel.boundingBox();
  expect(panelBounds).not.toBeNull();
  expect(panelBounds!.x).toBeGreaterThanOrEqual(0);
  expect(panelBounds!.x + panelBounds!.width).toBeLessThanOrEqual(376);
  await page.screenshot({ path: path.join(resultDir, "creative-memory-profile-mobile.png"), fullPage: true });
});
