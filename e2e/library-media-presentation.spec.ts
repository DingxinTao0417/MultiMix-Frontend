import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Offline UI contract checks. API fixtures do not claim real product E2E acceptance.
const fixtureRoot = resolve(process.cwd(), "../MultiMix-Backend/app/tests/fixtures/display_coverage");
const mediaUrl = (file: string) => `http://127.0.0.1:3229/fixture-media/${file}`;
function asset(id: number, type: string, metadata: Record<string, unknown>, productStatus?: string) {
  return { id, title: `资源${id}`, asset_kind: type === "image" ? "image" : "video",
    library_kind: type === "image" ? "image" : "video", content_type: type === "image" ? "uploaded_image" : type,
    source_type: "upload", status: "ready", metadata, product_status: productStatus,
    created_at: "2026-10-09T00:00:00Z", updated_at: "2026-10-09T00:00:00Z", body: "", versions: [] };
}
async function setup(page: Page) {
  const image = await readFile(resolve(fixtureRoot, "sample-image.png"));
  const portrait = await readFile(process.env.MULTIMIX_LIBRARY_PORTRAIT_FIXTURE || resolve(fixtureRoot, "sample-image.png"));
  const video = await readFile(resolve(fixtureRoot, "sample-video.mp4"));
  await page.route("**/fixture-media/**", async (route) => {
    const name = new URL(route.request().url()).pathname;
    await route.fulfill({ body: name.endsWith("mp4") ? video : name.includes("portrait") ? portrait : image,
      contentType: name.endsWith("mp4") ? "video/mp4" : "image/png", headers: { "Access-Control-Allow-Origin": "*" } });
  });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let payload: unknown = [];
    if (url.pathname.startsWith("/v1/auth/")) payload = { access_token: "fixture-token", email: "fixture@multimix.local" };
    else if (url.pathname === "/v1/assets") {
      payload = url.searchParams.get("library_kind") === "image" ? [
        asset(1, "image", { preview_url: mediaUrl("landscape.png") }),
        asset(2, "image", { preview_url: mediaUrl("portrait.png") }),
        asset(3, "image", { media_availability: "missing" }),
      ] : [
        asset(4, "video_project", { preview_url: mediaUrl("video.mp4") }, "failed"),
        asset(5, "video_project", { preview_url: mediaUrl("video.mp4") }, "generating"),
        asset(6, "video_project", { preview_url: mediaUrl("video.mp4"), poster_url: mediaUrl("poster.png") }, "completed"),
        asset(7, "uploaded_video", { preview_url: mediaUrl("video.mp4") }),
      ];
    }
    await route.fulfill({ json: payload });
  });
  await page.goto("/app/assets");
  await page.getByLabel("邮箱", { exact: true }).fill("fixture@multimix.local");
  await page.getByLabel("密码", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
}

test("landscape, portrait and missing images stay square without tall card gaps", async ({ page }) => {
  await setup(page);
  await page.getByRole("navigation", { name: "资源库" }).getByRole("button", { name: "图片库", exact: true }).click();
  const grid = page.getByLabel("图片库列表");
  await expect(grid.locator("button")).toHaveCount(3);
  await expect.poll(() => grid.locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const frames = await grid.locator(".shadcn-prototype-library-media-thumb").evaluateAll((nodes) => nodes.map((node) => {
      const r = node.getBoundingClientRect(); return { width: r.width, height: r.height };
    }));
    for (const frame of frames) expect(Math.abs(frame.width - frame.height)).toBeLessThanOrEqual(1);
    const cards = await grid.locator("button").evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(Math.max(...cards) - Math.min(...cards)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `.tmp/library-media-browser/images-${width}.png` });
  }
  await grid.getByRole("button", { name: /资源2/ }).click();
  const image = page.getByRole("dialog").locator("img").first();
  await expect(image).toHaveAttribute("src", mediaUrl("portrait.png"));
  const dimensions = await image.evaluate((element) => {
    const img = element as HTMLImageElement;
    const bounds = img.getBoundingClientRect();
    return { source: img.naturalWidth / img.naturalHeight, displayed: bounds.width / bounds.height };
  });
  expect(dimensions.displayed).toBeCloseTo(dimensions.source, 3);
});

test("video cards exclude incomplete projects and decode a real legacy frame", async ({ page }) => {
  await setup(page);
  await page.getByRole("navigation", { name: "资源库" }).getByRole("button", { name: "视频库", exact: true }).click();
  const grid = page.getByLabel("视频库列表");
  await expect(grid.locator("button")).toHaveCount(2);
  await expect(grid.getByText("资源4")).toHaveCount(0);
  await expect(grid.getByText("资源5")).toHaveCount(0);
  await expect(grid.getByRole("button", { name: /资源7/ }).locator("img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await expect(grid.locator("video")).toHaveCount(0);
  await page.screenshot({ path: ".tmp/library-media-browser/videos.png" });
});
