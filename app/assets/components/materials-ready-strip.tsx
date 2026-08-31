"use client";

import { useEffect, useState } from "react";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";

const READY_LABELS = new Set(["已理解", "已解析"]);
const PROCESSING_LABELS = new Set(["理解中", "待理解", "待处理", "处理中"]);

// 起始页「素材已就绪」横条（spec §5.6）：活徽章 + 已解析/处理中计数 + 最多
// 5 张缩略图。读的是真实图片库状态；没有已就绪素材时整条隐藏（§12）。
export default function MaterialsReadyStrip({
  token,
  onOpenImageLibrary,
}: {
  token?: string | null;
  onOpenImageLibrary?: () => void;
}) {
  const [backendRows, setBackendRows] = useState<LibraryRow[]>([]);

  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setBackendRows([]);
      return;
    }
    let cancelled = false;
    assetWorkspaceAdapter
      .listLibrary(token, "image")
      .then((page) => {
        if (!cancelled) setBackendRows(page.rows);
      })
      .catch(() => {
        if (!cancelled) setBackendRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const rows = backendRows;
  const ready = rows.filter((row) => READY_LABELS.has(row.statusLabel ?? ""));
  const processing = rows.filter((row) => PROCESSING_LABELS.has(row.statusLabel ?? ""));
  if (!ready.length) return null;

  return (
    <div className="shadcn-prototype-start-ready" aria-label="素材就绪状态">
      <div className="shadcn-prototype-start-ready-text">
        <span className="shadcn-prototype-start-ready-title">
          你的素材可以开始做视频了
          <span className="shadcn-prototype-start-ready-badge">
            <span className="dot" aria-hidden="true" />
            已理解
          </span>
        </span>
        <span className="shadcn-prototype-start-ready-meta">
          {ready.length} 张已解析{processing.length ? ` · ${processing.length} 张处理中` : ""}
        </span>
      </div>
      <div className="shadcn-prototype-start-ready-thumbs" aria-hidden="true">
        {ready.slice(0, 5).map((row, index) => (
          <span className="shadcn-prototype-start-ready-thumb" key={row.assetId ?? `${row.title}-${index}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- dynamic blob:/remote thumbnail URLs are unsupported by next/image */}
            {row.previewUrl ? <img src={row.previewUrl} alt="" loading="lazy" /> : null}
          </span>
        ))}
      </div>
      {onOpenImageLibrary ? (
        <button type="button" className="shadcn-prototype-start-ready-link" onClick={onOpenImageLibrary}>
          查看图片库 →
        </button>
      ) : null}
    </div>
  );
}
