"use client";

import { useCallback, useId, useRef, useState } from "react";
import { X } from "lucide-react";

import useDialogFocusManagement from "../assets/lib/use-dialog-focus-management";

export type ConfirmationDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "取消",
  tone = "default",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useDialogFocusManagement({
    open,
    dialogRef,
    initialFocusRef: cancelButtonRef,
    onEscape: () => {
      if (!busy) onCancel();
    },
  });

  if (!open) return null;

  return (
    <div
      className="multimix-confirmation-mask"
      role="presentation"
      onClick={busy ? undefined : onCancel}
    >
      <section
        ref={dialogRef}
        className="multimix-confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label="关闭确认窗口" disabled={busy} onClick={onCancel}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <p id={descriptionId}>{description}</p>
        <footer>
          <button ref={cancelButtonRef} type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "danger" : "primary"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

type ConfirmationRequest = Omit<
  ConfirmationDialogProps,
  "open" | "busy" | "onCancel" | "onConfirm"
>;

export function useConfirmationDialog() {
  type PendingRequest = {
    options: ConfirmationRequest;
    resolve: (confirmed: boolean) => void;
    returnFocus: HTMLElement | null;
  };
  const [request, setRequest] = useState<PendingRequest | null>(null);
  const requestRef = useRef<PendingRequest | null>(null);

  const finish = useCallback((confirmed: boolean) => {
    const current = requestRef.current;
    if (!current) return;
    requestRef.current = null;
    setRequest(null);
    current.resolve(confirmed);
    queueMicrotask(() => current.returnFocus?.focus());
  }, []);

  const confirm = useCallback((options: ConfirmationRequest) => new Promise<boolean>((resolve) => {
    requestRef.current?.resolve(false);
    const nextRequest = {
      options,
      resolve,
      returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    requestRef.current = nextRequest;
    setRequest(nextRequest);
  }), []);

  const confirmationDialog = request ? (
    <ConfirmationDialog
      open
      {...request.options}
      onCancel={() => finish(false)}
      onConfirm={() => finish(true)}
    />
  ) : null;

  return { confirm, confirmationDialog };
}
