import { expect, test, type Page, type Route } from "@playwright/test";

const conversationId = "conversation-card-order-e2e";
const screenshotPath = process.env.CARD_ORDER_E2E_SCREENSHOT;

const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type,x-request-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "content-type": "application/json",
};

const product = {
  id: 42,
  project_id: null,
  parent_asset_id: null,
  library_kind: "copy",
  asset_kind: "video",
  content_type: "video_script",
  title: "daniel-vertical-english · 口播清理",
  status: "draft",
  source_type: "generated",
  generation_state: "director_script_draft",
  source_filename: null,
  source_content_type: null,
  original_ref: null,
  markdown_ref: null,
  content_hash: "sha256:card-order-e2e",
  body: "# 口播清理\n\n保留自然表达，清理重复口癖。",
  metadata: {
    capability: "video_script",
    capability_label: "编导文稿",
    video_workflow_stage: "director_script_draft",
  },
  source_mapping: [],
  linked_asset_ids: [],
  linked_event_ids: [],
  archived: false,
  error_message: null,
  created_at: "2026-08-26T03:00:00Z",
  updated_at: "2026-08-26T03:00:00Z",
  versions: [],
};

const conversation = {
  id: conversationId,
  title: "卡片顺序验收",
  status: "active",
  metadata: {},
  created_at: "2026-08-26T02:00:00Z",
  updated_at: "2026-08-26T04:00:00Z",
  products: [product],
  messages: [
    {
      id: 101,
      role: "assistant",
      text: "内容生成失败",
      asset_id: null,
      metadata: {
        asset_generation_job_id: "job-old-failed",
        asset_generation_status: "failed",
      },
      created_at: "2026-08-26T02:10:00Z",
    },
    {
      id: 102,
      role: "user",
      text: "先讨论一下清理尺度",
      asset_id: null,
      metadata: {},
      created_at: "2026-08-26T02:20:00Z",
    },
    {
      id: 103,
      role: "assistant",
      text: "建议先保留自然停顿，只处理明显重复。",
      asset_id: null,
      metadata: {},
      created_at: "2026-08-26T02:21:00Z",
    },
    {
      id: 104,
      role: "assistant",
      text: "编导脚本已生成，可确认或修改。",
      asset_id: 42,
      metadata: {
        asset_generation_job_id: "job-result-completed",
        asset_generation_status: "completed",
        product_id: 42,
        suggestions: ["确认默认清理", "再保守一点", "保留所有口癖"],
      },
      created_at: "2026-08-26T03:00:00Z",
    },
    {
      id: 105,
      role: "assistant",
      text: "内容生成任务已重新进入队列。",
      asset_id: null,
      metadata: {
        asset_generation_job_id: "job-new-queued",
        asset_generation_status: "queued",
      },
      created_at: "2026-08-26T04:00:00Z",
    },
  ],
};

const readyVideoProject = {
  ...product,
  id: 43,
  library_kind: "video",
  content_type: "video_project",
  title: "daniel-vertical-english · 视频工程",
  status: "ready",
  generation_state: "video_project_ready",
  content_hash: "sha256:card-order-ready-video-project",
  body: "视频工程已生成，可立即编辑。",
  metadata: {
    capability: "video_project",
    capability_label: "视频工程",
    orchestration_pending: false,
    video_workflow_stage: "video_project_ready",
    director_script_asset_id: 42,
    video_project: {
      ratio: "9:16",
      duration_seconds: 30,
      timeline: { tracks: [], media: [] },
    },
  },
};

const postConfirmationConversation = {
  ...conversation,
  id: "conversation-confirmation-final-state-e2e",
  title: "口播确认最终状态验收",
  products: [
    product,
    readyVideoProject,
    {
      ...product,
      id: 44,
      title: "不应出现在末尾的旧编导稿",
      content_hash: "sha256:card-order-orphaned-director-script",
    },
  ],
  messages: [
    {
      id: 201,
      role: "assistant",
      text: "口播清理已确认。",
      asset_id: 41,
      metadata: {
        plan: {
          kind: "presenter_cleanup_confirmation",
          title: "口播清理方案",
          status: "confirmed",
          fields: [{ key: "source_edit", label: "原话与删剪", value: "保留 30 秒" }],
          confirm_label: "确认推荐方案",
          adjust_label: "换个方向",
        },
        suggestions: ["确认推荐方案", "换个方向", "调整包装强度"],
        suggestion_actions: [
          {
            id: "stale-confirm",
            label: "确认推荐方案",
            utterance: "确认推荐方案",
            action_type: "submit_message",
            enabled: true,
          },
          {
            id: "stale-direction",
            label: "换个方向",
            utterance: "换个方向",
            action_type: "fill_composer",
            enabled: true,
          },
          {
            id: "stale-packaging",
            label: "调整包装强度",
            utterance: "调整包装强度",
            action_type: "fill_composer",
            enabled: true,
          },
        ],
      },
      created_at: "2026-08-26T04:10:00Z",
    },
    {
      id: 202,
      role: "assistant",
      text: "编导脚本已生成，可确认或修改。",
      asset_id: 42,
      metadata: {
        asset_generation_job_id: "job-result-completed",
        asset_generation_status: "completed",
        product_id: 42,
      },
      created_at: "2026-08-26T04:20:00Z",
    },
    {
      id: 203,
      role: "assistant",
      text: "视频工程已生成，可立即编辑。",
      asset_id: 43,
      metadata: { product_id: 43 },
      created_at: "2026-08-26T04:30:00Z",
    },
  ],
};

const jobs = {
  "job-old-failed": {
    id: "job-old-failed",
    status: "failed",
    result_asset_id: null,
    error_message: "内容生成失败",
    created_at: "2026-08-26T02:10:00Z",
    updated_at: "2026-08-26T02:11:00Z",
    started_at: "2026-08-26T02:10:10Z",
    progress_events: [],
  },
  "job-new-queued": {
    id: "job-new-queued",
    status: "queued",
    result_asset_id: null,
    error_message: null,
    created_at: "2026-08-26T04:00:00Z",
    updated_at: "2026-08-26T04:00:00Z",
    started_at: null,
    progress_events: [],
  },
  "job-result-completed": {
    id: "job-result-completed",
    status: "completed",
    result_asset_id: 42,
    error_message: null,
    created_at: "2026-08-26T03:00:00Z",
    updated_at: "2026-08-26T03:01:00Z",
    started_at: "2026-08-26T03:00:05Z",
    progress_events: [],
  },
} as const;

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
}

type FixtureConversation = {
  id: string;
  title: string;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  products: unknown[];
  messages: unknown[];
};

async function installFixtureApi(
  page: Page,
  fixtureConversation: FixtureConversation = conversation,
) {
  await page.addInitScript(() => {
    const user = {
      id: "00000000-0000-4000-8000-000000000042",
      aud: "authenticated",
      role: "authenticated",
      email: "browser-e2e@multimix.local",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-08-26T00:00:00Z",
    };
    const session = {
      access_token: "browser-e2e-token",
      refresh_token: "browser-e2e-refresh-token",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      user,
    };
    window.localStorage.setItem("multimix_local_user", JSON.stringify({
      email: user.email,
      token: session.access_token,
    }));
    // The local frontend currently uses Supabase auth. Seed its persisted
    // session too so this isolated fixture does not fall back to the login UI.
    window.localStorage.setItem(
      "sb-mmangqstpsbkfaruwbgs-auth-token",
      JSON.stringify(session),
    );
  });
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets/conversations/summaries") {
      await fulfillJson(route, [{
        id: fixtureConversation.id,
        title: fixtureConversation.title,
        status: fixtureConversation.status,
        metadata: {},
        created_at: fixtureConversation.created_at,
        updated_at: fixtureConversation.updated_at,
      }]);
      return;
    }
    if (request.method() === "GET" && url.pathname === `/v1/assets/conversations/${fixtureConversation.id}`) {
      await fulfillJson(route, fixtureConversation);
      return;
    }
    if (request.method() === "GET" && url.pathname.startsWith("/v1/assets/generation-jobs/")) {
      const jobId = url.pathname.split("/").at(-1) as keyof typeof jobs;
      await fulfillJson(route, jobs[jobId] ?? {}, jobs[jobId] ? 200 : 404);
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets") {
      await fulfillJson(route, []);
      return;
    }
    await fulfillJson(route, []);
  });
}

async function expectStableCardOrder(page: Page) {
  const thread = page.getByRole("region", { name: "Content generation conversation" });
  await expect(thread).toBeVisible();
  await expect(thread.locator('[data-generation-job-id="job-old-failed"]')).toBeVisible();
  await expect(thread.locator('[data-generation-job-id="job-new-queued"]')).toBeVisible();

  const order = await thread.locator(".shadcn-prototype-message-group").evaluateAll((groups) => ({
    failed: groups.findIndex((group) => group.querySelector('[data-generation-job-id="job-old-failed"]')),
    discussion: groups.findIndex((group) => group.textContent?.includes("先讨论一下清理尺度")),
    retry: groups.findIndex((group) => group.querySelector('[data-generation-job-id="job-new-queued"]')),
  }));
  expect(order.failed).toBeLessThan(order.discussion);
  expect(order.discussion).toBeLessThan(order.retry);

  await expect(thread.locator("article > p", { hasText: "内容生成任务已重新进入队列。" })).toHaveCount(0);
  const completedArticle = thread.locator('[data-generation-job-id="job-result-completed"]').locator("xpath=ancestor::article");
  await expect(completedArticle).toHaveCSS("display", "grid");
  await expect(completedArticle).toHaveCSS("gap", "14px");
  const explanation = completedArticle.getByText("编导脚本已生成，可确认或修改。", { exact: true });
  const completedCard = completedArticle.locator('[data-generation-job-id="job-result-completed"]');
  const [explanationBox, completedCardBox] = await Promise.all([
    explanation.boundingBox(),
    completedCard.boundingBox(),
  ]);
  expect(explanationBox).not.toBeNull();
  expect(completedCardBox).not.toBeNull();
  expect(completedCardBox!.y - (explanationBox!.y + explanationBox!.height)).toBeGreaterThanOrEqual(13.5);

  const productTitle = thread.getByText("daniel-vertical-english · 口播清理", { exact: true });
  const suggestion = thread.getByRole("button", { name: "确认默认清理" });
  await expect(productTitle).toBeVisible();
  await expect(suggestion).toBeVisible();
  expect(await productTitle.evaluate((productNode) => {
    const suggestionNode = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent?.trim() === "确认默认清理");
    return Boolean(
      suggestionNode
      && productNode.compareDocumentPosition(suggestionNode) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  })).toBe(true);
}

test("generation cards stay ordered, avoid duplicate copy, and keep suggestions last after reload", async ({ page }) => {
  await installFixtureApi(page);
  await page.goto(`/app/assets?conversation=${conversationId}`);
  await expectStableCardOrder(page);

  await page.reload();
  await expectStableCardOrder(page);

  if (screenshotPath) {
    await page.locator('[data-generation-job-id="job-result-completed"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath, fullPage: true });
  }
});

async function expectFinalPresenterState(page: Page) {
  const thread = page.getByRole("region", { name: "Content generation conversation" });
  await expect(thread).toBeVisible();
  await expect(thread.getByText("口播清理已确认。", { exact: true })).toBeVisible();
  await expect(thread.getByRole("button", { name: "确认推荐方案" })).toHaveCount(0);
  await expect(thread.getByRole("button", { name: "换个方向" })).toHaveCount(0);
  await expect(thread.getByRole("button", { name: "调整包装强度" })).toHaveCount(0);
  const directorJob = thread.locator('[data-generation-job-id="job-result-completed"]');
  await expect(directorJob.getByRole("button", { name: /编导稿已确认，已用于生成视频工程/ })).toBeVisible();
  await expect(directorJob.getByText("编导脚本已生成，可确认或修改", { exact: true })).toHaveCount(0);
  await expect(thread.getByText("不应出现在末尾的旧编导稿", { exact: true })).toHaveCount(0);
  await expect(thread.getByText("视频工程已生成，可立即编辑。", { exact: true })).toBeVisible();
}

test("confirmed Presenter cleanup stays closed after a ready video project is reloaded", async ({ page }) => {
  await installFixtureApi(page, postConfirmationConversation);
  await page.goto(`/app/assets?conversation=${postConfirmationConversation.id}`);
  await expectFinalPresenterState(page);

  await page.reload();
  await expectFinalPresenterState(page);
});
