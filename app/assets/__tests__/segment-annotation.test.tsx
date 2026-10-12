// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import AssetsWorkspaceClient from "../components/assets-workspace-client";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

vi.mock("../../../lib/video-project-client", async (original) => ({
  ...await original<typeof import("../../../lib/video-project-client")>(),
  getFilmReviews: vi.fn(async () => ({ can_review: false, unavailable_reason: null, script_review: null, reviews: [] })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// A finished video project as the backend returns it: the scene-focus contract
// requires contentType and a persisted version before a scene can be targeted.
function renderWorkspace() {
  const source = displayProducts["case-07-project-ready-mp4"];
  const product = { ...source, contentType: "video_project",
    versions: [{ id: "7", label: "v1", savedAt: "2026-10-12T00:00:00Z", status: "completed" }] };
  const conversation = { ...conversationForDisplayProduct(product), id: "annotate-project", readonly: false,
    detailsLoaded: true, product, products: [product],
    messages: [{ role: "assistant" as const, text: "视频已生成", assetId: product.backendAssetId }] };
  window.localStorage.clear();
  window.history.replaceState(null, "", `/app/assets?conversation=${conversation.id}&product=${product.id}`);
  Object.defineProperty(window, "matchMedia", { configurable: true,
    value: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
  vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
  vi.spyOn(assetWorkspaceAdapter, "mergeConversationSummaries").mockImplementation((_summary, current) => current.length ? current : [conversation]);
  vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([]);
  vi.spyOn(assetWorkspaceAdapter, "loadCurrentRequirements").mockResolvedValue(null);
  const send = vi.spyOn(assetWorkspaceAdapter, "sendMessage").mockImplementation(async () => ({
    conversationId: conversation.id, product, generationJob: null, agentAction: null, conversation,
  }));
  render(<AssetsWorkspaceClient accountEmail="annotate@example.test" token="token"
    initialConversationId={conversation.id} initialProductId={product.id} />);
  return { send, product };
}

const composer = () => screen.getByRole("textbox", { name: "输入对话内容" }) as HTMLTextAreaElement;

async function submit(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.keyDown(composer(), { key: "Enter", code: "Enter" });
}

it("binds the composer to one segment and sends that scene", async () => {
  const { send } = renderWorkspace();
  const annotate = await screen.findByRole("button", { name: "说第 2 镜" }, { timeout: 5_000 });
  fireEvent.click(annotate);

  await waitFor(() => expect(composer().value).toBe("第 2 镜："));
  expect(screen.getByRole("status", { name: "正在说第 2 镜" })).toBeVisible();
  expect(screen.getByRole("button", { name: "说第 2 镜" })).toHaveAttribute("aria-pressed", "true");

  await submit("第 2 镜：换成完工全景");
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][0]).toMatchObject({ selectedSceneId: "segment-2", selectedSceneVersionId: 7 });
});

it("releases the segment binding after the message is accepted", async () => {
  const { send } = renderWorkspace();
  fireEvent.click(await screen.findByRole("button", { name: "说第 2 镜" }, { timeout: 5_000 }));
  await waitFor(() => expect(composer().value).toBe("第 2 镜："));
  await submit("第 2 镜：换成完工全景");
  await waitFor(() => expect(send).toHaveBeenCalledOnce());

  await waitFor(() => expect(screen.queryByRole("status", { name: "正在说第 2 镜" })).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "说第 2 镜" })).toHaveAttribute("aria-pressed", "false");

  await submit("整体节奏再快一点");
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls[1][0].selectedSceneId).toBeUndefined();
});

it("clears the binding manually without sending", async () => {
  const { send } = renderWorkspace();
  fireEvent.click(await screen.findByRole("button", { name: "说第 2 镜" }, { timeout: 5_000 }));
  fireEvent.click(await screen.findByRole("button", { name: "取消针对第 2 镜" }));

  expect(screen.queryByRole("status", { name: "正在说第 2 镜" })).not.toBeInTheDocument();
  await submit("整体节奏再快一点");
  await waitFor(() => expect(send).toHaveBeenCalledOnce());
  expect(send.mock.calls[0][0].selectedSceneId).toBeUndefined();
});
