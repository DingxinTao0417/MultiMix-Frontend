"use client";

import { useEffect } from "react";
import { invokeAction } from "@editor/lib/actions";
import { useKeybindingsStore } from "@editor/stores/keybindings-store";

export function useEditorKeyboardActions(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handle = (event: KeyboardEvent) => {
      const state = useKeybindingsStore.getState();
      const target = event.target instanceof Element ? event.target : null;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || state.overlayDepth > 0
        || state.isLoadingProject || state.isRecording
        || document.querySelector('[role="dialog"][data-state="open"], dialog[open], [aria-modal="true"]')
        || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]')) return;
      const key = state.getKeybindingString(event);
      const action = key ? state.keybindings[key] : undefined;
      if (!action || event.repeat) return;
      event.preventDefault();
      invokeAction(action, undefined, "keypress");
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [enabled]);
}
