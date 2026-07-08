"use client";

import { useEffect } from "react";
import { X } from "lucide-react";

// One selectable material in the picker grid.
export type AssetPickerItem = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  // Recommendation reason, shown under AI-recommended items only.
  reason?: string;
};

// Material selector modal (spec §5.5 换素材 / demo final/workspace-video.html).
// `recommended` renders the "AI 推荐" section; when empty the section is hidden
// and only the library grid shows (spec §12: 推荐端点不可用时推荐区隐藏). Pure and
// controlled — the parent owns open/close and performs the actual swap on select.
export default function AssetPicker({
  open,
  title,
  subtitle,
  recommended = [],
  library,
  onSelect,
  onClose,
  onUpload,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  recommended?: AssetPickerItem[];
  library: AssetPickerItem[];
  onSelect: (item: AssetPickerItem) => void;
  onClose: () => void;
  onUpload?: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const renderGrid = (items: AssetPickerItem[], withReason: boolean) => (
    <div className="shadcn-prototype-picker-grid">
      {items.map((item) => (
        <button type="button" className="shadcn-prototype-picker-item" key={item.id} onClick={() => onSelect(item)}>
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
      <div className="shadcn-prototype-picker" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="shadcn-prototype-picker-head">
          <div>
            <div className="shadcn-prototype-picker-title">{title}</div>
            {subtitle ? <div className="shadcn-prototype-picker-sub">{subtitle}</div> : null}
          </div>
          <button type="button" className="shadcn-prototype-picker-close" aria-label="关闭" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>

        {recommended.length ? (
          <>
            <div className="shadcn-prototype-picker-sec">
              <span className="shadcn-prototype-picker-sec-dot" aria-hidden="true" />
              AI 推荐 · 和这段最匹配
            </div>
            {renderGrid(recommended, true)}
          </>
        ) : null}

        <div className="shadcn-prototype-picker-sec">图片库 · 已理解的素材</div>
        {library.length ? (
          renderGrid(library, false)
        ) : (
          <p className="shadcn-prototype-picker-empty">图片库暂时没有已理解的素材。</p>
        )}

        <div className="shadcn-prototype-picker-foot">
          没有合适的？
          <button type="button" className="shadcn-prototype-picker-link" onClick={() => onUpload?.()} disabled={!onUpload}>
            去上传 →
          </button>
        </div>
      </div>
    </div>
  );
}
