// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStart from "../components/conversation-start";
import ConversationStudio from "../components/conversation-studio";
import LibraryWorkshop from "../components/library-workshop";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import { resolveRuntimeWriteCapabilities } from "../lib/runtime-write-capabilities";

const availableWrites = resolveRuntimeWriteCapabilities({
  backendConfigured: true,
  hasToken: true,
  connectionState: "available",
});

function conversation() {
  return {
    ...assetWorkspaceAdapter.getNewConversation(),
    id: "conversation-accessibility",
    detailsLoaded: true,
    readonly: false,
    suggestions: [],
  };
}

function copyRow(): LibraryRow {
  return {
    assetId: 31,
    title: "无障碍详情文案",
    meta: "文案稿 · 已入库",
    note: "验证详情弹层焦点生命周期。",
    kind: "copy",
    category: "文案稿",
    statusLabel: "已入库",
    updatedLabel: "刚刚",
  };
}

function mockLibrary(rows: LibraryRow[]) {
  vi.spyOn(assetWorkspaceAdapter, "isBackendEnabled").mockReturnValue(true);
  vi.spyOn(assetWorkspaceAdapter, "listLibrary").mockResolvedValue({ rows, nextOffset: null });
  vi.spyOn(assetWorkspaceAdapter, "listPublicSources").mockResolvedValue([]);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LibraryWorkshop dialog accessibility", () => {
  it("traps the detail dialog, isolates the background, and restores the row trigger", async () => {
    const row = copyRow();
    mockLibrary([row]);
    render(
      <div>
        <button type="button">库外背景操作</button>
        <LibraryWorkshop
          view="copy"
          token="token-library-detail-a11y"
          writeCapabilities={availableWrites}
        />
      </div>,
    );

    const outsideButton = screen.getByRole("button", { name: "库外背景操作" });
    const grid = await screen.findByLabelText("文案库列表");
    const trigger = within(grid).getByRole("button", { name: /无障碍详情文案/ });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = await screen.findByRole("dialog", { name: "无障碍详情文案详情" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    const close = within(dialog).getByRole("button", { name: "关闭详情" });
    const backgroundSurface = grid.closest(".shadcn-prototype-workshop-body");
    expect(backgroundSurface).not.toBeNull();
    await waitFor(() => expect(close).toHaveFocus());
    expect(outsideButton).toHaveAttribute("inert");
    expect(backgroundSurface).toHaveAttribute("aria-hidden", "true");

    const last = within(dialog).getByRole("button", { name: "删除" });
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(close).toHaveFocus();
    close.focus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.keyDown(close, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(backgroundSurface).not.toHaveAttribute("aria-hidden");
  });

  it("names and restores the public-search and web-capture dialogs", async () => {
    mockLibrary([]);
    render(
      <LibraryWorkshop
        view="assets"
        token="token-library-tools-a11y"
        writeCapabilities={availableWrites}
      />,
    );

    const publicTrigger = await screen.findByRole("button", { name: "公开素材搜索" });
    publicTrigger.focus();
    fireEvent.click(publicTrigger);
    const publicDialog = await screen.findByRole("dialog", { name: "公开素材搜索" });
    expect(publicDialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(within(publicDialog).getByRole("textbox", { name: "关键词" })).toHaveFocus());
    fireEvent.keyDown(publicDialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "公开素材搜索" })).not.toBeInTheDocument());
    expect(publicTrigger).toHaveFocus();

    const webTrigger = screen.getByRole("button", { name: "读取网页" });
    webTrigger.focus();
    fireEvent.click(webTrigger);
    const webDialog = await screen.findByRole("dialog", { name: "读取网页资料" });
    expect(webDialog).toHaveAttribute("aria-modal", "true");
    await waitFor(() => expect(within(webDialog).getByRole("textbox", { name: "URL" })).toHaveFocus());
    fireEvent.keyDown(webDialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "读取网页资料" })).not.toBeInTheDocument());
    expect(webTrigger).toHaveFocus();
  });
});

async function submitRepeatedError(
  composer: HTMLElement,
  submitButton: HTMLElement,
  alert: HTMLElement,
) {
  fireEvent.change(composer, { target: { value: "触发相同错误" } });
  fireEvent.click(submitButton);
  await waitFor(() => expect(alert).not.toBeEmptyDOMElement());
  const firstAnnouncement = alert.firstElementChild;
  const firstText = alert.textContent;

  fireEvent.change(composer, { target: { value: "再次触发相同错误" } });
  fireEvent.click(submitButton);
  await waitFor(() => expect(alert.firstElementChild).not.toBe(firstAnnouncement));
  expect(alert.textContent).toBe(firstText);
  expect(screen.getByRole("alert")).toBe(alert);
}

describe("stable composer error announcements", () => {
  it("re-announces the same ConversationStart async error from one stable alert", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("相同异步错误"));
    render(
      <ConversationStart
        suggestions={[]}
        conversation={conversation()}
        onSend={onSend}
        writeCapabilities={availableWrites}
      />,
    );

    const alert = screen.getByTestId("conversation-start-error-announcer");
    expect(alert).toBeEmptyDOMElement();
    await submitRepeatedError(
      screen.getByLabelText("输入对话内容"),
      screen.getByRole("button", { name: "发送" }),
      alert,
    );
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it("re-announces the same ConversationStudio async error without changing runtime status semantics", async () => {
    const onSendMessage = vi.fn().mockRejectedValue(new Error("相同异步错误"));
    render(
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onSendMessage={onSendMessage}
        onPendingExchangeChange={vi.fn()}
        writeCapabilities={availableWrites}
      />,
    );

    const alert = screen.getByTestId("conversation-studio-error-announcer");
    expect(alert).toBeEmptyDOMElement();
    await submitRepeatedError(
      screen.getByLabelText("输入对话内容"),
      screen.getByRole("button", { name: "发送" }),
      alert,
    );
    expect(onSendMessage).toHaveBeenCalledTimes(2);
  });
});

describe("email-only authentication copy", () => {
  it("keeps the application, current prototype, and production E2E selectors on email", () => {
    const paths = [
      "app/multimix-app.tsx",
      "docs/specs/ui/prototypes/current/screens/login.html",
      "e2e/pdf-video-quality.spec.ts",
      "e2e/video-pipeline-production.spec.ts",
    ];
    const sources = paths.map((path) => readFileSync(resolve(process.cwd(), path), "utf8"));

    for (const source of sources) {
      expect(source).not.toContain("邮箱或手机号");
    }
    expect(sources[0]).toContain("<span>邮箱</span>");
    expect(sources[0]).toContain('type="email"');
    expect(sources[1]).toContain("<label>邮箱</label>");
    expect(sources[2]).toContain('getByLabel("邮箱")');
    expect(sources[3]).toContain('getByLabel("邮箱")');
  });
});
