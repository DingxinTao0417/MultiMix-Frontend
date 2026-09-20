import { expect, test, type Page, type Route } from "@playwright/test";

const conversationId = "external-video-conversation-comfort-e2e";
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization,content-type,x-request-id",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "content-type": "application/json",
};

const conversation = {
  id: conversationId,
  title: "外部视频对话体验验收",
  status: "active",
  metadata: {},
  created_at: "2026-09-20T00:00:00Z",
  updated_at: "2026-09-20T00:10:00Z",
  products: [],
  messages: [
    {
      id: 1,
      role: "user",
      text: "我上传了一条视频，请先询问我是否识别并拆分分镜，暂不开始处理。",
      asset_id: null,
      metadata: {},
      created_at: "2026-09-20T00:01:00Z",
    },
    {
      id: 2,
      role: "assistant",
      text: "要先识别并拆分这条视频的分镜吗？识别后可以按第 1 镜、第 2 镜逐段修改。",
      asset_id: null,
      metadata: {
        intent: {
          capability: "external_video_storyboard",
          operation: "offer_storyboard",
          source_asset_id: 71,
        },
        suggestion_actions: [
          {
            id: "external-video-storyboard-confirm",
            label: "识别并拆分分镜",
            utterance: "识别并拆分分镜",
            action_type: "submit_message",
            enabled: true,
          },
          {
            id: "external-video-storyboard-decline",
            label: "暂不识别",
            utterance: "暂不识别",
            action_type: "submit_message",
            enabled: true,
          },
        ],
      },
      created_at: "2026-09-20T00:02:00Z",
    },
    {
      id: 3,
      role: "user",
      text: "识别并拆分分镜",
      asset_id: null,
      metadata: {},
      created_at: "2026-09-20T00:03:00Z",
    },
    {
      id: 4,
      role: "assistant",
      text: "已开始识别并拆分视频分镜。下面会持续显示读取和识别进度。",
      asset_id: null,
      metadata: {
        intent: {
          capability: "external_video_storyboard",
          operation: "analyze_storyboard",
          source_asset_id: 71,
          job_id: "storyboard-job-1",
        },
      },
      created_at: "2026-09-20T00:04:00Z",
    },
    {
      id: 5,
      role: "user",
      text: "把靠后的产品片段改成动画",
      asset_id: null,
      metadata: {},
      created_at: "2026-09-20T00:05:00Z",
    },
    {
      id: 6,
      role: "assistant",
      text: "我已经自动拆分出 6 个分镜。当前边界需要确认，确认后再执行动画生成，避免改错片段。",
      asset_id: null,
      metadata: {
        intent: {
          capability: "external_video_animation",
          operation: "confirm_storyboard",
          source_asset_id: 71,
          scene_ordinal: 5,
          storyboard_fingerprint: "sha256:proposed",
        },
      },
      created_at: "2026-09-20T00:06:00Z",
    },
  ],
};

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, headers: corsHeaders, body: JSON.stringify(body) });
}

async function installFixtureApi(page: Page) {
  const postedInstructions: string[] = [];
  let confirmationPosts = 0;
  await page.addInitScript(() => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({
      email: "external-video-conversation-e2e@multimix.local",
      token: "external-video-conversation-e2e-token",
    }));
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
    if (
      request.method() === "GET"
      && url.pathname === "/v1/assets/71/storyboard/jobs/storyboard-job-1"
    ) {
      await fulfillJson(route, {
        job_id: "storyboard-job-1",
        status: "completed",
        stage: "done",
        retryable: false,
        message: null,
        error_code: null,
        storyboard: {
          schema_version: "external_video_storyboard_v1",
          status: "needs_review",
          source_asset_id: 71,
          storyboard_fingerprint: "sha256:proposed",
          duration_seconds: 18,
          scene_count: 6,
          scenes: [],
        },
        follow_up_status: null,
        animation_job_id: null,
        animation_job_status: null,
      });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/assets/71/storyboard/confirm") {
      confirmationPosts += 1;
      await fulfillJson(route, {
        schema_version: "external_video_storyboard_v1",
        status: "ready",
        source_asset_id: 71,
        storyboard_fingerprint: "sha256:confirmed",
        duration_seconds: 18,
        scene_count: 6,
        scenes: [],
      });
      return;
    }
    if (request.method() === "POST" && url.pathname === "/v1/assets/conversations/messages") {
      const body = request.postDataJSON() as { instruction?: string };
      postedInstructions.push(body.instruction ?? "");
      await fulfillJson(route, {
        conversation_id: conversation.id,
        conversation,
        product: null,
        generation_job: null,
        agent_action: null,
        requirement_snapshot: null,
      });
      return;
    }
    if (request.method() === "GET" && url.pathname === "/v1/assets") {
      await fulfillJson(route, []);
      return;
    }
    await fulfillJson(route, []);
  });
  return {
    postedInstructions,
    confirmationPosts: () => confirmationPosts,
  };
}

test("external video conversation stays natural and resumes the pending edit after confirmation", async ({ page }) => {
  const state = await installFixtureApi(page);
  await page.goto(`/app/assets?conversation=${conversationId}`);
  const thread = page.getByRole("region", { name: "Content generation conversation" });

  await expect(thread.getByText("我上传了一条视频。", { exact: true })).toBeVisible();
  await expect(thread.getByText(/请先询问我是否/)).toHaveCount(0);
  await expect(thread.getByText(/第 1 镜、第 2 镜/)).toHaveCount(0);
  await expect(thread.getByRole("button", { name: "帮我整理视频" })).toBeVisible();
  await expect(thread.getByRole("button", { name: "先不用" })).toBeVisible();

  const progress = thread.getByLabel("视频整理进度");
  await expect(progress).toContainText("已整理为 6 个片段");
  await expect(progress).not.toContainText("接下来");
  await expect(thread.getByText("视频已经整理好了，共 6 个片段。接下来，告诉我想调整哪一部分就可以。"))
    .toBeVisible();

  await expect(thread.getByText("片段已经整理出来了。确认后，我会继续刚才的修改。"))
    .toBeVisible();
  await thread.getByRole("button", { name: "确认片段并继续" }).click();
  await expect.poll(() => state.confirmationPosts()).toBe(1);
  await expect.poll(() => state.postedInstructions.at(-1)).toBe("把靠后的产品片段改成动画");
});
