// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProductWorkspace from "../components/product-workspace";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { AssetProduct, AssetConversation } from "../lib/asset-workspace-types";


const product: AssetProduct = {
  id: "asset-88",
  backendAssetId: 88,
  contentType: "social_post",
  contentHash: "base-hash",
  mode: "copy",
  title: "家装服务文案",
  status: "有来源",
  summary: "家装服务文案",
  ratio: "Markdown",
  duration: "2 段",
  phase: "文案稿",
  body: ["家装服务文案", "原正文"],
  markdownBody: "# 家装服务文案\n\n原正文",
  sections: [],
  timeline: [],
  actions: [],
};

const conversation: AssetConversation = {
  id: "conversation-1",
  title: "家装服务",
  type: "llm-generation",
  updatedAt: "刚刚",
  assetLabel: "对话产物",
  status: "active",
  prompt: "",
  response: "",
  canvasTitle: product.title,
  canvasMeta: "",
  raw: product.markdownBody ?? "",
  judgment: "",
  action: "",
  delivery: "",
  suggestions: [],
  messages: [],
  product,
  products: [product],
  sourceIds: [],
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

type TextEditResult = Awaited<ReturnType<typeof assetWorkspaceAdapter.saveTextEdit>>;
function pendingSave() {
  let resolve!: (result: TextEditResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<TextEditResult>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const editorName = "编辑文案稿";
function edit(body: string) {
  fireEvent.click(screen.getByRole("button", { name: /^编辑$/ }));
  fireEvent.change(screen.getByRole("textbox", { name: editorName }), { target: { value: body } });
}


describe("text artifact editing", () => {
  it.each(["discard", "keep", "typing", "external-update"])(
    "ends only an explicitly discarded conflict session (%s)", async (choice) => {
      const latest = { ...product, contentHash: "external-hash", markdownBody: "外部已保存的最新正文" };
      const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockResolvedValue({ kind: "saved", product: latest });
      const props = { copied: false, onCopyProduct: vi.fn(), onSaveProduct: vi.fn(), onProductUpdated: vi.fn(),
        product, selectedConversation: conversation, token: "token" };
      const { rerender } = render(<ProductWorkspace {...props} />);
      edit("未保存草稿");
      rerender(<ProductWorkspace {...props} product={latest} />);
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
      if (choice === "typing") fireEvent.change(screen.getByRole("textbox", { name: editorName, hidden: true }), { target: { value: "确认期间的新输入" } });
      if (choice === "external-update") rerender(<ProductWorkspace {...props} product={{ ...latest, contentHash: "newer-hash", markdownBody: "更晚的外部正文" }} />);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: choice === "keep" ? "取消" : "放弃修改" })); });
      if (choice !== "discard") {
        expect(screen.getByRole("textbox", { name: editorName })).toHaveValue(choice === "typing" ? "确认期间的新输入" : "未保存草稿");
        expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
        expect(save).not.toHaveBeenCalled();
        return;
      }
      expect(screen.queryByRole("textbox", { name: editorName })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "编辑" }));
      expect(screen.getByRole("textbox", { name: editorName })).toHaveValue(latest.markdownBody);
      expect(screen.queryByRole("button", { name: "读取最新版本" })).not.toBeInTheDocument();
      expect(screen.getByText("尚未修改")).toBeVisible();
      expect(save).not.toHaveBeenCalled();
      fireEvent.change(screen.getByRole("textbox", { name: editorName }), { target: { value: "基于最新正文继续修改" } });
      expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
      await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ product: latest, body: "基于最新正文继续修改" })));
    },
  );

  it("uses the latest read-only conflict snapshot after discarding without posting it", async () => {
    const latest = { ...product, contentHash: "latest-read-hash", markdownBody: "只读取得的最新正文" };
    const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockRejectedValue(Object.assign(new Error("版本冲突"), { code: "edit_version_conflict" }));
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockResolvedValue({ ...conversation, product: latest, products: [latest] });
    const props = { copied: false, onCopyProduct: vi.fn(), onSaveProduct: vi.fn(), onProductUpdated: vi.fn(),
      product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("待放弃草稿");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByText(/版本冲突：/);
    fireEvent.click(screen.getByRole("button", { name: "读取最新版本" }));
    await screen.findByRole("button", { name: "采用最新正文" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "放弃修改" })); });
    expect(props.onProductUpdated).toHaveBeenCalledWith(latest, product);
    rerender(<ProductWorkspace {...props} product={latest} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue(latest.markdownBody);
    expect(screen.queryByRole("button", { name: "读取最新版本" })).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledOnce();
  });

  it.each(["cancel", "confirm", "typing"])("checks dirty draft navigation (%s)", async (choice) => {
    let guard!: () => boolean | Promise<boolean>;
    let canLeaveSilently!: () => boolean;
    const unregister = vi.fn();
    const register = vi.fn((next: typeof guard, silent: () => boolean) => {
      guard = next; canLeaveSilently = silent; return unregister;
    });
    const { unmount } = render(<ProductWorkspace copied={false} onCopyProduct={vi.fn()} onSaveProduct={vi.fn()}
      product={product} selectedConversation={conversation} token="token" onRegisterBeforeLeave={register} />);
    expect(guard()).toBe(true);
    expect(canLeaveSilently()).toBe(true);
    edit("未保存草稿");
    expect(canLeaveSilently()).toBe(false);
    let result!: boolean | Promise<boolean>;
    act(() => { result = guard(); });
    if (choice === "typing") fireEvent.change(screen.getByRole("textbox", { name: editorName, hidden: true }), { target: { value: "后续输入" } });
    fireEvent.click(screen.getByRole("dialog")
      .querySelector(choice === "cancel" ? "footer button:first-child" : "footer button:last-child")!);
    expect(await result).toBe(choice === "confirm");
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue(choice === "typing" ? "后续输入" : "未保存草稿");
    unmount();
    expect(unregister).toHaveBeenCalled();
  });

  it("preserves a dirty draft and its base when the same product is externally updated", () => {
    const props = { copied: false, onCopyProduct: vi.fn(), onSaveProduct: vi.fn(),
      product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("我的未保存草稿");
    rerender(<ProductWorkspace {...props} product={{ ...product, contentHash: "external-hash", markdownBody: "外部新正文" }} />);
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("我的未保存草稿");
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    fireEvent.click(screen.getByText("查看最新已保存正文"));
    expect(screen.getByText("外部新正文")).toBeVisible();
  });

  it("preserves typing during save, including parent echo, and uses the accepted hash next time", async () => {
    const pending = pendingSave();
    const updated = { ...product, contentHash: "accepted-hash", markdownBody: "# 提交正文" };
    const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ kind: "saved", product: { ...updated, contentHash: "final-hash", markdownBody: "# 提交正文\n新增文字" } });
    const props = { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined),
      onProductUpdated: vi.fn(), product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("# 提交正文"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    fireEvent.change(screen.getByRole("textbox", { name: editorName }), { target: { value: "# 提交正文\n新增文字" } });
    await act(async () => { pending.resolve({ kind: "saved", product: updated }); });
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("# 提交正文\n新增文字");
    expect(screen.getByText("本次已保存，新增文字仍未保存")).toBeVisible();
    expect(screen.queryByText("已保存", { exact: true })).not.toBeInTheDocument();
    rerender(<ProductWorkspace {...props} product={updated} />);
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("# 提交正文\n新增文字");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ product: updated, body: "# 提交正文\n新增文字" })));
  });

  it("ignores structural confirmation for a submission superseded by new typing", async () => {
    const pending = pendingSave();
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(pending.promise);
    render(<ProductWorkspace copied={false} onCopyProduct={vi.fn()} onSaveProduct={vi.fn()} product={product} selectedConversation={conversation} token="token" />);
    edit("旧提交"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    fireEvent.change(screen.getByRole("textbox", { name: editorName }), { target: { value: "新草稿" } });
    await act(async () => { pending.resolve({ kind: "structural_change", message: "旧结构确认", changes: {} }); });
    expect(screen.queryByText("旧结构确认")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("新草稿");
  });

  it("does not seed a newer visible product with an older delayed save result", async () => {
    const pending = pendingSave();
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(pending.promise);
    const props = { copied: false, onCopyProduct: vi.fn(), onSaveProduct: vi.fn(), onProductUpdated: vi.fn(), product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("旧提交"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    const newer = { ...product, contentHash: "newer-server", markdownBody: "已经同步的更新版本" };
    rerender(<ProductWorkspace {...props} product={newer} />);
    await act(async () => { pending.resolve({ kind: "saved", product: { ...product, contentHash: "older-response", markdownBody: "旧提交" } }); });
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("旧提交");
    fireEvent.click(screen.getByText("查看最新已保存正文"));
    expect(screen.getByText("已经同步的更新版本")).toBeVisible();
    expect(props.onProductUpdated).not.toHaveBeenCalled();
  });

  it("synchronizes a completed save when returning to A in browse mode", async () => {
    const pending = pendingSave();
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(pending.promise);
    const publish = vi.fn();
    const props = { copied: false, onCopyProduct: vi.fn(), onSaveProduct: vi.fn(), onProductUpdated: publish, product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("A 已保存"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    rerender(<ProductWorkspace {...props} product={{ ...product, id: "asset-89", backendAssetId: 89 }} />);
    rerender(<ProductWorkspace {...props} />);
    const updated = { ...product, contentHash: "accepted-a", markdownBody: "A 已保存" };
    await act(async () => { pending.resolve({ kind: "saved", product: updated }); });
    expect(publish).toHaveBeenCalledWith(updated, product);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("A 已保存");
  });

  it.each([true, false])("reads a conflict without losing the draft and requires explicit choice (keep=%s)", async (keepDraft) => {
    const latest = { ...product, contentHash: "latest-hash", markdownBody: "最新服务端正文" };
    const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit")
      .mockRejectedValueOnce(Object.assign(new Error("版本冲突"), { status: 409, code: "edit_version_conflict" }))
      .mockResolvedValueOnce({ kind: "saved", product: { ...latest, markdownBody: "我的草稿" } });
    const read = vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail")
      .mockRejectedValueOnce(new Error("读取失败，请重试"))
      .mockResolvedValueOnce({ ...conversation, product: latest, products: [latest] });
    const props = { copied: false, onCopyProduct: vi.fn(), onSaveProduct: vi.fn(), onProductUpdated: vi.fn(), product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("我的草稿"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByText(/版本冲突：/);
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "读取最新版本" }));
    await screen.findByText("读取失败，请重试");
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("我的草稿");
    fireEvent.click(screen.getByRole("button", { name: "读取最新版本" }));
    await screen.findByRole("button", { name: "保留草稿，继续编辑" });
    expect(read).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("查看最新已保存正文"));
    expect(screen.getByText("最新服务端正文")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: keepDraft ? "保留草稿，继续编辑" : "采用最新正文" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(props.onProductUpdated).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: keepDraft ? "确认保留草稿" : "确认采用最新正文" }));
    await waitFor(() => expect(props.onProductUpdated).toHaveBeenCalledWith(latest, product));
    rerender(<ProductWorkspace {...props} product={latest} />);
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue(keepDraft ? "我的草稿" : "最新服务端正文");
    expect(save).toHaveBeenCalledTimes(1);
    if (keepDraft) {
      fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
      await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ product: latest, body: "我的草稿" })));
    } else expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
  });

  it.each(["navigation", "auth", "draft", "unmount"])("ignores stale conflict reading/confirmation after %s", async (change) => {
    const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockRejectedValueOnce(Object.assign(new Error("版本冲突"), { code: "edit_version_conflict" }));
    const latest = { ...product, contentHash: "latest-hash", markdownBody: "服务端新正文" };
    let resolve!: (detail: AssetConversation) => void;
    vi.spyOn(assetWorkspaceAdapter, "loadConversationDetail").mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const props = { copied: false, onCopyProduct: vi.fn(), onSaveProduct: vi.fn(), onProductUpdated: vi.fn(), product, selectedConversation: conversation, token: "token" };
    const { rerender, unmount } = render(<ProductWorkspace {...props} />);
    edit("我的草稿"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    await screen.findByText(/版本冲突：/);
    fireEvent.click(screen.getByRole("button", { name: "读取最新版本" }));
    if (change === "navigation") {
      rerender(<ProductWorkspace {...props} product={{ ...product, id: "asset-89", backendAssetId: 89 }} />);
      edit("B 未保存文字");
    }
    if (change === "auth") { rerender(<ProductWorkspace {...props} token="other" />); rerender(<ProductWorkspace {...props} />); }
    if (change === "unmount") unmount();
    await act(async () => { resolve({ ...conversation, product: latest, products: [latest] }); });
    if (change === "draft") {
      fireEvent.click(screen.getByRole("button", { name: "采用最新正文" }));
      fireEvent.change(screen.getByRole("textbox", { name: editorName, hidden: true }), { target: { value: "确认期间的新文字" } });
      fireEvent.click(screen.getByRole("button", { name: "确认采用最新正文" }));
      await act(async () => {});
      expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("确认期间的新文字");
    } else if (change !== "unmount") {
      expect(screen.queryByRole("button", { name: "采用最新正文" })).not.toBeInTheDocument();
      if (change === "navigation") expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("B 未保存文字");
    }
    expect(props.onProductUpdated).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it("enters full markdown editing and saves a non-structural edit in one click", async () => {
    const updated = { ...product, contentHash: "next-hash", markdownBody: "# 家装服务文案\n\n修改后的正文" };
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockResolvedValue({ kind: "saved", product: updated });
    const onProductUpdated = vi.fn();

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        onProductUpdated={onProductUpdated}
        product={product}
        selectedConversation={conversation}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("textbox", { name: "编辑文案稿" });
    fireEvent.change(editor, { target: { value: "# 家装服务文案\n\n修改后的正文" } });
    expect(screen.getByText("有未保存修改")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(assetWorkspaceAdapter.saveTextEdit).toHaveBeenCalledWith({
      token: "token",
      product,
      body: "# 家装服务文案\n\n修改后的正文",
      acceptStructuralChange: false,
    }));
    expect(onProductUpdated).toHaveBeenCalledWith(updated, product);
    expect(screen.queryByRole("textbox", { name: "编辑文案稿" })).not.toBeInTheDocument();
  });

  it("keeps editing when structural validation requires an explicit new-structure save", async () => {
    const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit")
      .mockResolvedValueOnce({
        kind: "structural_change",
        message: "检测到分镜结构变化，原版本尚未被覆盖。",
        changes: { scene_count: { before: 4, after: 3 } },
      })
      .mockResolvedValueOnce({ kind: "saved", product: { ...product, contentHash: "next-hash" } });

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={{ ...product, contentType: "video_script", phase: "编导稿" }}
        selectedConversation={conversation}
        token="token"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "编辑编导脚本" }), {
      target: { value: "# 家装编导稿\n\n### 1. 开场\n- 口播：新的开场" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("原版本尚未被覆盖");
    expect(screen.getByRole("button", { name: "返回修改" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "按新结构保存" }));
    await waitFor(() => expect(save).toHaveBeenLastCalledWith(expect.objectContaining({
      acceptStructuralChange: true,
    })));
  });

  it.each(["success", "failure", "structure"])("keeps B's unsaved editing when A finishes with %s", async (outcome) => {
    const pending = pendingSave();
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(pending.promise);
    const publishA = vi.fn();
    const props = { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined),
      onProductUpdated: publishA, product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("# A 修改正文");
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    const other = { ...product, id: "asset-89", backendAssetId: 89, contentHash: "b-hash", markdownBody: "# B 原正文" };
    rerender(<ProductWorkspace {...props} product={other} onProductUpdated={vi.fn()} />);
    edit("# B 尚未保存的文字");
    const updatedA = { ...product, contentHash: "saved-a", markdownBody: "# A 修改正文" };
    await act(async () => {
      if (outcome === "failure") pending.reject(new Error("A 保存失败"));
      else pending.resolve(outcome === "structure" ? { kind: "structural_change", message: "A 需要结构确认", changes: {} }
        : { kind: "saved", product: updatedA });
    });
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("# B 尚未保存的文字");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("已保存", { exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
    if (outcome === "success") expect(publishA).toHaveBeenCalledWith(updatedA, product);
    else expect(publishA).not.toHaveBeenCalled();
  });

  it("does not let A's finally clear B's own pending save", async () => {
    const a = pendingSave(); const b = pendingSave();
    const save = vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const publish = vi.fn();
    const props = { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined),
      onProductUpdated: publish, product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("# A 修改正文"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    const other = { ...product, id: "asset-89", backendAssetId: 89, contentHash: "b-hash", markdownBody: "# B 原正文" };
    rerender(<ProductWorkspace {...props} product={other} />);
    edit("# B 修改正文"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    expect(save).toHaveBeenCalledTimes(2);
    await act(async () => { a.resolve({ kind: "saved", product: { ...product, contentHash: "saved-a" } }); });
    expect(screen.getByRole("button", { name: "校验并保存中…" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("# B 修改正文");
    await act(async () => { b.resolve({ kind: "saved", product: { ...other, contentHash: "saved-b", markdownBody: "# B 修改正文" } }); });
    expect(screen.queryByRole("textbox", { name: editorName })).not.toBeInTheDocument();
  });

  it("preserves a new A editing session after A to B to A navigation", async () => {
    const pending = pendingSave();
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(pending.promise);
    const publish = vi.fn();
    const props = { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined),
      onProductUpdated: publish, product, selectedConversation: conversation, token: "token" };
    const { rerender } = render(<ProductWorkspace {...props} />);
    edit("# A 旧修改"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    rerender(<ProductWorkspace {...props} product={{ ...product, id: "asset-89", backendAssetId: 89 }} />);
    rerender(<ProductWorkspace {...props} />);
    edit("# A 新编辑会话的未保存文字");
    await act(async () => { pending.resolve({ kind: "saved", product: { ...product, contentHash: "saved-old", markdownBody: "# A 旧修改" } }); });
    expect(screen.getByRole("textbox", { name: editorName })).toHaveValue("# A 新编辑会话的未保存文字");
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "保存修改" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保留草稿，继续编辑" })).toBeVisible();
  });

  it.each(["auth", "unmount", "identity"])("does not publish an invalid text response after %s", async (change) => {
    const pending = pendingSave();
    vi.spyOn(assetWorkspaceAdapter, "saveTextEdit").mockReturnValueOnce(pending.promise);
    const publish = vi.fn();
    const props = { copied: false, onCopyProduct: vi.fn(async () => undefined), onSaveProduct: vi.fn(async () => undefined),
      onProductUpdated: publish, product, selectedConversation: conversation, token: "token" };
    const { rerender, unmount } = render(<ProductWorkspace {...props} />);
    edit("# A 修改正文"); fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
    if (change === "auth") { rerender(<ProductWorkspace {...props} token="new-token" />); rerender(<ProductWorkspace {...props} />); }
    if (change === "unmount") unmount();
    await act(async () => { pending.resolve({ kind: "saved", product: { ...product, ...(change === "identity" ? { backendAssetId: 999 } : {}) } }); });
    expect(publish).not.toHaveBeenCalled();
  });
});
