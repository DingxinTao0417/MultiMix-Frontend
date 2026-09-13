import { expect, test, type Page, type Response } from "@playwright/test";

type Seed = {
  email: string;
  password: string;
  video_asset_id: number;
  initial_version_id: number;
  generated_image_conversation_id: string;
  generated_candidate_asset_id: number;
};

type AssetVersion = { id: number; version: number };
type ContentAsset = {
  id: number;
  metadata: {
    image_generation_applied?: boolean;
    video_plan?: {
      scenes?: Array<{
        id?: string;
        asset_reference?: { chosen_asset_id?: number };
      }>;
    };
  };
  versions: AssetVersion[];
};
type ConversationMessageResponse = {
  assistant_message: string;
  agent_action?: {
    id: string;
    status: string;
    confirmation_id?: string | null;
  } | null;
};

const backendUrl = process.env.AGENT_ATOMIC_E2E_BACKEND_URL;
const seed = JSON.parse(
  process.env.AGENT_ATOMIC_E2E_SEED ?? "null",
) as Seed | null;

async function authenticate(page: Page): Promise<string> {
  if (!backendUrl || !seed) throw new Error("Generated-image E2E environment is missing");
  const response = await page.request.post(`${backendUrl}/v1/auth/login`, {
    data: { email: seed.email, password: seed.password },
  });
  expect(response.ok(), `login failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("Local login returned no access token");
  await page.addInitScript(({ email, token }) => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email, token }),
    );
  }, { email: seed.email, token: body.access_token });
  return body.access_token;
}

async function readAsset(
  page: Page,
  token: string,
  assetId: number,
): Promise<ContentAsset> {
  if (!backendUrl) throw new Error("Generated-image E2E backend URL is missing");
  const response = await page.request.get(
    `${backendUrl}/v1/assets/detail/${assetId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.ok(), `asset load failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { asset: ContentAsset };
  return body.asset;
}

async function sendMessage(page: Page, instruction: string): Promise<{
  response: Response;
  body: ConversationMessageResponse;
}> {
  if (!backendUrl) throw new Error("Generated-image E2E backend URL is missing");
  const responsePromise = page.waitForResponse((response) => (
    response.url() === `${backendUrl}/v1/assets/conversations/messages`
    && response.request().method() === "POST"
  ));
  const composer = page.getByRole("textbox", { name: "输入对话内容" });
  await composer.fill(instruction);
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  return {
    response,
    body: await response.json() as ConversationMessageResponse,
  };
}

test("generated image updates an existing scene only after dialogue confirmation", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  if (!seed) throw new Error("AGENT_ATOMIC_E2E_SEED is missing");
  const token = await authenticate(page);
  const initialProject = await readAsset(page, token, seed.video_asset_id);

  await page.goto(
    `/app/assets?conversation=${encodeURIComponent(seed.generated_image_conversation_id)}`
      + `&product=asset-${seed.generated_candidate_asset_id}`,
  );
  await expect(page.getByRole("textbox", { name: "输入对话内容" })).toBeEnabled({
    timeout: 120_000,
  });
  await expect(page.getByText(/选中图片不会更新视频/).last()).toBeVisible();

  const proposed = await sendMessage(page, "把这张图用到第 2 镜");
  expect(proposed.body.agent_action).toMatchObject({
    status: "waiting_confirmation",
  });
  expect(proposed.body.agent_action?.confirmation_id).toBeTruthy();

  const confirmation = page.getByLabel("确认更新已有视频 · 待确认").last();
  await expect(confirmation).toContainText("E2E 生成图片候选");
  await expect(confirmation).toContainText("第 2 镜 · 核心功能");
  await expect(confirmation).toContainText("预计费用");
  await expect(
    confirmation.getByRole("button", { name: "确认更新这一镜", exact: true }),
  ).toBeVisible();

  const beforeConfirmProject = await readAsset(page, token, seed.video_asset_id);
  const beforeConfirmCandidate = await readAsset(
    page,
    token,
    seed.generated_candidate_asset_id,
  );
  expect(beforeConfirmProject.versions).toHaveLength(initialProject.versions.length);
  expect(beforeConfirmCandidate.metadata.image_generation_applied ?? false).toBe(false);

  const confirmResponsePromise = page.waitForResponse((response) => (
    response.url() === `${backendUrl}/v1/assets/conversations/messages`
    && response.request().method() === "POST"
  ));
  await confirmation.getByRole(
    "button",
    { name: "确认更新这一镜", exact: true },
  ).click();
  const confirmResponse = await confirmResponsePromise;
  expect(confirmResponse.status(), await confirmResponse.text()).toBe(201);
  const confirmed = await confirmResponse.json() as ConversationMessageResponse;
  expect(["queued", "running"]).toContain(confirmed.agent_action?.status);
  await expect(page.getByLabel("确认更新已有视频 · 已确认").last()).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "替换分镜素材" }).last(),
  ).toBeVisible();

  await expect(page.getByText("视频修改已完成。", { exact: true }).last()).toBeVisible({
    timeout: 120_000,
  });
  await expect.poll(async () => {
    const project = await readAsset(page, token, seed.video_asset_id);
    return project.metadata.video_plan?.scenes?.find(
      (scene) => scene.id === "scene-2",
    )?.asset_reference?.chosen_asset_id;
  }, { timeout: 30_000 }).toBe(seed.generated_candidate_asset_id);

  const changedProject = await readAsset(page, token, seed.video_asset_id);
  expect(changedProject.versions.length).toBeGreaterThan(initialProject.versions.length);
  const appliedCandidate = await readAsset(
    page,
    token,
    seed.generated_candidate_asset_id,
  );
  expect(appliedCandidate.metadata.image_generation_applied).toBe(true);

  await page.goto(
    `/app/assets?conversation=${encodeURIComponent(seed.generated_image_conversation_id)}`
      + `&product=asset-${seed.generated_candidate_asset_id}`,
  );
  await expect(page.getByRole("textbox", { name: "输入对话内容" })).toBeEnabled({
    timeout: 120_000,
  });
  await expect(page.getByText(/已应用到已有视频分镜/).last()).toBeVisible();
});
