// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, type ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ConversationStart from "../components/conversation-start";
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";
import { shouldSubmitComposerOnEnter } from "../lib/asset-workspace-shared";

afterEach(cleanup);

type StartSend = NonNullable<ComponentProps<typeof ConversationStart>["onSend"]>;
type StudioSend = NonNullable<ComponentProps<typeof ConversationStudio>["onSendMessage"]>;

describe("shouldSubmitComposerOnEnter", () => {
  it("accepts a plain non-shifted Enter", () => {
    expect(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: false })).toBe(true);
  });

  it("rejects Shift+Enter so the newline survives", () => {
    expect(shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: true })).toBe(false);
  });

  it("rejects non-Enter keys", () => {
    expect(shouldSubmitComposerOnEnter({ key: "a" })).toBe(false);
  });

  it("rejects a composing Enter through the direct isComposing flag", () => {
    expect(
      shouldSubmitComposerOnEnter({ key: "Enter", shiftKey: false, isComposing: true }),
    ).toBe(false);
  });

  it("rejects a composing Enter through the projected nativeEvent flag", () => {
    expect(
      shouldSubmitComposerOnEnter({
        key: "Enter",
        shiftKey: false,
        nativeEvent: { isComposing: true },
      }),
    ).toBe(false);
  });
});

function conversation() {
  return {
    ...assetWorkspaceAdapter.getNewConversation(),
    id: "conversation-1",
    detailsLoaded: true,
    suggestions: [],
  };
}

// jsdom does not implement KeyboardEvent.isComposing, so project the flag onto
// the dispatched native event exactly like a real IME keydown carries it.
function fireEnterKeyDown(
  element: HTMLElement,
  options: { shiftKey?: boolean; isComposing?: boolean } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Enter",
    shiftKey: options.shiftKey ?? false,
    bubbles: true,
    cancelable: true,
  });
  if (typeof options.isComposing === "boolean") {
    Object.defineProperty(event, "isComposing", {
      value: options.isComposing,
      configurable: true,
    });
  }
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

function renderStart(onSend: StartSend) {
  render(
    <ConversationStart
      suggestions={[]}
      conversation={conversation()}
      onSend={onSend}
    />,
  );
  return screen.getByLabelText("输入对话内容");
}

function renderStudio(onSendMessage: StudioSend) {
  render(
    <ConversationStudio
      basePath="/app/assets"
      selectedConversation={conversation()}
      selectedProduct={null}
      onSelectProduct={vi.fn()}
      onSendMessage={onSendMessage}
    />,
  );
  return screen.getByLabelText("输入对话内容");
}

describe("ConversationStart composer Enter", () => {
  it("does not send while the IME composition is active", () => {
    const onSend = vi.fn<StartSend>().mockResolvedValue(undefined);
    const textarea = renderStart(onSend);
    fireEvent.change(textarea, { target: { value: "你好" } });
    fireEvent.compositionStart(textarea);

    const event = fireEnterKeyDown(textarea, { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("sends exactly once on plain Enter after compositionend", async () => {
    const onSend = vi.fn<StartSend>().mockResolvedValue(undefined);
    const textarea = renderStart(onSend);
    fireEvent.change(textarea, { target: { value: "你好" } });
    fireEvent.compositionStart(textarea);
    fireEnterKeyDown(textarea, { isComposing: true });

    // The composing Enter must not consume the input or send anything yet.
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEnterKeyDown(textarea);

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]?.[1]).toBe("你好");
  });

  it("keeps Shift+Enter as a newline without sending", () => {
    const onSend = vi.fn<StartSend>().mockResolvedValue(undefined);
    const textarea = renderStart(onSend);
    fireEvent.change(textarea, { target: { value: "第一行" } });

    const event = fireEnterKeyDown(textarea, { shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("ConversationStudio composer Enter", () => {
  it("does not send while the IME composition is active", () => {
    const onSendMessage = vi.fn<StudioSend>().mockResolvedValue(undefined);
    const textarea = renderStudio(onSendMessage);
    fireEvent.change(textarea, { target: { value: "你好" } });
    fireEvent.compositionStart(textarea);

    const event = fireEnterKeyDown(textarea, { isComposing: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("sends exactly once on plain Enter after compositionend", async () => {
    const onSendMessage = vi.fn<StudioSend>().mockResolvedValue(undefined);
    const textarea = renderStudio(onSendMessage);
    fireEvent.change(textarea, { target: { value: "你好" } });
    fireEvent.compositionStart(textarea);
    fireEnterKeyDown(textarea, { isComposing: true });

    // The composing Enter must not consume the input or send anything yet.
    expect(onSendMessage).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    fireEnterKeyDown(textarea);

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage.mock.calls[0]?.[1]).toBe("你好");
  });

  it("keeps Shift+Enter as a newline without sending", () => {
    const onSendMessage = vi.fn<StudioSend>().mockResolvedValue(undefined);
    const textarea = renderStudio(onSendMessage);
    fireEvent.change(textarea, { target: { value: "第一行" } });

    const event = fireEnterKeyDown(textarea, { shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
    expect(onSendMessage).not.toHaveBeenCalled();
  });
});
