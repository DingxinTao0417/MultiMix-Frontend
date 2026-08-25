"use client";

import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";

import VoiceoverEditor, { type VoiceoverApi } from "../../editor/VoiceoverEditor";
import type { AssetProductSegment } from "../lib/asset-workspace-types";
import useDialogFocusManagement from "../lib/use-dialog-focus-management";

export default function VoiceoverDialog({
  open,
  assetId,
  segment,
  token,
  api,
  onClose,
  onProjectUpdated,
}: {
  open: boolean;
  assetId: string;
  segment: AssetProductSegment | null;
  token: string;
  api?: VoiceoverApi;
  onClose: () => void;
  onProjectUpdated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useDialogFocusManagement({
    open: open && Boolean(segment),
    dialogRef,
    initialFocusRef: closeButtonRef,
    onEscape: requestClose,
  });

  if (!open || !segment) return null;

  const title = `修改分镜 #${segment.index} 配音`;
  return (
    <div
      className="shadcn-prototype-picker-mask"
      data-testid="voiceover-dialog-mask"
      role="presentation"
      onClick={requestClose}
    >
      <div
        ref={dialogRef}
        className="shadcn-prototype-picker shadcn-prototype-voiceover-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shadcn-prototype-picker-head">
          <div>
            <div className="shadcn-prototype-picker-title">{title}</div>
            <div className="shadcn-prototype-picker-sub">先试听再应用，失败不会修改当前视频。</div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="shadcn-prototype-picker-close"
            aria-label="关闭"
            disabled={busy}
            onClick={requestClose}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="shadcn-prototype-voiceover-dialog-body">
          <VoiceoverEditor
            key={segment.id}
            assetId={assetId}
            segmentId={segment.id}
            token={token}
            narration={segment.line ?? ""}
            currentVoiceName={segment.voiceName}
            api={api}
            initiallyExpanded
            onBusyChange={setBusy}
            onCancel={requestClose}
            onProjectUpdated={onProjectUpdated}
          />
        </div>
      </div>
    </div>
  );
}
