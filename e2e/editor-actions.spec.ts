import { test, expect } from "@playwright/test";

test("real editor toolbar, context menu, keyboard and history mutate the timeline", async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const expectedMissingExport: string[] = [];
  page.on("console", message => {
    if (message.type() !== "error") return;
    // The API contract uses 404 to mean no previous export, explicitly seeded below.
    if (message.location().url.includes("/exports/current") && message.text().includes("404")) expectedMissingExport.push(message.text());
    else errors.push(`${message.text()} (${message.location().url})`);
  });
  const project = { metadata: { title: "编辑器动作回归", duration: 4 }, settings: { fps: 30, width: 640, height: 360 }, media: [],
    tracks: [{ id: "text-main", type: "text", name: "文字", elements: [{ id: "clip-a", type: "text", name: "动作验证片段", content: "动作验证", startTime: 0, duration: 4, trimStart: 0, trimEnd: 0 }] }] };
  const saves: unknown[] = [];
  await page.route("**/v1/**", async route => {
    const request = route.request();
    if (request.url().endsWith("/v1/video/projects/90001")) {
      if (request.method() === "PUT") { saves.push(request.postDataJSON()); return route.fulfill({ json: { project_fingerprint: "b".repeat(64) } }); }
      return route.fulfill({ json: { status: "completed", project, project_fingerprint: "a".repeat(64) } });
    }
    if (request.url().includes("/exports/current")) return route.fulfill({ status: 404, json: { detail: "No export" } });
    return route.fulfill({ json: {} });
  });
  // No external backend/auth/provider request may escape the fixture boundary.
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith("/v1/")) return route.fallback();
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    return route.abort("blockedbyclient");
  });
  await page.addInitScript(() => localStorage.setItem("multimix_local_user", JSON.stringify({ token: "fixture-only" })));
  await page.goto("/editor?asset=90001");
  await expect(page).toHaveURL(/\/editor\?asset=90001/);
  await expect(page.getByRole("button", { name: "Split clip", exact: true })).toBeVisible({ timeout: 100_000 });
  await expect(page.locator("nextjs-portal").locator("[data-nextjs-dialog-overlay], [data-nextjs-error-overlay]")).toHaveCount(0);
  const clips = page.locator(".editor-timeline-region").getByRole("button", { name: "动作验证", exact: true });
  await expect(clips).toHaveCount(1);
  await clips.first().click();
  // Existing frame-step commands seek the real playhead, without a test API.
  await page.keyboard.press("ArrowRight");
  await page.getByRole("button", { name: "Split clip", exact: true }).click();
  await expect(clips).toHaveCount(2);
  const mod = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(`${mod}+z`); await expect(clips).toHaveCount(1);
  await page.keyboard.press(`${mod}+Shift+z`); await expect(clips).toHaveCount(2);
  await clips.last().click();
  await page.getByRole("button", { name: "Delete clip", exact: true }).click(); await expect(clips).toHaveCount(1);
  await page.keyboard.press(`${mod}+z`); await expect(clips).toHaveCount(2);
  await clips.last().click({ button: "right" });
  await page.getByRole("menuitem", { name: /^Copy/ }).click();
  await page.keyboard.press("End"); await page.keyboard.press(`${mod}+v`); await expect(clips).toHaveCount(3);
  await page.keyboard.press(`${mod}+z`); await expect(clips).toHaveCount(2);
  await page.keyboard.press("Delete"); await expect(clips).toHaveCount(1);
  await page.keyboard.press(`${mod}+z`); await expect(clips).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath("editor-actions.png"), fullPage: true });
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  expect((saves.at(-1) as typeof project).tracks.flatMap(track => track.elements)).toHaveLength(2);
  // The payload is inspected, without contacting a real backend.
  await testInfo.attach("fixture-save-observations", { body: JSON.stringify({ saves, expectedMissingExport }), contentType: "application/json" });
  expect(errors).toEqual([]);
});
