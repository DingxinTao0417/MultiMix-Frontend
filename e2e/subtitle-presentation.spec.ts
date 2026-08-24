import { expect, test, type Page } from "@playwright/test";

type Seed = {
  email: string;
  password: string;
  conversation_id: string;
  video_asset_id: number;
};

type Caption = {
  type?: string;
  name?: string;
  segmentId?: string;
  subtitlePresentation?: string;
  subtitleBackground?: { enabled?: boolean; color?: string };
  subtitleTokens?: Array<{ text?: string }>;
};

type Scene = {
  id?: string;
  subtitle_presentation?: Record<string, unknown>;
};

type Asset = {
  metadata: {
    video_plan?: { scenes?: Scene[] };
    video_project?: unknown;
  };
};

type MessageResponse = {
  agent_action?: { action_id?: string; status?: string } | null;
};

const backendUrl = process.env.AGENT_ATOMIC_E2E_BACKEND_URL;
const seed = JSON.parse(process.env.AGENT_ATOMIC_E2E_SEED ?? "null") as Seed | null;

async function authenticate(page: Page): Promise<string> {
  if (!backendUrl || !seed) throw new Error("Subtitle E2E environment is missing");
  const response = await page.request.post(`${backendUrl}/v1/auth/login`, {
    data: { email: seed.email, password: seed.password },
  });
  expect(response.ok()).toBe(true);
  const { access_token: token } = await response.json() as { access_token?: string };
  if (!token) throw new Error("Local login returned no access token");
  await page.addInitScript(({ email, accessToken }) => {
    window.localStorage.setItem("multimix_local_user", JSON.stringify({ email, token: accessToken }));
  }, { email: seed.email, accessToken: token });
  return token;
}

async function asset(page: Page, token: string): Promise<Asset> {
  if (!backendUrl || !seed) throw new Error("Subtitle E2E environment is missing");
  const response = await page.request.get(`${backendUrl}/v1/assets/detail/${seed.video_asset_id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok()).toBe(true);
  return (await response.json() as { asset: Asset }).asset;
}

async function send(page: Page, instruction: string): Promise<MessageResponse> {
  if (!backendUrl) throw new Error("Subtitle E2E backend is missing");
  const responsePromise = page.waitForResponse((response) => (
    response.url() === `${backendUrl}/v1/assets/conversations/messages`
    && response.request().method() === "POST"
  ));
  await page.getByRole("textbox", { name: "输入对话内容" }).fill(instruction);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  return response.json() as Promise<MessageResponse>;
}

function captionsFor(value: unknown, segmentId: string): Caption[] {
  const found: Caption[] = [];
  const visit = (item: unknown) => {
    if (Array.isArray(item)) return item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const record = item as Caption;
    if (record.type === "text" && record.name?.startsWith("sub") && record.segmentId === segmentId) {
      found.push(record);
    }
    Object.values(record).forEach(visit);
  };
  visit(value);
  return found;
}

test("natural-language subtitle presentation persists through the video project", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  if (!seed) throw new Error("AGENT_ATOMIC_E2E_SEED is missing");
  const token = await authenticate(page);
  await page.goto(`/app/assets?conversation=${encodeURIComponent(seed.conversation_id)}&product=asset-${seed.video_asset_id}`);
  await expect(page.getByRole("textbox", { name: "输入对话内容" })).toBeEnabled({ timeout: 120_000 });

  const initial = await asset(page, token);
  expect(initial.metadata.video_plan?.scenes?.[0]?.subtitle_presentation).toMatchObject({
    mode: "static_phrase", background_enabled: false, source: "auto", locked_by_user: false,
  });
  expect(captionsFor(initial.metadata.video_project, "scene-1")).toEqual(expect.arrayContaining([
    expect.objectContaining({ subtitlePresentation: "static_phrase", subtitleBackground: { enabled: false, color: "#000000aa" } }),
  ]));

  const wordHighlight = await send(page, "把第1个分镜改成逐词高亮字幕，保持没有字幕背景");
  expect(wordHighlight.agent_action).toMatchObject({ action_id: "video.scene.set_subtitle_presentation" });
  await expect.poll(async () => (
    (await asset(page, token)).metadata.video_plan?.scenes?.[0]?.subtitle_presentation?.mode
  ), { timeout: 120_000 }).toBe("word_highlight");
  const highlighted = await asset(page, token);
  expect(highlighted.metadata.video_plan?.scenes?.[0]?.subtitle_presentation).toMatchObject({
    mode: "word_highlight", background_enabled: false, source: "user", locked_by_user: true,
  });
  expect(captionsFor(highlighted.metadata.video_project, "scene-1")).toEqual(expect.arrayContaining([
    expect.objectContaining({ subtitlePresentation: "word_highlight", subtitleBackground: expect.objectContaining({ enabled: false }), subtitleTokens: expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]) }),
  ]));

  const karaoke = await send(page, "把第2个分镜改成卡拉 OK 字幕，并加深色字幕背景");
  expect(karaoke.agent_action).toMatchObject({ action_id: "video.scene.set_subtitle_presentation" });
  await expect.poll(async () => (
    (await asset(page, token)).metadata.video_plan?.scenes?.[1]?.subtitle_presentation?.mode
  ), { timeout: 120_000 }).toBe("karaoke");
  const updated = await asset(page, token);
  expect(updated.metadata.video_plan?.scenes?.[1]?.subtitle_presentation).toMatchObject({
    mode: "karaoke", background_enabled: true, background_color: "#101010cc", source: "user", locked_by_user: true,
  });
  expect(captionsFor(updated.metadata.video_project, "scene-2")).toEqual(expect.arrayContaining([
    expect.objectContaining({ subtitlePresentation: "karaoke", subtitleBackground: { enabled: true, color: "#101010cc" }, subtitleTokens: expect.arrayContaining([expect.objectContaining({ text: expect.any(String) })]) }),
  ]));
});
