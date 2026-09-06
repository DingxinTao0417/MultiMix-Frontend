import { expect, test } from "@playwright/test";

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
      else { reviewRequests += 1; phase = "resolved"; }
      await route.fulfill({ json: { id: "review-2", status: "completed" } });
      return;
    }
    await route.fulfill({ json: { can_review: true, unavailable_reason: null, script_review: null, reviews: [{
      id: "review-1", is_current: phase !== "stale", status: "completed", created_at: "2026-09-04T12:00:00Z",
      error: null, requested_repairs: repairRequests ? [issue.id] : [], report: {
        mode: "film", status: "partial", summary: "成片审阅已完成，以下为抽样观察。",
        coverage: { visual: "sampled", speech: "unavailable", audio: "decode_and_boundaries" },
        findings: phase === "resolved" ? [] : [issue], notes: ["每镜三个时间点抽样，不代表逐帧检查。"],
        evidence: [{ id: "visual:scene-1", kind: "visual", display_text: "杯子放在桌面上。" }],
        follow_up: phase === "resolved" ? [{ issue_id: issue.id, issue, status: "resolved", evidence_ids: ["visual:scene-1"] }] : [],
      },
    }] } });
  });
  const conversationId = seed.conversation_ids["case-07-project-ready-mp4"];
  await page.goto("/app/assets");
  const link = page.locator(`a.shadcn-prototype-conversation-main[href$="conversation=${conversationId}"]`);
  await expect(link).toBeVisible();
  await link.click();
  const panel = page.getByRole("region", { name: "编导与成片审阅" });
  await expect(panel.getByText(issue.reason)).toBeVisible();
  await expect(panel.getByText(/复转写未完成/)).toBeVisible();
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
  expect(reviewRequests).toBe(1);
});
