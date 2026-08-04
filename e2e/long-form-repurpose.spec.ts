import { expect, test, type Page, type Route } from "@playwright/test";

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
      await fulfillJson(route, { detail: "browser fixture captured request" }, 409);
      return;
    }
    await fulfillJson(route, []);
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtureApi(page);
});

test("new conversation exposes the dedicated long-form upload and URL entry", async ({ page }) => {
  await page.goto("/app/assets");

  const trigger = page.getByRole("button", { name: "上传长视频或粘贴链接" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  await expect(page.getByRole("region", { name: "长视频或播客拆条入口" })).toBeVisible();
  await expect(page.getByLabel("选择长视频文件")).toHaveAttribute("accept", /\.mp4.*\.mov.*\.webm.*\.mkv/);
  await expect(page.getByPlaceholder("粘贴 YouTube、Bilibili 或公开 MP4 链接")).toBeVisible();
  await expect(page.getByText(/请确认你拥有素材使用权/)).toBeVisible();
});

test("saved long-form source sends an exact structured analyze action", async ({ page }) => {
  await page.goto("/app/assets?view=video");

  const sourceCard = page.getByRole("button", { name: /访谈第 12 期/ });
  await expect(sourceCard).toBeVisible();
  await sourceCard.click();
  const dialog = page.getByRole("dialog", { name: "访谈第 12 期详情" });
  await expect(dialog).toBeVisible();

  const messageRequest = page.waitForRequest((request) => (
    request.method() === "POST"
    && new URL(request.url()).pathname === "/v1/assets/conversations/messages"
  ));
  await dialog.getByRole("button", { name: "拆成短视频" }).click();
  const request = await messageRequest;
  const payload = request.postDataJSON() as Record<string, unknown>;

  expect(payload).toMatchObject({
    instruction: "分析《访谈第 12 期》，整理完整章节并给我最值得发布的 Top 5",
    linked_asset_ids: [],
    long_form_action: {
      kind: "analyze",
      source_asset_id: 91,
    },
  });
  expect(payload).not.toHaveProperty("selected_product_id");
});
