import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";


const backendUrl = process.env.ADMIN_METRICS_BACKEND_URL;
const resultDir = process.env.ADMIN_METRICS_RESULT_DIR;
const runId = process.env.ADMIN_METRICS_RUN_ID ?? "local";
const adminEmail = process.env.ADMIN_METRICS_ADMIN_EMAIL ?? "local@admin";
const adminPassword = process.env.ADMIN_METRICS_ADMIN_PASSWORD ?? "admin-metrics-e2e-password";

if (!backendUrl) throw new Error("ADMIN_METRICS_BACKEND_URL is required");
if (!resultDir) throw new Error("ADMIN_METRICS_RESULT_DIR is required");
fs.mkdirSync(resultDir, { recursive: true });


async function storeSession(page: Page, email: string, token: string) {
  await page.goto("/app/assets");
  await page.evaluate(({ storedEmail, storedToken }) => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email: storedEmail, token: storedToken }),
    );
  }, { storedEmail: email, storedToken: token });
}


async function login(page: Page, email: string, password: string): Promise<string> {
  const response = await page.request.post(`${backendUrl}/v1/auth/login`, {
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const body = await response.json() as { access_token?: string };
  expect(body.access_token).toBeTruthy();
  return body.access_token!;
}


test("product metrics are visible only to administrators", async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });

  const memberEmail = `metrics-member-${runId}@example.com`;
  const memberPassword = "metrics-member-password";
  const registration = await page.request.post(`${backendUrl}/v1/auth/register`, {
    data: {
      email: memberEmail,
      password: memberPassword,
      locale: "zh",
      region: "global",
    },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const registrationBody = await registration.json() as { access_token?: string };
  const memberToken = registrationBody.access_token;
  expect(memberToken).toBeTruthy();

  const directMemberMetrics = await page.request.get(
    `${backendUrl}/v1/admin/product-metrics?window_days=30`,
    { headers: { Authorization: `Bearer ${memberToken}` } },
  );
  expect(directMemberMetrics.status()).toBe(403);

  await storeSession(page, memberEmail, memberToken!);
  await page.goto("/admin/product-metrics");
  await expect(page.getByRole("heading", { name: "无权访问此页面" })).toBeVisible();
  await expect(page.getByLabel("产品激活漏斗")).not.toBeVisible();
  expect(consoleErrors).toEqual([
    expect.stringContaining("403 (Forbidden)"),
  ]);
  consoleErrors.length = 0;
  await page.screenshot({
    path: path.join(resultDir, "member-denied.png"),
    fullPage: true,
  });

  await page.goto("/app/assets");
  await expect(page.getByRole("heading", { name: "今天想做什么短视频？" })).toBeVisible();
  await expect(page.getByRole("link", { name: /产品指标/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /产品指标/ })).toHaveCount(0);

  const adminToken = await login(page, adminEmail, adminPassword);
  await storeSession(page, adminEmail, adminToken);
  await page.goto("/admin/product-metrics");

  await expect(page.getByRole("heading", { name: "产品指标" })).toBeVisible();
  await expect(page.getByLabel("产品激活漏斗")).toBeVisible();
  await expect(page.getByText("用户素材分镜占比")).toBeVisible();
  await expect(page.getByText("首个可编辑视频耗时中位数")).toBeVisible();
  await expect(page.getByText("修改率", { exact: true })).toBeVisible();
  await expect(page.getByText("导出率", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "最近 30 天" })).toBeVisible();
  await page.screenshot({
    path: path.join(resultDir, "admin-product-metrics.png"),
    fullPage: true,
  });

  const adminMetrics = await page.request.get(
    `${backendUrl}/v1/admin/product-metrics?window_days=30`,
    { headers: { Authorization: `Bearer ${adminToken}` } },
  );
  expect(adminMetrics.status()).toBe(200);
  const metrics = await adminMetrics.json() as { totals?: { registered_users?: number } };
  expect(metrics.totals?.registered_users).toBeGreaterThanOrEqual(1);

  expect(pageErrors, `uncaught page errors: ${pageErrors.join("\n")}`).toEqual([]);
  expect(consoleErrors, `browser console errors: ${consoleErrors.join("\n")}`).toEqual([]);
});
