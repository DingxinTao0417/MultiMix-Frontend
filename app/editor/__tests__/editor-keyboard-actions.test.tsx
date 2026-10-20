// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { invokeAction } from "@editor/lib/actions";
import { useKeybindingsStore } from "@editor/stores/keybindings-store";
import { useEditorKeyboardActions } from "../use-editor-keyboard-actions";
vi.mock("@editor/lib/actions", async () => ({ ...(await import("@editor/lib/actions/definitions")), invokeAction: vi.fn() }));
function Harness({ enabled = true }: { enabled?: boolean }) { useEditorKeyboardActions(enabled); return <div data-testid="canvas" tabIndex={0} />; }
function key(target: EventTarget = window, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: "s", code: "KeyS", bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event); return event;
}
beforeEach(() => { vi.clearAllMocks(); useKeybindingsStore.getState().resetToDefaults(); useKeybindingsStore.setState({ overlayDepth: 0, openOverlayIds: [], isLoadingProject: false, isRecording: false }); });
afterEach(() => { cleanup(); document.body.innerHTML = ""; });
describe("editor keyboard ownership", () => {
  it("handles an action once after rerender and removes the listener on unload", () => {
    const view = render(<Harness />); view.rerender(<Harness />);
    expect(key().defaultPrevented).toBe(true); expect(invokeAction).toHaveBeenCalledExactlyOnceWith("split", undefined, "keypress");
    view.unmount(); key(); expect(invokeAction).toHaveBeenCalledTimes(1);
  });
  it("reads customized bindings without installing another listener", () => {
    render(<Harness />); useKeybindingsStore.getState().updateKeybinding("s", "delete-selected"); key();
    expect(invokeAction).toHaveBeenCalledWith("delete-selected", undefined, "keypress");
  });
  it.each(["input", "textarea", "select", "div[contenteditable]", "div[role=textbox]"])("leaves native typing and modified copy alone in %s", (kind) => {
    render(<Harness />); const element = document.createElement(kind.split("[")[0]);
    if (kind.includes("contenteditable")) element.setAttribute("contenteditable", "true");
    if (kind.includes("textbox")) element.setAttribute("role", "textbox");
    document.body.append(element);
    expect(key(element).defaultPrevented).toBe(false);
    expect(key(element, { key: "c", code: "KeyC", ctrlKey: true, metaKey: true }).defaultPrevented).toBe(false);
    expect(invokeAction).not.toHaveBeenCalled();
  });
  it("does not intercept contenteditable descendants, dialog, IME or handled events", () => {
    render(<Harness />); const editable = document.createElement("div"); editable.setAttribute("contenteditable", "true");
    const span = editable.appendChild(document.createElement("span")); document.body.append(editable); key(span);
    key(window, { isComposing: true }); const handled = new KeyboardEvent("keydown", { key: "s", cancelable: true }); handled.preventDefault(); window.dispatchEvent(handled);
    const dialog = document.createElement("dialog"); dialog.setAttribute("open", ""); document.body.append(dialog); key();
    expect(invokeAction).not.toHaveBeenCalled();
  });
  it.each(["overlayDepth", "isLoadingProject", "isRecording"] as const)("respects current %s", (field) => {
    render(<Harness />); useKeybindingsStore.setState({ [field]: field === "overlayDepth" ? 1 : true }); key(); expect(invokeAction).not.toHaveBeenCalled();
  });
  it("disables actions for loading/preview and does not repeat destructive keys", () => {
    const view = render(<Harness enabled={false} />); key(); expect(invokeAction).not.toHaveBeenCalled();
    view.rerender(<Harness />); key(window, { repeat: true }); expect(invokeAction).not.toHaveBeenCalled();
  });
});
