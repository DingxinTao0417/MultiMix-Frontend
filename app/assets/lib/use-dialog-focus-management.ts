"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

type IsolationRecord = {
  count: number;
  hadAriaHidden: boolean;
  ariaHidden: string | null;
  hadInert: boolean;
  inert: string | null;
};

const isolationRecords = new WeakMap<HTMLElement, IsolationRecord>();

function isFocusable(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (element.closest("[inert], [aria-hidden='true']")) return false;
  let current: HTMLElement | null = element;
  while (current && current !== document.body) {
    const style = window.getComputedStyle(current);
    if (current.hidden || style.display === "none" || style.visibility === "hidden") return false;
    current = current.parentElement;
  }
  return true;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(isFocusable);
}

function isolate(element: HTMLElement) {
  const existing = isolationRecords.get(element);
  if (existing) {
    existing.count += 1;
    return;
  }
  isolationRecords.set(element, {
    count: 1,
    hadAriaHidden: element.hasAttribute("aria-hidden"),
    ariaHidden: element.getAttribute("aria-hidden"),
    hadInert: element.hasAttribute("inert"),
    inert: element.getAttribute("inert"),
  });
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
}

function release(element: HTMLElement) {
  const record = isolationRecords.get(element);
  if (!record) return;
  record.count -= 1;
  if (record.count > 0) return;
  isolationRecords.delete(element);

  if (element.getAttribute("aria-hidden") === "true") {
    if (record.hadAriaHidden) {
      element.setAttribute("aria-hidden", record.ariaHidden ?? "");
    } else {
      element.removeAttribute("aria-hidden");
    }
  }
  if (element.hasAttribute("inert")) {
    if (record.hadInert) {
      element.setAttribute("inert", record.inert ?? "");
    } else {
      element.removeAttribute("inert");
    }
  }
}

function isolateOutside(dialog: HTMLElement): HTMLElement[] {
  const isolated: HTMLElement[] = [];
  let branch: HTMLElement | null = dialog;
  while (branch && branch !== document.body) {
    const parent: HTMLElement | null = branch.parentElement;
    if (!parent) break;
    for (const sibling of parent.children) {
      if (sibling !== branch && sibling instanceof HTMLElement) {
        isolate(sibling);
        isolated.push(sibling);
      }
    }
    branch = parent;
  }
  return isolated;
}

function safeFocus(element: HTMLElement | null): boolean {
  if (!element || !isFocusable(element)) return false;
  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

function restoreFocus(target: HTMLElement | null) {
  if (!target) return;
  const candidates: HTMLElement[] = [];
  let current: HTMLElement | null = target;
  while (current && current !== document.body) {
    if (current === target || current.tabIndex >= 0) candidates.push(current);
    current = current.parentElement;
  }
  for (const candidate of candidates) {
    if (!safeFocus(candidate)) continue;
    if (candidate !== target) queueMicrotask(() => safeFocus(target));
    return;
  }
}

export default function useDialogFocusManagement({
  open,
  dialogRef,
  initialFocusRef,
  onEscape,
}: {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape: () => void;
}) {
  const onEscapeRef = useRef(onEscape);
  const lastFocusedOutsideRef = useRef<HTMLElement | null>(null);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    const trackOutsideFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement
        && target !== document.body
        && !dialogRef.current?.contains(target)
      ) {
        lastFocusedOutsideRef.current = target;
      }
    };
    const current = document.activeElement;
    if (current instanceof HTMLElement && current !== document.body) {
      lastFocusedOutsideRef.current = current;
    }
    document.addEventListener("focusin", trackOutsideFocus, true);
    return () => document.removeEventListener("focusin", trackOutsideFocus, true);
  }, [dialogRef]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const activeElement = document.activeElement;
    const restoreTarget = activeElement instanceof HTMLElement
      && activeElement !== document.body
      && !dialog.contains(activeElement)
      ? activeElement
      : lastFocusedOutsideRef.current;
    const isolated = isolateOutside(dialog);
    let active = true;

    const focusInside = (preferLast = false) => {
      const focusable = focusableElements(dialog);
      const preferred = initialFocusRef?.current;
      const target = preferred && isFocusable(preferred)
        ? preferred
        : preferLast
          ? focusable.at(-1)
          : focusable[0];
      safeFocus(target ?? dialog);
    };

    queueMicrotask(() => {
      if (active && dialog.isConnected) focusInside();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        safeFocus(dialog);
        return;
      }
      const current = document.activeElement;
      if (!(current instanceof HTMLElement) || !dialog.contains(current)) {
        event.preventDefault();
        focusInside(event.shiftKey);
        return;
      }
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if ((!event.shiftKey && current === last) || (event.shiftKey && current === first)) {
        event.preventDefault();
        safeFocus(event.shiftKey ? last : first);
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) {
        focusInside();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      active = false;
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      for (const element of isolated.reverse()) release(element);
      queueMicrotask(() => restoreFocus(restoreTarget));
    };
  }, [dialogRef, initialFocusRef, open]);
}
