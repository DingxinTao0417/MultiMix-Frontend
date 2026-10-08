import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";

const baseURL = new URL(process.argv[2] || "http://127.0.0.1:3319");
assert.equal(baseURL.hostname, "127.0.0.1", "Use an isolated local frontend.");
assert(!["3117", "3200"].includes(baseURL.port), "Do not use a developer frontend.");
const output = path.resolve(process.argv[3] || "test-results/conversation-entry");
await fs.mkdir(output, { recursive: true });
const report = {
  baseURL: baseURL.origin,
  scope: "Frontend entry with no backend configured; not video generation acceptance",
  checks: [],
  status: "running",
};
const browser = await chromium.launch({ headless: true });
let page;
try {
  page = await browser.newPage();
  let conversationWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/assets/conversations")) {
      conversationWrites += 1;
    }
  });

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(new URL("/?conversation=new", baseURL).href);
    await expect(page.getByRole("heading", { name: "新建视频项目" })).toBeVisible();
    await expect(page.getByText("说出你的想法，和 AI 一起把视频做出来。")).toBeVisible();
    // This check deliberately requires the isolated, disconnected UI.
    await expect(page.getByLabel("输入对话内容")).toBeDisabled();

    const geometry = await page.evaluate(() => {
      const selectors = [
        ".shadcn-prototype-start",
        ".shadcn-prototype-start-inner",
        ".shadcn-prototype-start-dock",
        ".shadcn-prototype-start-goal-grid",
        ".shadcn-prototype-start-dock textarea",
        ".shadcn-prototype-start-dock-send",
      ];
      return selectors.map((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error(`Missing ${selector}`);
        const rect = element.getBoundingClientRect();
        return { selector, left: rect.left, right: rect.right,
          clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
      });
    });
    for (const item of geometry) {
      assert(item.left >= 0 && item.right <= width + 1,
        `${width}px: ${item.selector} extends outside the viewport: ${JSON.stringify(item)}`);
      assert(item.scrollWidth <= item.clientWidth + 1,
        `${width}px: ${item.selector} clips internal content: ${JSON.stringify(item)}`);
    }

    await expect(page.getByTestId("conversation-start-goal")).toHaveCount(3);
    for (const path of ["从想法开始", "用素材创作", "修改现有视频"]) {
      await page.getByTestId("conversation-start-goal").filter({ hasText: path }).click();
      const prompt = await page.getByLabel("输入对话内容").inputValue();
      assert(!/我的素材|我提供的素材|我上传的/.test(prompt), `${path} invents uploaded materials`);
    }
    await page.getByTestId("conversation-start-goal").first().click();
    await expect(page.getByLabel("输入对话内容")).toHaveValue(/先从想法开始/);
    assert.equal(conversationWrites, 0, "Selecting a starter must not send a conversation message");
    await page.getByRole("heading", { name: "新建视频项目" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `entry-${width}.png`), fullPage: true });
    report.checks.push({ width, geometry, selection: "passed", conversationWrites });
  }

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "登录你的 AI 短视频创作工作台" })).toBeVisible();
  await expect(page.getByText("说出你的想法，和 AI 一起把视频做出来。")).toBeVisible();
  await page.screenshot({ path: path.join(output, "login.png"), fullPage: true });
  report.checks.push({ login: "passed" });
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = error instanceof Error ? error.message : String(error);
  if (page) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
  throw error;
} finally {
  await fs.writeFile(path.join(output, "verification.json"), JSON.stringify(report, null, 2));
  await browser.close();
}
console.log(`Conversation entry checks passed. Evidence: ${output}`);
