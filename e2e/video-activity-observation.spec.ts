import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

test("observes real input in an existing video without starting generation", async ({ page }) => {
  test.setTimeout(90_000);
  const backend = process.env.ACTIVITY_BACKEND_URL!;
  const evidence = process.env.ACTIVITY_EVIDENCE_DIR!;
  const email = "video-pipeline-1790798868966@example.com";
  const login = await page.request.post(`${backend}/v1/auth/login`, {
    data: { email, password: "local-video-pipeline-2026" },
  });
  expect(login.status()).toBe(200);
  const { access_token: token } = await login.json();
  await page.addInitScript(({ email, token }) => {
    localStorage.setItem("multimix_local_user", JSON.stringify({ email, token }));
  }, { email, token });
  const intervals: Array<{ status: number; asset_id: number; properties: Record<string, number> }> = [];
  const forbidden: string[] = [];
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && !request.url().endsWith("/product-events")) {
      forbidden.push(request.url());
      await route.abort();
    } else await route.continue();
  });
  page.on("response", async (response) => {
    const request = response.request();
    if (request.method() === "POST" && request.url().endsWith("/product-events")) {
      const body = request.postDataJSON();
      if (body.event_name === "video_active_interval") intervals.push({
        status: response.status(), asset_id: body.asset_id, properties: body.properties,
      });
    }
  });
  await page.goto("/app/assets?conversation=asset-conversation-c20f6fbff47f&product=asset-7");
  const input = page.getByRole("textbox", { name: "输入对话内容" });
  await expect(input).toBeVisible();
  await expect(page.getByRole("region", { name: "Current product workspace" })).toBeVisible();
  await input.fill("仅观察输入，不发送、不生成。");
  await page.keyboard.press("ArrowLeft");
  const received = page.waitForResponse((response) => response.url().endsWith("/product-events")
    && response.request().postDataJSON()?.event_name === "video_active_interval");
  expect((await received).status()).toBe(201);
  await page.screenshot({ path: path.join(evidence, "observation-completed.png") });
  await page.goto("/");
  expect(intervals).toHaveLength(1);
  expect(intervals[0].asset_id).toBe(7);
  expect(Object.keys(intervals[0].properties).sort()).toEqual(["interval_end_ms", "interval_start_ms"]);
  const elapsed = intervals[0].properties.interval_end_ms - intervals[0].properties.interval_start_ms;
  expect(elapsed).toBeGreaterThan(0);
  expect(elapsed).toBeLessThanOrEqual(30000);
  expect(forbidden).toEqual([]);
  fs.writeFileSync(path.join(evidence, "observed-intervals.json"), JSON.stringify(intervals, null, 2));
});
