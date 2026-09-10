import { expect, test } from "@playwright/test";
import type { AssetConversationResponse } from "../lib/api";

test("film review explains coverage, opens explicit revision choices and tracks revalidation", async ({ page }) => {
  test.setTimeout(120000);
  const seed = JSON.parse(process.env.DISPLAY_COVERAGE_SEED_JSON ?? "{}");
  const issue = { id: "review-issue-1", scene_id: "scene-1", category: "visual_alignment", severity: "P2",
    reason: "开头画面尚未展示操作过程", suggestion: "为第一镜选择操作过程画面", start_seconds: 0, end_seconds: 4,
    evidence_ids: ["visual:scene-1"] };
  let phase = "open";
  let repairRequests = 0;
  let reviewRequests = 0;
  await page.route("**/v1/video/projects/*/reviews**", async (route) => {
    if (route.request().method() === "POST") {
      if (route.request().url().endsWith("/repair")) repairRequests += 1;
      else { reviewRequests += 1; phase = phase === "open" ? "covered" : "resolved"; }
      await route.fulfill({ json: { id: "review-2", status: "completed" } });
      return;
    }
    await route.fulfill({ json: { can_review: true, unavailable_reason: null, script_review: null, reviews: [{
      id: "review-1", is_current: phase !== "stale", status: "completed", created_at: "2026-09-04T12:00:00Z",
      can_retry: phase === "open", missing_checks: phase === "open" ? ["speech"] : [],
      error: null, requested_repairs: repairRequests ? [issue.id] : [], report: {
        mode: "film", status: "partial", summary: "成片审阅已完成，以下为抽样观察。",
        coverage: { visual: "sampled", speech: phase === "open" ? "unavailable" : "transcribed", audio: "decode_and_boundaries" },
        findings: phase === "resolved" ? [] : [issue], notes: ["每镜三个时间点抽样，不代表逐帧检查。"],
        evidence: [{ id: "visual:scene-1", kind: "visual", display_text: "杯子放在桌面上。" }],
        follow_up: phase === "resolved" ? [{ issue_id: issue.id, issue, status: "resolved", evidence_ids: ["visual:scene-1"] }] : [],
      },
    }] } });
  });
  const conversationId = seed.conversation_ids["case-07-project-ready-mp4"];
  // The shared display fixture predates five-layer plans. Supply its current
  // profile here so this controlled review test exercises the supported flow.
  await page.route((url) => [
    "/v1/assets/conversations",
    `/v1/assets/conversations/${conversationId}`,
    `/v1/assets/conversations/${conversationId}/snapshot`,
  ].includes(url.pathname), async (route) => {
    const response = await route.fetch();
    const payload: AssetConversationResponse | AssetConversationResponse[] = await response.json();
    for (const conversation of Array.isArray(payload) ? payload : [payload]) {
      if (conversation.id !== conversationId) continue;
      for (const product of conversation.products) {
        if (product.content_type !== "video_project") continue;
        const plan = product.metadata.video_plan as Record<string, unknown>;
        plan.creative_profile = {
          schema_version: "video_creative_profile:v1",
          task_mode: "create", content_goal: "explain", style_profile: "editorial_clean",
          production_mode: "source_led", anchor_source: "uploaded_assets", preserve_source_audio: false,
        };
      }
    }
    await route.fulfill({ response, json: payload });
  });
  await page.goto("/app/assets");
  const link = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`);
  await expect(link).toBeVisible();
  await link.click();
  const panel = page.getByRole("region", { name: "编导与成片审阅" });
  await expect(panel.getByText(issue.reason)).toBeVisible();
  await expect(panel.getByText(/复转写未完成/)).toBeVisible();
  await panel.getByRole("button", { name: "补验未完成检查" }).click();
  await expect(panel.getByText(/已复转写成片/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "当前成片已审阅" })).toBeDisabled();
  await expect(panel.getByText(issue.reason)).toBeVisible();
  await expect(panel.getByText(/本版复验已解决/)).toHaveCount(0);
  expect(reviewRequests).toBe(1);
  await panel.screenshot({ path: "test-results/video-film-review/supplement-completed.png" });
  expect(repairRequests).toBe(0);
  await panel.getByRole("button", { name: "查看修订选项" }).click();
  await panel.getByText("查看观察依据").click();
  await expect(panel.getByText("画面：杯子放在桌面上。")).toBeVisible();
  expect(repairRequests).toBe(0);
  const cards = await page.locator(".shadcn-prototype-segment-cards").boundingBox();
  const panelBounds = await panel.boundingBox();
  expect(cards && panelBounds && cards.y + cards.height <= panelBounds.y).toBeTruthy();
  await panel.screenshot({ path: "test-results/video-film-review/review-panel.png" });
  await panel.getByRole("button", { name: "更换画面" }).click();
  await expect.poll(() => repairRequests).toBe(1);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.reload();
  phase = "stale";
  await page.reload();
  await expect(panel.getByText(/报告已过期/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "查看修订选项" })).toBeDisabled();
  await panel.getByRole("button", { name: "重新审阅当前成片" }).click();
  await expect(panel.getByText(/本版复验已解决/)).toBeVisible();
  expect(reviewRequests).toBe(2);
});
