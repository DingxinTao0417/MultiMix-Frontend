import { expect, test, type Page, type Route } from "@playwright/test";

const conversationId = "creative-direction-selection-e2e";
const fingerprint = `sha256:${"a".repeat(64)}`;
const createdAt = "2026-09-01T04:00:00Z";

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
  title: "产品介绍 · 编导稿",
  status: "draft",
  source_type: "generated",
  generation_state: "director_script_draft",
  source_filename: null,
  source_content_type: null,
  original_ref: null,
  markdown_ref: null,
  content_hash: "sha256:creative-direction-e2e",
  body: "# 产品介绍\n\n这是已经按推荐方向生成的编导稿。",
  metadata: {
    capability: "video_script",
    capability_label: "编导文稿",
    video_workflow_stage: "director_script_draft",
    video_plan: {
      video_type: "explainer",
      creative_direction: {
        schema_version: "creative_direction:v1",
        fingerprint,
        candidate_count_reason: "当前输入中两个方向都足够明确且有真实差异。",
        candidates: [
          {
            id: "direction-a",
            angle: "结果先行",
            hook: "先看结果",
            narrative_structure: ["结果", "过程", "行动"],
            visual_language: "结果对比与产品过程",
            asset_strategy: "优先使用已保存素材",
            audio_direction: "紧凑可信",
            evidence_strategy: "展示可核验流程",
            difference_axes: ["hook"],
          },
          {
            id: "direction-b",
            angle: "问题推进",
            hook: "先说问题",
            narrative_structure: ["问题", "方法", "结果"],
            visual_language: "问题场景与步骤演示",
            asset_strategy: "优先使用已保存素材",
            audio_direction: "渐进有推动感",
            evidence_strategy: "展示步骤与结果",
            difference_axes: ["narrative_structure"],
          },
        ],
        recommended_id: "direction-a",
        selected_id: "direction-a",
        selection_reason: "结果先行更匹配当前目标。",
        selection_source: "model_recommended",
        locked_by_user: false,
      },
    },
  },
  source_mapping: [],
  linked_asset_ids: [],
  linked_event_ids: [],
  archived: false,
  error_message: null,
  created_at: createdAt,
  updated_at: createdAt,
  versions: [],
};

const conversation = {
  id: conversationId,
  title: "创意方向选择验收",
  status: "active",
  metadata: {},
  created_at: createdAt,
  updated_at: createdAt,
  products: [product],
  messages: [],
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
}

async function installFixtureApi(page: Page) {
  await page.addInitScript(() => {
    const user = {
      id: "00000000-0000-4000-8000-000000000042",
      aud: "authenticated",
      role: "authenticated",
      email: "browser-e2e@multimix.local",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-09-01T00:00:00Z",
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
        id: conversation.id,
        title: conversation.title,
        status: conversation.status,
        metadata: {},
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
      }]);
      return;
    }
    if (request.method() === "GET" && url.pathname === `/v1/assets/conversations/${conversation.id}`) {
      await fulfillJson(route, conversation);
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets") {
      await fulfillJson(route, []);
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/assets/conversations/messages") {
      await fulfillJson(route, {
        conversation_id: conversation.id,
        conversation,
        user_message: "应用此方向",
        assistant_message: "内容生成任务已进入队列，完成后会自动更新当前对话。",
        intent: { operation: "revise" },
        suggestions: [],
        product: null,
        generation_job: {
          id: "creative-direction-job",
          status: "completed",
          result_asset_id: product.id,
          error_message: null,
          created_at: createdAt,
          updated_at: createdAt,
        },
      }, 202);
      return;
    }
    await fulfillJson(route, []);
  });
}

test("creative directions stay optional until a user explicitly applies one", async ({ page }) => {
  await installFixtureApi(page);
  await page.goto(`/app/assets?conversation=${conversationId}`);

  const selector = page.getByRole("region", { name: "创意方向" });
  await expect(selector).toBeVisible();
  await expect(selector.getByText("结果先行", { exact: true })).toBeVisible();
  await expect(selector.getByText("问题推进", { exact: true })).toHaveCount(0);

  let submissionCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/v1/assets/conversations/messages")) {
      submissionCount += 1;
    }
  });
  await selector.getByRole("button", { name: "查看其他方向" }).click();
  await expect(selector.getByText("问题推进", { exact: true })).toBeVisible();
  expect(submissionCount).toBe(0);

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === "POST"
    && response.url().endsWith("/v1/assets/conversations/messages")
  ));
  await selector.getByRole("button", { name: "应用“问题推进”方向" }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const payload = response.request().postDataJSON() as Record<string, unknown>;
  expect(payload).toMatchObject({
    conversation_id: conversationId,
    instruction: "应用此方向",
    selected_product_id: product.id,
    creative_direction_selection: {
      candidate_id: "direction-b",
      creative_direction_fingerprint: fingerprint,
    },
  });
  expect(submissionCount).toBe(1);
  await expect(selector.getByRole("status")).toHaveText("已提交，正在重排编导稿。");
});
