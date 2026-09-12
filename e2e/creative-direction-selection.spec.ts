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
  body: [
    "# 产品介绍",
    "## 方案摘要",
    "这是已经按推荐方向生成的编导稿，用于验证长正文仍与创意方向卡片保持清晰分隔。",
    ...Array.from({ length: 10 }, (_, index) => [
      `## ${index + 1}. 分镜段落`,
      "- 口播：围绕产品价值展开完整说明",
      "- 画面：使用已保存素材呈现产品细节与使用场景",
      "- 节奏：保持信息清晰、段落连续且正文可滚动",
    ].join("\n")),
  ].join("\n\n"),
  metadata: {
    capability: "video_script",
    capability_label: "编导文稿",
    video_workflow_stage: "director_script_draft",
    video_plan: {
      video_type: "explainer",
      creative_profile: {
        schema_version: "video_creative_profile:v1",
        task_mode: "create",
        content_goal: "promote",
        style_profile: "ugc_native",
        production_mode: "hybrid",
        anchor_source: null,
        preserve_source_audio: false,
        cost_priority: "balanced",
        latency_priority: "standard",
      },
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
  messages: [{
    id: 1,
    role: "assistant",
    text: "编导稿已经按当前方向生成，请确认逐镜方案。",
    asset_id: product.id,
    metadata: {
      plan: {
        kind: "video_project_confirmation",
        title: "视频方案",
        status: "pending",
        fields: [
          {
            key: "creative_profile",
            label: "内容方向",
            value: "从头创作 · 推广 · UGC 原生 · 混合制作 · UGC 表达 + 品牌质感",
          },
          {
            key: "production_mix",
            label: "计划构成",
            value: "1 段已保存素材 · 1 段生成镜头 · 1 段图形画面 · 配音与音乐",
          },
        ],
        confirm_label: "确认，生成视频工程",
        confirm_utterance: "确认，生成视频工程",
        adjust_label: "调整方向",
      },
    },
    created_at: createdAt,
  }],
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
}

async function installFixtureApi(page: Page, { withConfirmation = true } = {}) {
  const fixtureConversation = withConfirmation
    ? conversation
    : { ...conversation, messages: [] };
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
      await fulfillJson(route, fixtureConversation);
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets") {
      await fulfillJson(route, []);
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/assets/conversations/messages") {
      await fulfillJson(route, {
        conversation_id: conversation.id,
        conversation: fixtureConversation,
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

async function expectDirectionPanelSeparatedFromDocument(page: Page) {
  const selector = page.getByRole("region", { name: "创意方向" });
  const document = page.locator(".shadcn-prototype-copy-document");
  const reason = selector.getByText(/推荐理由：/);
  const [selectorBox, documentBox, reasonBox, panelLayout] = await Promise.all([
    selector.boundingBox(),
    document.boundingBox(),
    reason.boundingBox(),
    selector.evaluate((element) => ({
      clientHeight: element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
    })),
  ]);

  expect(selectorBox).not.toBeNull();
  expect(documentBox).not.toBeNull();
  expect(reasonBox).not.toBeNull();
  expect(panelLayout.clientHeight).toBeGreaterThan(0);
  expect(panelLayout.overflowY).toBe("auto");
  expect(selectorBox!.y + selectorBox!.height).toBeLessThanOrEqual(documentBox!.y + 1);
  expect(reasonBox!.y + reasonBox!.height).toBeLessThanOrEqual(documentBox!.y + 1);
}

test("video plan confirmation presents correctable content direction and planned composition", async ({ page }) => {
  await installFixtureApi(page);
  await page.goto(`/app/assets?conversation=${conversationId}`);

  const confirmation = page.getByLabel("视频方案 · 待确认");
  await expect(confirmation).toBeVisible();
  await expect(confirmation).toContainText("内容方向");
  await expect(confirmation).toContainText("UGC 表达 + 品牌质感");
  await expect(confirmation).toContainText("计划构成");
  await expect(confirmation).toContainText("1 段已保存素材 · 1 段生成镜头 · 1 段图形画面 · 配音与音乐");
  await confirmation.getByRole("button", { name: "调整方向" }).click();
  await expect(page.getByLabel("输入对话内容")).toBeFocused();
  await expect(page.getByLabel("输入对话内容")).toHaveAttribute(
    "placeholder",
    "说说想怎么调整，比如换个开场、缩短时长、改用某个素材…",
  );
});

test("creative directions stay optional until a user explicitly applies one", async ({ page }) => {
  await installFixtureApi(page, { withConfirmation: false });
  await page.goto(`/app/assets?conversation=${conversationId}`);

  const selector = page.getByRole("region", { name: "创意方向" });
  await expect(selector).toBeVisible();
  await expect(selector.getByText("结果先行", { exact: true })).toBeVisible();
  await expect(selector.getByText("问题推进", { exact: true })).toHaveCount(0);
  await expectDirectionPanelSeparatedFromDocument(page);

  let submissionCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/v1/assets/conversations/messages")) {
      submissionCount += 1;
    }
  });
  await selector.getByRole("button", { name: "查看其他方向" }).click();
  await expect(selector.getByText("问题推进", { exact: true })).toBeVisible();
  const [expandedSelectorBox, expandedDocumentBox] = await Promise.all([
    selector.boundingBox(),
    page.locator(".shadcn-prototype-copy-document").boundingBox(),
  ]);
  expect(expandedSelectorBox).not.toBeNull();
  expect(expandedDocumentBox).not.toBeNull();
  expect(expandedSelectorBox!.y + expandedSelectorBox!.height).toBeLessThanOrEqual(expandedDocumentBox!.y + 1);
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
