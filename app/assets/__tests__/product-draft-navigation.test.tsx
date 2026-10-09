// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AssetsWorkspaceClient from "../components/assets-workspace-client";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { AssetConversation, AssetProduct } from "../lib/asset-workspace-types";

const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const product: AssetProduct = {
  ...assetWorkspaceAdapter.getNewConversation().product,
  id: "asset-88", backendAssetId: 88, contentType: "social_post", contentHash: "hash-88",
  mode: "copy", title: "文稿 A", status: "完成", markdownBody: "# 文稿 A\n\n原正文",
  body: ["原正文"], metadata: {},
};
const second = { ...product, id: "asset-89", backendAssetId: 89, contentHash: "hash-89", title: "文稿 B" };
const conversation: AssetConversation = {
  ...assetWorkspaceAdapter.getNewConversation(), id: "project-1", title: "草稿项目",
  detailsLoaded: true, readonly: false, product, products: [product, second],
  messages: [{ role: "assistant", text: "两份文稿", assetId: 88 },
    { role: "assistant", text: "另一份文稿", assetId: 89 }],
};
const otherConversation = { ...conversation, id: "project-2", title: "另一个项目" };

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/app/assets?conversation=project-1&product=asset-88");
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({
    matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }) });
  vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
  vi.spyOn(assetWorkspaceAdapter, "mergeConversationSummaries").mockImplementation((_summaries, current) => (
    current.length ? current : [conversation, otherConversation]
  ));
  vi.spyOn(assetWorkspaceAdapter, "loadConversationSummaries").mockResolvedValue([]);
  vi.spyOn(assetWorkspaceAdapter, "loadCurrentRequirements").mockResolvedValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); router.replace.mockReset(); router.push.mockReset(); });

async function mountDraft(omitProduct = false) {
  const logout = vi.fn();
  const rendered = render(<AssetsWorkspaceClient accountEmail="draft@multimix.local" token="token"
    initialConversationId="project-1" initialProductId={omitProduct ? undefined : "asset-88"} onLogout={logout} />);
  const workspace = await screen.findByRole("region", { name: "Current product workspace" });
  fireEvent.click(within(workspace).getByRole("button", { name: "编辑" }));
  const editor = screen.getByRole("textbox", { name: "编辑文案稿" });
  fireEvent.change(editor, { target: { value: "重要的未保存草稿" } });
  await waitFor(() => expect(screen.getByRole("button", { name: "发送" })).toBeEnabled());
  return { ...rendered, editor, logout };
}

describe("workspace draft navigation", () => {
  it("keeps narrow navigation reachable and releases it before draft confirmation", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) });
    vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [], nextOffset: null });
    const { container } = await mountDraft();
    const header = container.querySelector(".shadcn-prototype-chat-head")!;
    const opener = within(header as HTMLElement).getByRole("button", { name: "展开侧边栏" });
    opener.focus();
    fireEvent.click(opener);
    const navigation = await screen.findByRole("dialog", { name: "工作台导航" });
    await waitFor(() => expect(within(navigation).getByRole("button", { name: "隐藏侧边栏" })).toHaveFocus());
    expect(container.querySelector(".shadcn-prototype-inset")).toHaveAttribute("inert");
    fireEvent.click(within(navigation).getAllByRole("button", { name: "资产库" }).at(-1)!);
    expect(screen.queryByRole("dialog", { name: "工作台导航" })).not.toBeInTheDocument();
    const confirmation = await screen.findByRole("dialog");
    fireEvent.click(within(confirmation).getByRole("button", { name: "取消" }));
    const restored = await screen.findByRole("dialog", { name: "工作台导航" });
    fireEvent.keyDown(restored, { key: "Escape" });
    await waitFor(() => expect(opener).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "编辑文案稿" })).toHaveValue("重要的未保存草稿");
    fireEvent.click(opener);
    fireEvent.click(within(await screen.findByRole("dialog", { name: "工作台导航" })).getAllByRole("button", { name: "资产库" }).at(-1)!);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" })); });
    await screen.findByRole("heading", { name: "资产库" });
    expect(screen.queryByRole("dialog", { name: "工作台导航" })).not.toBeInTheDocument();
    expect(container.querySelector(".shadcn-prototype-topbar button[aria-label='展开侧边栏']")).toBeInTheDocument();
  });

  it("exposes navigation on the new-project screen without submitting a message", async () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) });
    window.history.replaceState(null, "", "/app/assets");
    render(<AssetsWorkspaceClient accountEmail="draft@multimix.local" token="token" />);
    const start = await screen.findByRole("region", { name: "新建对话" });
    fireEvent.click(within(start).getByRole("button", { name: "展开侧边栏" }));
    const navigation = await screen.findByRole("dialog", { name: "工作台导航" });
    expect(within(navigation).getByRole("navigation", { name: "资源库" })).toBeInTheDocument();
    fireEvent.click(within(navigation).getByRole("button", { name: "关闭导航遮罩" }));
    expect(screen.queryByRole("dialog", { name: "工作台导航" })).not.toBeInTheDocument();
    expect(within(start).getByRole("textbox")).toHaveValue("");
  });

  it.each(["project", "other-library", "same-library"])(
    "keeps the user's current destination when a library upload finishes (%s)", async (destination) => {
      const listLibrary = vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows: [], nextOffset: null });
      let finishUpload!: (asset: Awaited<ReturnType<typeof assetWorkspaceAdapter.uploadAsset>>) => void;
      const upload = vi.spyOn(assetWorkspaceAdapter, "uploadAsset").mockReturnValueOnce(
        new Promise((resolve) => { finishUpload = resolve; }),
      );
      const { container } = await mountDraft();
      fireEvent.click(screen.getAllByRole("button", { name: "资产库" })[0]);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" })); });
      await screen.findByRole("heading", { name: "资产库" });
      const input = container.querySelector('header input[type="file"]')!;
      const file = new File(["source"], "source.txt", { type: "text/plain" });
      fireEvent.change(input, { target: { files: [file] } });
      expect(upload).toHaveBeenCalledWith("token", file, "assets", undefined, expect.any(String));
      expect(upload.mock.calls[0]?.[4]).toMatch(/^[\w-]{16,}$/);
      if (destination === "project") {
        fireEvent.click(screen.getByRole("link", { name: "草稿项目" }));
        const workspace = await screen.findByRole("region", { name: "Current product workspace" });
        fireEvent.click(within(workspace).getByRole("button", { name: "编辑" }));
        fireEvent.change(screen.getByRole("textbox", { name: "编辑文案稿" }), { target: { value: "上传期间的新草稿" } });
      } else if (destination === "other-library") {
        fireEvent.click(screen.getAllByRole("button", { name: "文案库" })[0]);
        await screen.findByRole("heading", { name: "文案库" });
      }
      const readsBeforeCompletion = listLibrary.mock.calls.length;
      await act(async () => { finishUpload({} as Awaited<ReturnType<typeof assetWorkspaceAdapter.uploadAsset>>); });
      if (destination === "project") {
        expect(screen.getByRole("textbox", { name: "编辑文案稿" })).toHaveValue("上传期间的新草稿");
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("heading", { name: destination === "other-library" ? "文案库" : "资产库" })).toBeVisible();
        await waitFor(() => expect(listLibrary.mock.calls.length).toBeGreaterThan(readsBeforeCompletion));
      }
      expect(upload).toHaveBeenCalledOnce();
    },
  );

  it.each(["product", "project", "library", "new", "home", "logout"])(
    "keeps the draft when cancelling %s navigation", async (entry) => {
      const { container, editor, logout } = await mountDraft();
      const action = entry === "product" ? container.querySelector('a[href$="product=asset-89"]')!
        : entry === "project" ? screen.getByRole("link", { name: "另一个项目" })
          : entry === "library" ? screen.getAllByRole("button", { name: "文案库" })[0]
            : entry === "new" ? screen.getAllByRole("button", { name: "新建项目" })[0]
              : entry === "home" ? screen.getAllByRole("link", { name: "返回主页" })[0]
                : screen.getByRole("button", { name: "退出登录" });
      fireEvent.click(action);
      const dialog = screen.getByRole("dialog", { name: "放弃未保存的修改并离开？" });
      await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "取消" })); });
      await waitFor(() => expect(editor).toHaveValue("重要的未保存草稿"));
      expect(logout).not.toHaveBeenCalled();
      expect(router.push).not.toHaveBeenCalled();
    },
  );

  it("switches product only after an accepted discard", async () => {
    const { container, editor } = await mountDraft();
    fireEvent.click(container.querySelector('a[href$="product=asset-89"]')!);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "放弃修改并离开" })); });
    await waitFor(() => expect(editor).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: "Current product workspace" })).toHaveTextContent("文稿 B");
  });

  it("does not let a late summary refresh bypass a cancelled URL navigation", async () => {
    const { rerender, editor, logout } = await mountDraft();
    let resolveSummary!: (value: []) => void;
    vi.mocked(assetWorkspaceAdapter.loadConversationSummaries).mockReturnValueOnce(
      new Promise<[]>((resolve) => { resolveSummary = resolve; }),
    );
    window.history.pushState(null, "", "/app/assets?conversation=project-1&product=asset-89");
    rerender(<AssetsWorkspaceClient accountEmail="draft@multimix.local" token="token"
      initialConversationId="project-1" initialProductId="asset-89" onLogout={logout} />);
    const dialog = screen.getByRole("dialog", { name: "放弃未保存的修改并离开？" });
    await act(async () => { resolveSummary([]); });
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "取消" })); });
    expect(editor).toHaveValue("重要的未保存草稿");
    expect(router.replace).toHaveBeenLastCalledWith(expect.stringContaining("product=asset-88"));
  });

  it.each([false, true])("keeps editing focus when a result adds a product (implicit selection: %s)", async (implicit) => {
    const third = { ...second, id: "asset-90", backendAssetId: 90, title: "文稿 C", contentHash: "hash-90" };
    vi.spyOn(assetWorkspaceAdapter, "sendMessage").mockResolvedValue({ conversationId: conversation.id,
      conversation: { ...conversation, product: third, products: [product, second, third] }, product: third,
      generationJob: null, agentAction: null });
    const { editor } = await mountDraft(implicit);
    fireEvent.change(screen.getByLabelText("输入对话内容"), { target: { value: "再生成一份文稿" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(assetWorkspaceAdapter.sendMessage).toHaveBeenCalledOnce());
    await waitFor(() => expect(editor).toHaveValue("重要的未保存草稿"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Current product workspace" })).not.toHaveTextContent("文稿 C");
  });
});
