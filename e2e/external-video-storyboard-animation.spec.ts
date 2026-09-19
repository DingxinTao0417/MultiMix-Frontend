import { expect, test, type Page, type Route } from "@playwright/test";

const videoAsset = {
  id: 71,
  project_id: null,
  parent_asset_id: null,
  library_kind: "video",
  asset_kind: "video",
  content_type: "uploaded_video",
  title: "门店实拍视频",
  status: "ready",
  source_type: "upload",
  generation_state: "source_ready",
  source_filename: "store.mp4",
  source_content_type: "video/mp4",
  original_ref: null,
  markdown_ref: null,
  content_hash: "sha256:e2e-source",
  body: "",
  metadata: {
    preview_url: "https://media.example.invalid/store.mp4",
    thumbnail_url: "https://media.example.invalid/store.jpg",
    understanding: { status: "ready", summary: "门店空间与产品展示" },
  },
  source_mapping: [],
  linked_asset_ids: [],
  linked_event_ids: [],
  archived: false,
  error_message: null,
  created_at: "2026-09-19T00:00:00Z",
  updated_at: "2026-09-19T00:00:00Z",
  versions: [],
};

const storyboard = {
  schema_version: "external_video_storyboard_v1",
  status: "ready",
  source_asset_id: 71,
  storyboard_fingerprint: "sha256:browser-ready",
  duration_seconds: 10,
  scene_count: 2,
  scenes: [
    { scene_id: "scene_001", ordinal: 1, start_seconds: 0, end_seconds: 5, duration_seconds: 5, title: "开场", description: "门店展示", confidence: 0.9, status: "ready", preview_url: "/v1/assets/files/1" },
    { scene_id: "scene_002", ordinal: 2, start_seconds: 5, end_seconds: 10, duration_seconds: 5, title: "产品", description: "产品特写", confidence: 0.9, status: "ready", preview_url: "/v1/assets/files/1" },
  ],
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

async function installFixtureApi(page: Page, options: { storyboardAvailable?: boolean } = {}) {
  const state = {
    jobExists: false,
    jobStatus: "queued",
    animatePosts: 0,
    storyboardAvailable: options.storyboardAvailable ?? true,
    storyboardJobExists: false,
    storyboardJobStatus: "queued",
    storyboardJobStage: "queued",
    storyboardPosts: 0,
  };
  await page.addInitScript(() => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({
      email: "external-video-e2e@multimix.local",
      token: "external-video-e2e-token",
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
      await fulfillJson(route, url.searchParams.get("library_kind") === "video" ? [videoAsset] : []);
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets/71/storyboard") {
      await fulfillJson(
        route,
        state.storyboardAvailable ? storyboard : { detail: "storyboard unavailable" },
        state.storyboardAvailable ? 200 : 409,
      );
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets/71/storyboard/jobs/latest") {
      if (!state.storyboardJobExists) {
        await fulfillJson(route, { detail: "Storyboard job not found" }, 404);
        return;
      }
      await fulfillJson(route, storyboardJob(state));
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/assets/71/storyboard") {
      state.storyboardPosts += 1;
      state.storyboardJobExists = true;
      state.storyboardJobStatus = "running";
      state.storyboardJobStage = "reading_source";
      await fulfillJson(route, storyboardJob({
        ...state,
        storyboardJobStatus: "queued",
        storyboardJobStage: "queued",
      }), 202);
      return;
    }
    if (
      request.method() === "GET"
      && url.pathname === "/v1/assets/71/storyboard/jobs/storyboard-job-1"
    ) {
      await fulfillJson(route, storyboardJob(state));
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets/71/storyboard/animate/latest") {
      if (!state.jobExists) {
        await fulfillJson(route, { detail: "Animation job not found" }, 404);
        return;
      }
      await fulfillJson(route, animationJob(state.jobStatus));
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/assets/71/storyboard/animate") {
      state.animatePosts += 1;
      state.jobExists = true;
      state.jobStatus = "running";
      await fulfillJson(route, animationJob("queued"));
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets/71/storyboard/animate/animation-job-1") {
      await fulfillJson(route, animationJob(state.jobStatus));
      return;
    }
    if (url.pathname.startsWith("/v1/assets/files/")) {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    await fulfillJson(route, []);
  });
  return state;
}

function animationJob(status: string) {
  return {
    job_id: "animation-job-1",
    status,
    scene_id: "scene_002",
    style: "generative_animation_v1",
    result_asset_id: status === "completed" ? 72 : null,
    generation: status === "completed"
      ? { estimated_standard_cost_cny: 2.25, billed_seconds: 15 }
      : null,
    error_code: null,
    message: null,
  };
}

function storyboardJob(state: {
  storyboardJobStatus: string;
  storyboardJobStage: string;
  storyboardAvailable: boolean;
}) {
  return {
    job_id: "storyboard-job-1",
    status: state.storyboardJobStatus,
    stage: state.storyboardJobStage,
    retryable: false,
    message: null,
    error_code: null,
    storyboard: state.storyboardJobStatus === "completed" ? storyboard : null,
    follow_up_status: null,
    animation_job_id: null,
    animation_job_status: null,
  };
}

async function openVideoDetails(page: Page) {
  await page.locator(".shadcn-prototype-nav").getByRole("button", { name: "视频库", exact: true }).click();
  await page.getByRole("button", { name: /门店实拍视频/ }).click();
  return page.getByRole("dialog", { name: "门店实拍视频详情" });
}

test("AI animation survives refresh and resumes the same job without resubmitting", async ({ page }) => {
  const state = await installFixtureApi(page);
  await page.goto("/app/assets?view=video");
  let dialog = await openVideoDetails(page);
  await expect(dialog.getByText("02 · 产品")).toBeVisible();

  await dialog.getByRole("button", { name: "为第 2 镜生成 AI 动画" }).click();
  await expect(dialog.getByRole("status")).toContainText("第 2 镜 AI 动画正在生成");
  expect(state.animatePosts).toBe(1);

  await page.reload();
  dialog = await openVideoDetails(page);
  await expect(dialog.getByRole("status")).toContainText("第 2 镜 AI 动画正在生成");
  expect(state.animatePosts).toBe(1);

  state.jobStatus = "completed";
  await expect(dialog.getByRole("status")).toContainText(
    "AI 动画已保存到视频库，视频生成预计 ¥2.25，关键帧费用按图片模型账单计。",
    { timeout: 8_000 },
  );
  expect(state.animatePosts).toBe(1);
});

test("automatic storyboard survives refresh and reuses the same analysis job", async ({ page }) => {
  const state = await installFixtureApi(page, { storyboardAvailable: false });
  await page.goto("/app/assets?view=video");
  let dialog = await openVideoDetails(page);

  await dialog.getByRole("button", { name: "识别这条视频的分镜" }).click();
  await expect(dialog.getByRole("status")).toContainText("正在读取视频素材");
  expect(state.storyboardPosts).toBe(1);

  await page.reload();
  dialog = await openVideoDetails(page);
  await expect(dialog.getByRole("status")).toContainText("正在读取视频素材");
  expect(state.storyboardPosts).toBe(1);

  state.storyboardJobStatus = "completed";
  state.storyboardJobStage = "done";
  state.storyboardAvailable = true;
  await expect(dialog.getByText("02 · 产品")).toBeVisible({ timeout: 8_000 });
  expect(state.storyboardPosts).toBe(1);
});
