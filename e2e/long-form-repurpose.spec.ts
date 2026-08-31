import { expect, test, type Page, type Request, type Route } from "@playwright/test";

const sourceAsset = {
  id: 91,
  project_id: null,
  parent_asset_id: null,
  library_kind: "video",
  asset_kind: "video",
  content_type: "long_form_video_source",
  title: "访谈第 12 期",
  status: "ready",
  source_type: "upload",
  generation_state: "source_ready",
  source_filename: "episode-12.mp4",
  source_content_type: "video/mp4",
  original_ref: null,
  markdown_ref: null,
  content_hash: "sha256:e2e-source",
  body: "",
  metadata: { duration_seconds: 1200 },
  source_mapping: [],
  linked_asset_ids: [],
  linked_event_ids: [],
  archived: false,
  error_message: null,
  created_at: "2026-08-04T00:00:00Z",
  updated_at: "2026-08-04T00:00:00Z",
  versions: [],
};

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type,x-request-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "content-type": "application/json",
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
}

async function installFixtureApi(page: Page) {
  const messageRequests: Request[] = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({
      email: "browser-e2e@multimix.local",
      token: "browser-e2e-token",
    }));
  });
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets/conversations") {
      await fulfillJson(route, []);
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets") {
      await fulfillJson(route, url.searchParams.get("library_kind") === "video" ? [sourceAsset] : []);
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/assets/conversations/messages") {
      messageRequests.push(request);
      await fulfillJson(route, { detail: "browser fixture captured request" }, 409);
      return;
    }
    await fulfillJson(route, []);
  });
  return messageRequests;
}

test("new conversation keeps long-form sources inside the composer", async ({ page }) => {
  await installFixtureApi(page);
  await page.goto("/app/assets");

  await expect(page.getByRole("button", { name: "上传长视频或粘贴链接" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传视频素材" })).toBeVisible();
  await expect(page.locator('input[type="file"][accept*=".mp4"]')).toHaveAttribute("accept", /\.mp4.*\.mov.*\.webm.*\.mkv/);
  await expect(page.getByText("支持拖入 PDF / 图片 / 视频，也可粘贴视频链接")).toBeVisible();
});

test("saved long-form source waits for a requirement before structured analysis", async ({ page }) => {
  const messageRequests = await installFixtureApi(page);
  await page.goto("/app/assets?view=video");

  const sourceCard = page.getByRole("button", { name: /访谈第 12 期/ });
  await expect(sourceCard).toBeVisible();
  await sourceCard.click();
  const dialog = page.getByRole("dialog", { name: "访谈第 12 期详情" });
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: "拆成短视频" }).click();

  const tray = page.getByLabel("本次上传资料");
  await expect(tray.getByText("访谈第 12 期")).toBeVisible();
  await expect(page.getByText("你想怎么处理这段内容？")).toBeVisible();
  expect(messageRequests).toHaveLength(0);

  const instruction = "找出这段内容中值得发布的片段";
  await page.getByLabel("输入对话内容").fill(instruction);
  await page.getByRole("button", { name: "发送" }).click();
  await expect.poll(() => messageRequests.length).toBe(1);
  const payload = messageRequests[0]!.postDataJSON() as Record<string, unknown>;

  expect(payload).toMatchObject({
    instruction,
    linked_asset_ids: [91],
    long_form_action: {
      kind: "analyze",
      source_asset_id: 91,
    },
  });
  expect(payload).not.toHaveProperty("selected_product_id");
});
