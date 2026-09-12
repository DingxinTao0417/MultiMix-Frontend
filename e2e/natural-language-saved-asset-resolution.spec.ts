import fs from "node:fs";
import path from "node:path";

import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type Asset = { id: number; title: string };

type ConversationMessageResponse = {
  conversation_id: string;
  assistant_message: string;
  conversation: {
    project_resources: { sources: Asset[] };
  };
  suggestion_actions: Array<{
    action_type?: string;
    target_asset_id?: number;
    source_resolution_id?: string;
  }>;
};

const backendUrl = process.env.LLY44_E2E_BACKEND_URL;
const resultDir = process.env.LLY44_E2E_RESULT_DIR;
const runId = process.env.LLY44_E2E_RUN_ID ?? "local";

if (!backendUrl) throw new Error("LLY44_E2E_BACKEND_URL is required");
if (!resultDir) throw new Error("LLY44_E2E_RESULT_DIR is required");
fs.mkdirSync(resultDir, { recursive: true });

async function responseJson(response: APIResponse | Response): Promise<ConversationMessageResponse> {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json() as Promise<ConversationMessageResponse>;
}

async function createSavedImage(page: Page, token: string, title: string): Promise<Asset> {
  const response = await page.request.post(`${backendUrl}/v1/assets/text`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      title,
      body_markdown: `${title}\n\n本地浏览器验收素材。`,
      library_kind: "image",
      content_type: "saved_image",
      metadata: {
        understanding: {
          status: "ready",
          caption: `${title}，门窗施工现场素材。`,
          tags: ["门窗", "施工"],
        },
      },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json() as Promise<Asset>;
}

async function sendFromComposer(page: Page, instruction: string): Promise<ConversationMessageResponse> {
  const responsePromise = page.waitForResponse((response) => (
    response.url() === `${backendUrl}/v1/assets/conversations/messages`
    && response.request().method() === "POST"
  ));
  await page.getByLabel("输入对话内容").fill(instruction);
  await page.getByRole("button", { name: "发送" }).click();
  return responseJson(await responsePromise);
}

async function openIsolatedWorkspace(page: Page, scenario: string): Promise<string> {
  const email = `lly44-browser-${scenario}-${runId}@example.test`;
  const registration = await page.request.post(`${backendUrl}/v1/auth/register`, {
    data: {
      email,
      password: "lly44-browser-password",
      locale: "zh",
      region: "global",
    },
  });
  expect(registration.status(), await registration.text()).toBe(201);
  const { access_token: token } = await registration.json() as { access_token?: string };
  expect(token).toBeTruthy();
  await page.addInitScript(({ storedEmail, storedToken }) => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email: storedEmail, token: storedToken }),
    );
  }, { storedEmail: email, storedToken: token });
  return token!;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 });
});

test("a unique named saved source reaches the existing confirmation flow", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const token = await openIsolatedWorkspace(page, "unique");
  const exactAsset = await createSavedImage(page, token, "品牌主视觉");
  await page.goto("/app/assets");
  await expect(page.getByRole("heading", { name: "新建视频项目" })).toBeVisible();

  const exact = await sendFromComposer(
    page,
    "用品牌主视觉做一条门窗宣传视频",
  );
  expect(exact.assistant_message).toContain("品牌主视觉");
  expect(exact.conversation.project_resources.sources.map((asset) => asset.id)).toEqual([
    exactAsset.id,
  ]);
  await expect(page.getByText("品牌主视觉", { exact: false }).last()).toBeVisible();
  await page.screenshot({
    path: path.join(resultDir, "unique-resolution.png"),
    fullPage: true,
  });
  expect(pageErrors, `uncaught page errors: ${pageErrors.join("\n")}`).toEqual([]);
});

test("an ambiguous reference exposes stable candidates and resumes with the chosen asset", async ({ page }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const token = await openIsolatedWorkspace(page, "ambiguous");
  const firstAmbiguousAsset = await createSavedImage(page, token, "施工花絮 A");
  const secondAmbiguousAsset = await createSavedImage(page, token, "施工花絮 B");
  await page.goto("/app/assets");
  await expect(page.getByRole("heading", { name: "新建视频项目" })).toBeVisible();
  const ambiguous = await sendFromComposer(
    page,
    "用施工花絮做一条门窗宣传视频",
  );
  expect(ambiguous.assistant_message).toBe("找到了几个可能的素材，请选择你指的是哪一个。");
  expect(ambiguous.suggestion_actions).toEqual(expect.arrayContaining([
    expect.objectContaining({
      action_type: "select_source",
      target_asset_id: firstAmbiguousAsset.id,
      source_resolution_id: expect.any(String),
    }),
    expect.objectContaining({
      action_type: "select_source",
      target_asset_id: secondAmbiguousAsset.id,
      source_resolution_id: expect.any(String),
    }),
  ]));
  await expect(page.getByRole("button", { name: /施工花絮 A/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /施工花絮 B/ })).toBeVisible();
  await page.screenshot({
    path: path.join(resultDir, "ambiguous-candidates.png"),
    fullPage: true,
  });

  const selectedResponsePromise = page.waitForResponse((response) => (
    response.url() === `${backendUrl}/v1/assets/conversations/messages`
    && response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: /施工花絮 B/ }).click();
  const selected = await responseJson(await selectedResponsePromise);
  expect(selected.assistant_message).toContain("施工花絮 B");
  expect(selected.conversation.project_resources.sources.map((asset) => asset.id)).toEqual([
    secondAmbiguousAsset.id,
  ]);
  await expect(page.getByText("施工花絮 B", { exact: false }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /施工花絮 A/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /施工花絮 B/ })).toBeDisabled();
  await page.screenshot({
    path: path.join(resultDir, "ambiguous-selection-resolved.png"),
    fullPage: true,
  });

  expect(pageErrors, `uncaught page errors: ${pageErrors.join("\n")}`).toEqual([]);
});
