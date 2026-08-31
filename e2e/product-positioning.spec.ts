import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const resultDir = process.env.PRODUCT_POSITIONING_RESULT_DIR;
const runId = process.env.PRODUCT_POSITIONING_RUN_ID ?? "local";

if (!resultDir) throw new Error("PRODUCT_POSITIONING_RESULT_DIR is required");

fs.mkdirSync(resultDir, { recursive: true });

test("from-scratch video confirmation shows the frozen default and updates the voice choice", async ({ page }) => {
  test.setTimeout(90_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto("/app/assets");
  await page.locator(".multimix-auth-switch").getByRole("button", { name: "注册" }).click();
  await page.getByLabel("邮箱").fill(`video-policy-${runId}@example.com`);
  await page.getByLabel("密码").fill("video-policy-e2e-2026");
  await page.locator("form").getByRole("button", { name: "注册" }).click();
  await expect(page.getByRole("heading", { name: "今天想做什么短视频？" })).toBeVisible({ timeout: 30_000 });

  await page.getByLabel("输入对话内容").fill(
    "为 MultiMix 制作一条 30 秒产品介绍视频，面向需要快速制作营销视频的小团队，重点介绍上传素材、AI 编导和可编辑成片。",
  );
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url().includes("/v1/assets/conversations/messages"),
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "发送" }).click();
  const response = await responsePromise;
  expect(response.ok(), `video request failed: ${response.status()} ${await response.text()}`).toBe(true);

  const card = page.getByLabel("确认视频参数 · 待确认");
  await expect(card).toBeVisible();
  await expect(card.getByRole("radio", { name: "横屏 16:9" })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("radio", { name: "生成 AI 配音", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByRole("alert")).toContainText("AI 配音当前不可用");
  await expect(card.getByRole("button", { name: "确认参数并生成编导稿" })).toBeDisabled();
  await page.screenshot({ path: path.join(resultDir, "video-policy-default-blocked.png"), fullPage: true });

  await card.getByRole("radio", { name: "不生成 AI 配音", exact: true }).click();
  await expect(card.getByRole("radio", { name: "不生成 AI 配音", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(card.getByText("关闭", { exact: true })).toBeVisible();
  await expect(card.getByText("开启（默认）", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("alert")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "确认参数并生成编导稿" })).toBeEnabled();
  await page.screenshot({ path: path.join(resultDir, "video-policy-voice-disabled.png"), fullPage: true });

  expect(pageErrors, `uncaught page errors: ${pageErrors.join("\n")}`).toEqual([]);
  expect(consoleErrors, `browser console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
