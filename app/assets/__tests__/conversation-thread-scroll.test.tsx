// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

afterEach(cleanup);

const conversation = {
  ...assetWorkspaceAdapter.getNewConversation(),
  id: "project-a",
  title: "项目 A",
  detailsLoaded: false,
  messages: [{ role: "assistant" as const, text: "方案待确认" }],
};

function renderStudio(selectedConversation: typeof conversation) {
  return <ConversationStudio
    basePath="/app/assets"
    selectedConversation={selectedConversation}
    selectedProduct={null}
    onSelectProduct={vi.fn()}
  />;
}

describe("conversation thread visibility", () => {
  it("shows the latest actionable content after detail load", () => {
    const view = render(renderStudio(conversation));
    const thread = view.container.querySelector<HTMLDivElement>(".shadcn-prototype-thread")!;
    Object.defineProperties(thread, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 250 },
    });

    view.rerender(renderStudio({ ...conversation, detailsLoaded: true }));

    expect(thread.scrollTop).toBe(650);
  });

  it("does not pull readers down, but resumes following after they return to the bottom", () => {
    const view = render(renderStudio({ ...conversation, detailsLoaded: true }));
    const thread = view.container.querySelector<HTMLDivElement>(".shadcn-prototype-thread")!;
    Object.defineProperties(thread, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 250 },
    });
    thread.scrollTop = 100;
    fireEvent.scroll(thread);

    view.rerender(renderStudio({
      ...conversation,
      detailsLoaded: true,
      messages: [...conversation.messages, { role: "assistant", text: "新进度" }],
    }));
    expect(thread.scrollTop).toBe(100);

    thread.scrollTop = 650;
    fireEvent.scroll(thread);
    Object.defineProperty(thread, "scrollHeight", { configurable: true, value: 1000 });
    view.rerender(renderStudio({
      ...conversation,
      detailsLoaded: true,
      messages: [...conversation.messages, { role: "assistant", text: "下一条进度" }],
    }));
    expect(thread.scrollTop).toBe(750);
  });

  it("positions a different project at its latest message even after reading old history", () => {
    const view = render(renderStudio({ ...conversation, detailsLoaded: true }));
    const thread = view.container.querySelector<HTMLDivElement>(".shadcn-prototype-thread")!;
    Object.defineProperties(thread, {
      scrollHeight: { configurable: true, value: 900 },
      clientHeight: { configurable: true, value: 250 },
    });
    thread.scrollTop = 100;
    fireEvent.scroll(thread);

    view.rerender(renderStudio({ ...conversation, id: "project-b", title: "项目 B", detailsLoaded: true }));

    expect(thread.scrollTop).toBe(650);
  });
});
