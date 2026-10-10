// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProductWorkspace from "../components/product-workspace";
import AssetsWorkspaceClient from "../components/assets-workspace-client";
import { assetWorkspaceAdapter, buildConversationMessagePayload } from "../lib/asset-workspace-adapter";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";
import type { AssetSubtitleControls, AssetSubtitleOperation } from "../lib/asset-workspace-types";

vi.mock("../../../lib/video-project-client", async (original) => ({
  ...await original<typeof import("../../../lib/video-project-client")>(),
  getFilmReviews: vi.fn(async () => ({ can_review: false, unavailable_reason: null, script_review: null, reviews: [] })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const controls: AssetSubtitleControls = {
  available: true, enabled: true, revision: 0, mode: "source",
  source_language: "zh-CN", target_language: "zh-CN", original_audio_ref: null,
  can_enable: true, can_undo: false, revisions: [],
  cues: [{ cue_id: "cue-a", text: "下令是", source_text: "下令是", start_seconds: 0, end_seconds: 1, user_edited: false }],
};
function props() {
  const source = displayProducts["case-07-project-ready-mp4"];
  const product = { ...source, contentHash: "current-hash", metadata: { ...source.metadata,
    video_plan: { ...(source.metadata?.video_plan as object), subtitle_controls: controls } } };
  return { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined),
    product, selectedConversation: conversationForDisplayProduct(product) };
}

it.each<AssetSubtitleOperation>([
  { assetId: 42, expectedContentHash: "hash", expectedSubtitleRevision: 0, action: "correct_subtitle", cueId: "cue-a", text: "夏令时，\n开始。" },
  { assetId: 42, expectedContentHash: "hash", expectedSubtitleRevision: 2, action: "set_subtitle_visibility", subtitlesEnabled: false },
  { assetId: 42, expectedContentHash: "hash", expectedSubtitleRevision: 2, action: "undo_subtitle_edit" },
  { assetId: 42, expectedContentHash: "hash", expectedSubtitleRevision: 2, action: "restore_subtitle_revision", subtitleRevision: 0 },
])("serializes one exact subtitle operation: $action", (operation) => {
  const payload = buildConversationMessagePayload({ conversationId: "subtitle-chat", instruction: "修改字幕", subtitleOperation: operation });
  expect(payload.subtitle_operation).toMatchObject({ asset_id: 42, expected_content_hash: "hash", expected_subtitle_revision: operation.expectedSubtitleRevision, action: operation.action });
  expect(payload.selected_scene_id).toBeUndefined();
  if (operation.action === "set_subtitle_visibility") expect(payload.subtitle_operation?.subtitles_enabled).toBe(false);
  if (operation.action === "restore_subtitle_revision") expect(payload.subtitle_operation?.subtitle_revision).toBe(0);
  if (operation.action === "correct_subtitle") expect(payload.subtitle_operation?.text).toBe("夏令时，\n开始。");
});

it("mounts review controls on the current work and forwards exact target and revision", async () => {
  const value = props();
  const onSubtitleRequest = vi.fn(async () => undefined);
  render(<ProductWorkspace {...value} onSubtitleRequest={onSubtitleRequest} />);
  fireEvent.click(screen.getByText("核对字幕"));
  fireEvent.click(screen.getByRole("button", { name: "修改字幕" }));
  fireEvent.change(screen.getByRole("textbox", { name: "字幕文字" }), { target: { value: "夏令时。" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await waitFor(() => expect(onSubtitleRequest).toHaveBeenCalledWith({ assetId: value.product.backendAssetId,
    expectedContentHash: "current-hash", expectedSubtitleRevision: 0, action: "correct_subtitle", cueId: "cue-a", text: "夏令时。" }));
  expect(screen.getByText("修改请求已发送，请在对话中确认。")).toBeVisible();
});

it("keeps initial enable available through the actual product projection", async () => {
  const value = props();
  value.product.metadata.video_plan.subtitle_controls = { ...controls, enabled: false, cues: [],
    can_undo: false, enable_requires_generation: true };
  const onSubtitleRequest = vi.fn(async () => undefined);
  render(<ProductWorkspace {...value} onSubtitleRequest={onSubtitleRequest} />);
  fireEvent.click(screen.getByText("核对字幕"));
  expect(screen.getByText("开启后将生成原语言字幕，请在对话中确认。原声和画面保持不变。")).toBeVisible();
  fireEvent.click(screen.getByRole("switch", { name: "添加字幕" }));
  await waitFor(() => expect(onSubtitleRequest).toHaveBeenCalledWith(expect.objectContaining({
    action: "set_subtitle_visibility", subtitlesEnabled: true, expectedSubtitleRevision: 0,
  })));
});

it("keeps independent previews read only", () => {
  render(<ProductWorkspace {...props()} />);
  fireEvent.click(screen.getByText("核对字幕"));
  expect(screen.getByRole("button", { name: "修改字幕" })).toBeDisabled();
});

it("shows submission failure without announcing success", async () => {
  render(<ProductWorkspace {...props()} onSubtitleRequest={vi.fn(async () => { throw new Error("当前字幕已更新"); })} />);
  fireEvent.click(screen.getByText("核对字幕"));
  fireEvent.click(screen.getByRole("switch", { name: "添加字幕" }));
  expect(await screen.findByText("当前字幕已更新")).toBeVisible();
  expect(screen.queryByText("修改请求已发送，请在对话中确认。")).not.toBeInTheDocument();
});

it("sends a panel operation through the workspace adapter and shows the existing confirmation", async () => {
  const value = props();
  const conversation = { ...value.selectedConversation, id: "subtitle-project", readonly: false, detailsLoaded: true,
    product: value.product, products: [value.product], messages: [{ role: "assistant" as const, text: "视频已生成", assetId: value.product.backendAssetId }] };
  window.localStorage.clear();
  window.history.replaceState(null, "", `/app/assets?conversation=subtitle-project&product=${value.product.id}`);
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
  vi.spyOn(assetWorkspaceAdapter, "mergeConversationSummaries").mockImplementation((_summary, current) => current.length ? current : [conversation]);
  vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([]);
  vi.spyOn(assetWorkspaceAdapter, "loadCurrentRequirements").mockResolvedValue(null);
  const send = vi.spyOn(assetWorkspaceAdapter, "sendMessage").mockResolvedValue({
    conversationId: conversation.id, product: value.product, generationJob: null, agentAction: null,
    conversation: { ...conversation, messages: [...conversation.messages, { role: "assistant", text: "请确认关闭字幕", plan: {
      kind: "agent_action_confirmation", title: "关闭视频字幕", status: "pending", confirmLabel: "确认关闭字幕",
      confirmUtterance: "确认关闭字幕", confirmationId: "subtitle-confirmation", fields: [],
    } }] },
  });
  render(<AssetsWorkspaceClient accountEmail="subtitle@example.test" token="token" initialConversationId={conversation.id} initialProductId={value.product.id} />);
  fireEvent.click(await screen.findByText("核对字幕"));
  await waitFor(() => expect(screen.getByRole("switch", { name: "添加字幕" })).toBeEnabled());
  fireEvent.click(screen.getByRole("switch", { name: "添加字幕" }));
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][0]).toMatchObject({ conversationId: "subtitle-project", selectedProductId: value.product.backendAssetId,
    subtitleOperation: { assetId: value.product.backendAssetId, expectedContentHash: "current-hash", expectedSubtitleRevision: 0, action: "set_subtitle_visibility", subtitlesEnabled: false } });
  expect(send.mock.calls[0][0].selectedSceneId).toBeUndefined();
  expect(await screen.findByRole("button", { name: "确认关闭字幕" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "确认关闭字幕" }));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1][0]).toMatchObject({ agentConfirmationId: "subtitle-confirmation" });
  expect(send.mock.calls[1][0].subtitleOperation).toBeUndefined();
});
