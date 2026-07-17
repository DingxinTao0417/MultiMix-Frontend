// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import type { AssetMessagePlan } from "../lib/asset-workspace-types";

type PendingExchange = NonNullable<ComponentProps<typeof ConversationStudio>["pendingExchange"]>;

const videoPlan: AssetMessagePlan = {
  title: "视频方案",
  status: "pending",
  fields: [
    { key: "format", label: "视频形式", value: "横屏 16:9 · 真实" },
    { key: "duration", label: "时长", value: "约 30 秒 · 4 个分镜" },
  ],
  confirmLabel: "确认",
  confirmUtterance: "确认，生成视频工程",
};

const conversationA = {
  ...assetWorkspaceAdapter.getNewConversation(),
  id: "conversation-a",
  title: "短视频 A",
  detailsLoaded: true,
  messages: [{ role: "assistant" as const, text: "已生成编导稿。", plan: videoPlan }],
};

const conversationB = {
  ...assetWorkspaceAdapter.getNewConversation(),
  id: "conversation-b",
  title: "短视频 B",
  detailsLoaded: true,
  messages: [{ role: "assistant" as const, text: "这是另一个对话。" }],
};

function rejectWhenAborted(signal?: AbortSignal): Promise<void> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
}

function ConversationSwitchHarness({
  onRequestSignal,
}: {
  onRequestSignal: (signal: AbortSignal | undefined) => void;
}) {
  const [selectedId, setSelectedId] = useState(conversationA.id);
  const [pendingByConversation, setPendingByConversation] = useState<Record<string, PendingExchange>>({});
  const selectedConversation = selectedId === conversationA.id ? conversationA : conversationB;

  return (
    <>
      <button type="button" onClick={() => setSelectedId(conversationB.id)}>切到对话 B</button>
      <button type="button" onClick={() => setSelectedId(conversationA.id)}>返回对话 A</button>
      <ConversationStudio
        basePath="/app/assets"
        selectedConversation={selectedConversation}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        pendingExchange={pendingByConversation[selectedId] ?? null}
        onPendingExchangeChange={(conversationId, exchange) => {
          setPendingByConversation((current) => {
            const next = { ...current };
            if (exchange) next[conversationId] = exchange;
            else delete next[conversationId];
            return next;
          });
        }}
        onSendMessage={async (_conversation, _instruction, signal) => {
          onRequestSignal(signal);
          await rejectWhenAborted(signal);
        }}
      />
    </>
  );
}

afterEach(cleanup);

describe("video confirmation while switching conversations", () => {
  it("keeps the confirmation request alive when the user switches conversations", () => {
    let requestSignal: AbortSignal | undefined;
    render(<ConversationSwitchHarness onRequestSignal={(signal) => { requestSignal = signal; }} />);

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    expect(requestSignal).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "切到对话 B" }));

    expect(requestSignal?.aborted).toBe(false);
  });

  it("restores the optimistic confirmed plan and execution card after returning", () => {
    render(<ConversationSwitchHarness onRequestSignal={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "确认" }));
    fireEvent.click(screen.getByRole("button", { name: "切到对话 B" }));
    fireEvent.click(screen.getByRole("button", { name: "返回对话 A" }));

    expect(screen.getByLabelText("视频方案 · 已确认")).toBeInTheDocument();
    expect(screen.getByText("创建视频工程任务")).toBeInTheDocument();
  });

  it("still aborts an ordinary message request when switching conversations", () => {
    let requestSignal: AbortSignal | undefined;
    render(<ConversationSwitchHarness onRequestSignal={(signal) => { requestSignal = signal; }} />);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "把语气改得更口语" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(requestSignal).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "切到对话 B" }));

    expect(requestSignal?.aborted).toBe(true);
  });
});
