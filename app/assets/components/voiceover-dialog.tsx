"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

import VoiceoverEditor, { type VoiceoverApi } from "../../editor/VoiceoverEditor";
import type { AssetProductSegment } from "../lib/asset-workspace-types";

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
  const requestClose = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, requestClose]);

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
        className="shadcn-prototype-picker shadcn-prototype-voiceover-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shadcn-prototype-picker-head">
          <div>
            <div className="shadcn-prototype-picker-title">{title}</div>
            <div className="shadcn-prototype-picker-sub">先试听再应用，失败不会修改当前视频。</div>
          </div>
          <button
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
