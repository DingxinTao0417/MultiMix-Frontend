import { expect, test, type Page, type Response } from "@playwright/test";

type Seed = {
  email: string;
  password: string;
  conversation_id: string;
  video_asset_id: number;
  replacement_asset_id: number;
  initial_version_id: number;
  active_task_id: string;
  scene_one_asset_id: number;
  scene_two_old_asset_id: number;
};

type AssetVersion = {
  id: number;
  version: number;
};

type VideoScene = {
  id?: string;
  asset_reference?: { chosen_asset_id?: number };
  primary_visual?: { asset_id?: number };
  [key: string]: unknown;
};

type ContentAsset = {
  id: number;
  metadata: {
    video_plan?: {
      scenes?: VideoScene[];
    };
  };
  versions: AssetVersion[];
};

type AgentRun = {
  id: string;
  action_id: string;
  status: string;
  confirmation_id?: string | null;
};

type AgentTask = {
  id: string;
  goal: string;
  status: string;
  focus: {
    asset_id?: number | null;
    version_id?: number | null;
    scene_id?: string | null;
  };
  plan: AgentRun[];
};

type AgentMission = {
  version: "agent_v2";
  active_task_id: string | null;
  task_stack: string[];
  tasks: Record<string, AgentTask>;
  last_read_only_branch?: string;
};

type Conversation = {
  id: string;
  metadata: {
    agent_mission?: AgentMission;
  };
  products: ContentAsset[];
};

type ConversationMessageResponse = {
  assistant_message: string;
  agent_action?: AgentRun | null;
};

const backendUrl = process.env.AGENT_ATOMIC_E2E_BACKEND_URL;
const seed = JSON.parse(
  process.env.AGENT_ATOMIC_E2E_SEED ?? "null",
) as Seed | null;

async function authenticate(page: Page): Promise<string> {
  if (!backendUrl || !seed) throw new Error("Agent atomic E2E environment is missing");
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

async function readConversation(
  page: Page,
  token: string,
): Promise<Conversation> {
  if (!backendUrl || !seed) throw new Error("Agent atomic E2E environment is missing");
  const response = await page.request.get(
    `${backendUrl}/v1/assets/conversations/${seed.conversation_id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.ok(), `conversation load failed: ${response.status()}`).toBe(true);
  return response.json() as Promise<Conversation>;
}

async function readAsset(page: Page, token: string): Promise<ContentAsset> {
  if (!backendUrl || !seed) throw new Error("Agent atomic E2E environment is missing");
  const response = await page.request.get(
    `${backendUrl}/v1/assets/detail/${seed.video_asset_id}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  expect(response.ok(), `asset load failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { asset: ContentAsset };
  return body.asset;
}

function missionOf(conversation: Conversation): AgentMission {
  const mission = conversation.metadata.agent_mission;
  expect(mission?.version).toBe("agent_v2");
  if (!mission) throw new Error("Conversation has no agent_v2 mission");
  return mission;
}

function activeTaskOf(mission: AgentMission): AgentTask {
  const task = mission.tasks[mission.active_task_id ?? ""];
  if (!task) throw new Error("Agent mission has no active task");
  return task;
}

function actionCount(mission: AgentMission): number {
  return Object.values(mission.tasks)
    .reduce((count, task) => count + task.plan.length, 0);
}

function scenesOf(asset: ContentAsset): VideoScene[] {
  const scenes = asset.metadata.video_plan?.scenes;
  if (!Array.isArray(scenes)) throw new Error("Video asset has no scenes");
  return scenes;
}

async function sendMessage(page: Page, instruction: string): Promise<{
  response: Response;
  body: ConversationMessageResponse;
}> {
  if (!backendUrl) throw new Error("AGENT_ATOMIC_E2E_BACKEND_URL is missing");
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

test("Conversation Agent keeps task memory and atomically edits one video scene", async ({ page }) => {
  test.setTimeout(5 * 60_000);
  if (!seed) throw new Error("AGENT_ATOMIC_E2E_SEED is missing");
  const token = await authenticate(page);

  await page.goto(
    `/app/assets?conversation=${encodeURIComponent(seed.conversation_id)}`
      + `&product=asset-${seed.video_asset_id}`,
  );
  await expect(page.getByRole("textbox", { name: "输入对话内容" })).toBeEnabled({
    timeout: 120_000,
  });

  const initialConversation = await readConversation(page, token);
  const initialMission = missionOf(initialConversation);
  const initialTask = activeTaskOf(initialMission);
  const initialAsset = await readAsset(page, token);
  const initialScenes = structuredClone(scenesOf(initialAsset));
  const initialActionCount = actionCount(initialMission);
  expect(initialMission.active_task_id).toBe(seed.active_task_id);
  expect(initialTask.focus).toMatchObject({
    asset_id: seed.video_asset_id,
    version_id: seed.initial_version_id,
    scene_id: "scene-2",
  });

  const question = await sendMessage(page, "这个产品视频一共有几个分镜？");
  expect(question.body.agent_action ?? null).toBeNull();
  const afterQuestion = missionOf(await readConversation(page, token));
  const afterQuestionTask = activeTaskOf(afterQuestion);
  expect(afterQuestion.active_task_id).toBe(initialMission.active_task_id);
  expect(afterQuestionTask.focus).toEqual(initialTask.focus);
  expect(actionCount(afterQuestion)).toBe(initialActionCount);
  expect((await readAsset(page, token)).versions).toHaveLength(
    initialAsset.versions.length,
  );

  await page.getByRole("button", { name: "图片库", exact: true }).click();
  const replacementCard = page
    .locator("button.shadcn-prototype-library-media-card")
    .filter({ hasText: "E2E 新场景图" });
  await expect(replacementCard).toBeVisible({ timeout: 60_000 });
  await replacementCard.click();
  const replacementDialog = page.getByRole("dialog", {
    name: "E2E 新场景图详情",
  });
  await expect(replacementDialog).toBeVisible();
  await replacementDialog.getByRole("button", { name: "加入对话" }).click();
  await expect(page.getByText("已加入当前对话引用。", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "输入对话内容" })).toBeEnabled({
    timeout: 120_000,
  });

  const replacement = await sendMessage(
    page,
    "把第2个分镜换成我刚加入的图片",
  );
  const replacementRequest = replacement.response.request().postDataJSON() as {
    linked_asset_ids?: number[];
  };
  expect(replacementRequest.linked_asset_ids).toContain(seed.replacement_asset_id);
  expect(replacement.body.agent_action).toMatchObject({
    action_id: "video.scene.replace_material",
  });
  expect(["queued", "running"]).toContain(
    replacement.body.agent_action?.status,
  );
  const runningStep = page
    .locator(".shadcn-prototype-agent-run-step.run")
    .filter({ hasText: "替换分镜素材" });
  await expect(runningStep).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText("视频修改已完成。", { exact: true }).last()).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.locator(".shadcn-prototype-agent-run-title-status.success").last(),
  ).toBeVisible();

  const changedAsset = await readAsset(page, token);
  const changedScenes = scenesOf(changedAsset);
  expect(changedAsset.id).toBe(seed.video_asset_id);
  expect(changedAsset.versions.length).toBeGreaterThan(
    initialAsset.versions.length,
  );
  expect(changedScenes[0]).toEqual(initialScenes[0]);
  expect(changedScenes[1]?.asset_reference?.chosen_asset_id).toBe(
    seed.replacement_asset_id,
  );
  expect(changedScenes[1]?.primary_visual?.asset_id).toBe(
    seed.replacement_asset_id,
  );

  await page.reload();
  await expect(page.getByRole("textbox", { name: "输入对话内容" })).toBeEnabled({
    timeout: 120_000,
  });
  await expect(page.getByText("视频修改已完成。", { exact: true }).last()).toBeVisible();
  await expect(
    page.locator(".shadcn-prototype-agent-run-title-status.success").last(),
  ).toBeVisible();

  await page.getByText("详情", { exact: true }).click();
  const detailDrawer = page.getByLabel("生成详情");
  await expect(detailDrawer).toBeVisible();
  const undoVersion = changedAsset.versions.find(
    (version) => version.id === seed.initial_version_id,
  );
  expect(undoVersion).toBeTruthy();
  const undoArticle = detailDrawer
    .locator(".shadcn-prototype-version-list article")
    .filter({ hasText: `v${undoVersion?.version}` });
  const restoreResponse = page.waitForResponse((response) => (
    response.url().endsWith(
      `/v1/assets/${seed.video_asset_id}/versions/${seed.initial_version_id}/restore`,
    )
    && response.request().method() === "POST"
  ));
  await undoArticle.getByRole("button", { name: "恢复", exact: true }).click();
  expect((await restoreResponse).status()).toBe(201);
  await expect(page.getByText(/已恢复到 v1 的视频工程/).last()).toBeVisible();

  await expect.poll(async () => {
    const restored = await readAsset(page, token);
    return scenesOf(restored)[1]?.asset_reference?.chosen_asset_id;
  }, { timeout: 30_000 }).toBe(seed.scene_two_old_asset_id);
  const restoredAsset = await readAsset(page, token);
  expect(scenesOf(restoredAsset)[0]).toEqual(initialScenes[0]);
  expect(scenesOf(restoredAsset)[1]?.primary_visual?.asset_id).toBe(
    seed.scene_two_old_asset_id,
  );

  await page.getByText("详情", { exact: true }).click();
  const voice = await sendMessage(page, "把整支视频换成沉稳男声");
  expect(voice.body.agent_action).toMatchObject({
    action_id: "video.project.set_voice",
    status: "waiting_confirmation",
  });
  expect(voice.body.agent_action?.confirmation_id).toBeTruthy();
  const confirmation = page.getByLabel("确认视频修改 · 待确认").last();
  await expect(confirmation).toContainText("设置全片声音");
  await expect(
    confirmation.getByRole("button", { name: "确认修改", exact: true }),
  ).toBeVisible();

  const beforeUnsupported = await readConversation(page, token);
  const beforeUnsupportedMission = missionOf(beforeUnsupported);
  const versionsBeforeUnsupported = (await readAsset(page, token)).versions.length;
  const actionsBeforeUnsupported = actionCount(beforeUnsupportedMission);
  const unsupported = await sendMessage(page, "把视频发布到所有平台");
  expect(unsupported.body.agent_action ?? null).toBeNull();
  await expect(
    page.getByText(/还不能安全确定要修改的视频范围/).last(),
  ).toBeVisible();
  const afterUnsupported = missionOf(await readConversation(page, token));
  expect(actionCount(afterUnsupported)).toBe(actionsBeforeUnsupported);
  expect((await readAsset(page, token)).versions).toHaveLength(
    versionsBeforeUnsupported,
  );
  await expect(confirmation).toContainText("设置全片声音");
});
