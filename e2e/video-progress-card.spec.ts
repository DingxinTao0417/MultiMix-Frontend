import { expect, test, type Page, type Route } from "@playwright/test";

// Interface fixtures verify the real conversation UI without running providers.
const conversationId = "video-progress-card-e2e";
const jobId = "video-plan-progress-e2e";
const occurredAt = "2026-09-15T04:00:00Z";
const headers = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type,x-request-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "content-type": "application/json",
};
type Status = "running" | "completed" | "failed" | "cancelled";

async function installFixture(page: Page, initialStatus: Status = "running") {
  let status = initialStatus;
  const mutations: string[] = [];
  const events = () => [
    { key: "source_staging", label: "Provider 素材解析", detail: "内部细节", status: "completed", occurred_at: occurredAt },
    { key: "structuring_director_script", label: "LLM 编导结构化", detail: "技术日志", status: status === "running" ? "active" : "completed", occurred_at: occurredAt },
    { key: "global_choreography", label: "MG 动效检查", detail: "内部检查", status: status === "running" ? "active" : "completed", occurred_at: occurredAt },
  ];
  const job = () => ({
    id: jobId, status, progress_kind: "video_plan", result_asset_id: null,
    error_message: status === "failed" ? "视频方案准备失败，可以重试。" : null,
    created_at: occurredAt, updated_at: occurredAt, started_at: occurredAt,
    progress_events: events(),
  });
  const conversation = () => ({
    id: conversationId, title: "商家视频任务", status: "active", metadata: {},
    created_at: occurredAt, updated_at: occurredAt, products: [],
    messages: [{
      id: 9001, role: "assistant", text: status === "failed" ? job().error_message : "", asset_id: null,
      created_at: occurredAt,
      metadata: {
        asset_generation_job_id: jobId, asset_generation_status: status,
        asset_generation_progress_kind: "video_plan", asset_generation_progress: events(),
      },
    }],
  });
  await page.addInitScript(() => {
    localStorage.setItem("multimix_local_user", JSON.stringify({ email: "progress-e2e@multimix.local", token: "progress-e2e-token" }));
  });
  async function json(route: Route, body: unknown) {
    await route.fulfill({ status: 200, headers, body: JSON.stringify(body) });
  }
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers });
    } else if (request.method() === "POST" && pathname.endsWith(`/${jobId}/retry`)) {
      mutations.push(pathname);
      status = "running";
      await json(route, job());
    } else if (pathname === `/v1/assets/generation-jobs/${jobId}`) {
      await json(route, job());
    } else if (pathname === `/v1/assets/conversations/${conversationId}`) {
      await json(route, conversation());
    } else if (pathname === "/v1/assets/conversations/summaries") {
      await json(route, [conversation()]);
    } else {
      await json(route, []);
    }
  });
  return { setStatus: (next: Status) => { status = next; }, mutations };
}

for (const width of [1440, 390]) {
  test(`video plan progress stays compact and accessible at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await installFixture(page);
    await page.goto(`/app/assets?conversation=${conversationId}`);
    const card = page.locator(`[data-generation-job-id="${jobId}"]`);
    await expect(card.getByText("正在准备视频方案", { exact: true })).toBeVisible();
    await expect(card.getByRole("list")).toHaveCount(0);
    await expect(card.getByRole("button", { name: "停止生成" })).toBeVisible();
    await expect(card).not.toContainText(/Provider|LLM|MG|耗时|共.*步/);
    expect((await card.boundingBox())!.height).toBeLessThan(150);
    await card.screenshot({ path: testInfo.outputPath(`video-plan-${width}-collapsed.png`) });
    const toggle = card.getByRole("button", { name: "查看进度详情" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(card.getByRole("listitem")).toHaveCount(3);
    await expect(card.getByRole("button", { name: "收起进度详情" })).toHaveCSS("font-size", "11px");
    await expect(card.locator(".shadcn-prototype-video-task-progress-sr-only").first()).toHaveCSS("width", "1px");
    await expect(card.locator(".shadcn-prototype-agent-run-active").first()).toHaveCSS("animation-iteration-count", "1");
    await card.screenshot({ path: testInfo.outputPath(`video-plan-${width}-expanded.png`) });
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await expect(card.locator(".shadcn-prototype-agent-run-title-dot")).toHaveCSS("animation-name", "none");
    fixture.setStatus("completed");
    await expect(card.getByText("视频方案已准备好", { exact: true })).toBeVisible({ timeout: 12000 });
    await expect(card.getByRole("list")).toHaveCount(0);
    expect((await card.boundingBox())!.height).toBeLessThan(65);
    await card.screenshot({ path: testInfo.outputPath(`video-plan-${width}-completed.png`) });
    await card.getByRole("button", { name: "查看进度详情" }).click();
    await expect(card.getByRole("listitem")).toHaveCount(4);
    await page.reload();
    await expect(card).toHaveCount(1);
    await expect(card.getByText("视频方案已准备好", { exact: true })).toBeVisible();
    await expect(card.getByRole("list")).toHaveCount(0);
  });
}

test("failed video plan exposes its reason and original retry target while collapsed", async ({ page }, testInfo) => {
  const fixture = await installFixture(page, "failed");
  await page.goto(`/app/assets?conversation=${conversationId}`);
  const card = page.locator(`[data-generation-job-id="${jobId}"]`);
  await expect(card.getByText("视频方案未完成", { exact: true })).toBeVisible();
  await expect(card.getByText("视频方案准备失败，可以重试。", { exact: true })).toBeVisible();
  await expect(card.getByRole("list")).toHaveCount(0);
  await card.screenshot({ path: testInfo.outputPath("video-plan-failed.png") });
  await card.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => fixture.mutations).toEqual([`/v1/assets/generation-jobs/${jobId}/retry`]);
  await expect(card.getByText("正在准备视频方案", { exact: true })).toBeVisible();
  await expect(card.getByRole("list")).toHaveCount(0);
});

const videoProjectAsset = {
  id: 42, project_id: null, parent_asset_id: null, library_kind: "video", asset_kind: "video",
  content_type: "video_project", title: "上一稳定版本", status: "ready", source_type: "generated",
  generation_state: "video_project_ready", source_filename: null, source_content_type: null,
  original_ref: null, markdown_ref: null, content_hash: "sha256:video-progress-project", body: "视频工程",
  metadata: {
    capability: "video_project", capability_label: "视频工程", video_workflow_stage: "video_project_ready",
    video_project: { ratio: "9:16", duration_seconds: 30, timeline: { tracks: [], media: [] } },
  },
  source_mapping: [], linked_asset_ids: [], linked_event_ids: [], archived: false,
  error_message: null, created_at: occurredAt, updated_at: occurredAt, versions: [],
};

async function installVideoExecutionFixture(page: Page) {
  const executionJobId = "video-create-progress-e2e";
  let unavailable = false;
  let completed = false;
  const steps = () => [{
    key: "provider_voice_render", label: "Provider 配音与内部合成",
    status: completed ? "done" : "run", retry_job_id: null,
  }];
  const job = () => ({
    id: executionJobId, asset_id: 42, status: completed ? "completed" : "running",
    workflow_stage: completed ? "completed" : "rendering", steps: steps(), error_message: null,
    project: completed ? { ratio: "9:16" } : null,
    product_status: completed ? "completed" : "generating", product_completed: completed,
    failure_reason: null, failure_action: null, failure_scene_id: null,
    operation_status: null, operation_failure_reason: null, operation_failure_action: null,
    operation_failure_scene_id: null,
  });
  const conversation = {
    id: "video-create-conversation-e2e", title: "视频制作进度验收", status: "active", metadata: {},
    created_at: occurredAt, updated_at: occurredAt, products: [videoProjectAsset],
    messages: [{
      id: 9101, role: "assistant", text: "", asset_id: 42, created_at: occurredAt,
      metadata: {
        job_public_id: executionJobId, video_workflow_stage: "video_project_rendering",
        run_steps: [{ key: "provider_voice_render", label: "Provider 配音与内部合成", status: "run" }],
      },
    }],
  };
  await page.addInitScript(() => {
    localStorage.setItem("multimix_local_user", JSON.stringify({ email: "progress-e2e@multimix.local", token: "progress-e2e-token" }));
  });
  await page.route("**/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (pathname === `/v1/video/jobs/${executionJobId}`) {
      if (unavailable) return route.fulfill({ status: 503, headers, body: JSON.stringify({ detail: "temporary" }) });
      return route.fulfill({ status: 200, headers, body: JSON.stringify(job()) });
    }
    if (pathname === `/v1/assets/conversations/${conversation.id}`) {
      return route.fulfill({ status: 200, headers, body: JSON.stringify(conversation) });
    }
    if (pathname === "/v1/assets/conversations/summaries") {
      return route.fulfill({ status: 200, headers, body: JSON.stringify([conversation]) });
    }
    if (pathname === "/v1/assets/conversations") {
      return route.fulfill({ status: 200, headers, body: JSON.stringify([conversation]) });
    }
    return route.fulfill({ status: 200, headers, body: "[]" });
  });
  return {
    conversationId: conversation.id,
    setUnavailable: (value: boolean) => { unavailable = value; },
    setCompleted: () => { completed = true; },
  };
}

test("video creation keeps its real progress through disconnect and completion", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const fixture = await installVideoExecutionFixture(page);
  await page.goto(`/app/assets?conversation=${fixture.conversationId}`);
  const card = page.getByLabel("视频任务进度");
  await expect(card.getByText("正在制作视频", { exact: true })).toBeVisible();
  await expect(card).not.toContainText(/Provider|配音与内部合成|共.*步|耗时/);

  fixture.setUnavailable(true);
  await expect(card.getByText("暂时无法更新进度", { exact: true })).toBeVisible({ timeout: 10000 });
  await card.screenshot({ path: testInfo.outputPath("video-create-disconnected.png") });
  fixture.setUnavailable(false);
  await expect(card.getByText("正在制作视频", { exact: true })).toBeVisible({ timeout: 10000 });

  fixture.setCompleted();
  await expect(card.getByText("视频已做好", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(card.getByRole("list")).toHaveCount(0);
  await card.screenshot({ path: testInfo.outputPath("video-create-completed.png") });
});

test("failed video update stays compact while the stable version remains available", async ({ page }, testInfo) => {
  const conversation = {
    id: "video-update-conversation-e2e", title: "视频修改进度验收", status: "active", metadata: {},
    created_at: occurredAt, updated_at: occurredAt, products: [videoProjectAsset],
    messages: [{
      id: 9201, role: "assistant", text: "", asset_id: 42, created_at: occurredAt,
      metadata: {
        agent_action: {
          id: "video-update-action-e2e", status: "failed", requires_confirmation: false,
          confirmation_id: null, asset_id: 42, version_id: 2,
          message: "本次字幕调整失败，上一版本仍可使用。", retryable: false,
        },
        run_steps: [{ key: "internal_revision", label: "内部版本处理", status: "fail" }],
      },
    }],
  };
  await page.addInitScript(() => {
    localStorage.setItem("multimix_local_user", JSON.stringify({ email: "progress-e2e@multimix.local", token: "progress-e2e-token" }));
  });
  await page.route("**/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (pathname === `/v1/assets/conversations/${conversation.id}`) {
      return route.fulfill({ status: 200, headers, body: JSON.stringify(conversation) });
    }
    if (pathname === "/v1/assets/conversations/summaries") {
      return route.fulfill({ status: 200, headers, body: JSON.stringify([conversation]) });
    }
    return route.fulfill({ status: 200, headers, body: "[]" });
  });
  await page.goto(`/app/assets?conversation=${conversation.id}`);
  const card = page.getByLabel("视频任务进度");
  await expect(card.getByText("本次修改未完成", { exact: true })).toBeVisible();
  await expect(card.getByText("本次字幕调整失败，上一版本仍可使用。", { exact: true })).toBeVisible();
  await expect(page.getByText("上一稳定版本", { exact: true }).first()).toBeVisible();
  await expect(card).not.toContainText("内部版本处理");
  await expect(card.getByRole("button", { name: "重试" })).toHaveCount(0);
  await card.screenshot({ path: testInfo.outputPath("video-update-failed.png") });
});
