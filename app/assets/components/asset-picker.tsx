"use client";

import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { getProductRatioClass } from "../lib/asset-workspace-shared";
import type { SegmentMaterialOption } from "../lib/asset-workspace-types";

// One selectable material in the picker grid.
export type AssetPickerItem = SegmentMaterialOption;

// Material selector modal (spec §5.5 换素材 / demo final/workspace-video.html).
// `recommended` renders the "AI 推荐" section; when empty the section is hidden
// and only the library grid shows (spec §12: 推荐端点不可用时推荐区隐藏). Pure and
// controlled — the parent owns open/close and performs the actual swap on select.
export default function AssetPicker({
  open,
  title,
  subtitle,
  ratio = "",
  recommended = [],
  library,
  loading = false,
  submitting = false,
  error = "",
  onSelect,
  onClose,
  onUpload,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  ratio?: string;
  recommended?: AssetPickerItem[];
  library: AssetPickerItem[];
  loading?: boolean;
  submitting?: boolean;
  error?: string;
  onSelect: (item: AssetPickerItem) => void;
  onClose: () => void;
  onUpload?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedId(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, title]);

  const selectedItem = useMemo(
    () => [...recommended, ...library].find((item) => item.id === selectedId) ?? null,
    [library, recommended, selectedId],
  );

  if (!open) return null;

  const renderGrid = (items: AssetPickerItem[], withReason: boolean) => (
    <div className="shadcn-prototype-picker-grid">
      {items.map((item) => (
        <button
          type="button"
          className={`shadcn-prototype-picker-item${item.id === selectedId ? " selected" : ""}`}
          key={item.id}
          aria-pressed={item.id === selectedId}
          onClick={() => setSelectedId(item.id)}
        >
          <span className="shadcn-prototype-picker-thumb" aria-hidden={item.thumbnailUrl ? undefined : true}>
            {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" loading="lazy" /> : null}
          </span>
          <span className="shadcn-prototype-picker-name" title={item.title}>{item.title}</span>
          {withReason && item.reason ? <span className="shadcn-prototype-picker-why">{item.reason}</span> : null}
        </button>
      ))}
    </div>
  );

  return (
    <div className="shadcn-prototype-picker-mask" role="presentation" onClick={onClose}>
      <div className={`shadcn-prototype-picker ${getProductRatioClass(ratio)}`.trim()} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="shadcn-prototype-picker-head">
          <div>
            <div className="shadcn-prototype-picker-title">{title}</div>
            {subtitle ? <div className="shadcn-prototype-picker-sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="shadcn-prototype-picker-close" aria-label="关闭" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {loading ? <p className="shadcn-prototype-picker-empty" role="status">素材加载中…</p> : null}
        {error ? <p className="shadcn-prototype-picker-error" role="alert">{error}</p> : null}

        {!loading && recommended.length ? (
          <>
            <div className="shadcn-prototype-picker-sec">
              <span className="shadcn-prototype-picker-sec-dot" aria-hidden="true" />
              AI 推荐 · 和这段最匹配
            </div>
            {renderGrid(recommended, true)}
          </>
        ) : null}

        {!loading ? <div className="shadcn-prototype-picker-sec">素材库 · 已理解的素材</div> : null}
        {!loading && library.length ? (
          renderGrid(library, false)
        ) : !loading ? (
          <p className="shadcn-prototype-picker-empty">素材库暂时没有已理解的素材。</p>
        ) : null}

        <div className="shadcn-prototype-picker-foot">
          <span>
            没有合适的？
            <button type="button" className="shadcn-prototype-picker-link" onClick={() => onUpload?.()} disabled={!onUpload}>
              去上传 →
            </button>
          </span>
          <span className="shadcn-prototype-picker-actions">
            <button type="button" onClick={onClose} disabled={submitting}>取消</button>
            <button type="button" className="primary" disabled={!selectedItem || submitting} onClick={() => selectedItem && onSelect(selectedItem)}>
              {submitting ? "替换中…" : "确认替换"}
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}
