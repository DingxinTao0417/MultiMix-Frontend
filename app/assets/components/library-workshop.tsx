"use client";

import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, MessageSquareText, Video } from "lucide-react";
import { assetWorkspaceAdapter, type LibraryRow } from "../lib/asset-workspace-adapter";
import type { ActiveView } from "../lib/asset-workspace-shared";

export default function LibraryWorkshop({ view, token = null }: { view: Exclude<ActiveView, "conversation">; token?: string | null }) {
  const workshop = assetWorkspaceAdapter.getWorkshop(view);
  const [backendRows, setBackendRows] = useState<LibraryRow[] | null>(null);

  useEffect(() => {
    if (!token || !assetWorkspaceAdapter.isBackendEnabled()) {
      setBackendRows(null);
      return;
    }
    let cancelled = false;
    void assetWorkspaceAdapter
      .listLibrary(token, view)
      .then((rows) => {
        if (!cancelled) setBackendRows(rows);
      })
      .catch(() => {
        if (!cancelled) setBackendRows(null);
      });
    return () => {
      cancelled = true;
    };
  }, [token, view]);

  // Prefer real backend rows when available; otherwise show the mock workshop rows.
  const rows = backendRows ?? workshop.rows;

  return (
    <section className="shadcn-prototype-card shadcn-prototype-workshop" aria-label={workshop.title}>
      <div className="shadcn-prototype-workshop-body">
        <div className="shadcn-prototype-workshop-metrics">
          {workshop.metrics.map((metric) => (
            <article key={metric.label}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
              <em>{metric.detail}</em>
            </article>
          ))}
        </div>

        <div className="shadcn-prototype-workshop-list">
          {rows.length === 0 ? (
            <article className="shadcn-prototype-workshop-empty">
              <div>
                <strong>暂无内容</strong>
                <p>上传资料或在对话中生成产物后，会在这里出现。</p>
              </div>
            </article>
          ) : (
            rows.map((row) => (
              <article key={`${row.kind}-${row.title}`}>
                <span className="shadcn-prototype-file-icon">
                  {row.kind === "video" ? <Video size={15} aria-hidden="true" /> : null}
                  {row.kind === "image" ? <ImageIcon size={15} aria-hidden="true" /> : null}
                  {row.kind === "copy" ? <MessageSquareText size={15} aria-hidden="true" /> : null}
                  {row.kind === "file" ? <FileText size={15} aria-hidden="true" /> : null}
                </span>
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.meta}</span>
                  <p>{row.note}</p>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
