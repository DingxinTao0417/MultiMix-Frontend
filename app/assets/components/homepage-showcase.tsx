"use client";

import { useEffect, useRef, useState } from "react";

import {
  APPROVED_HOMEPAGE_CASES,
  publishableHomepageCases,
  type HomepageShowcaseCase,
} from "../lib/homepage-showcase-cases";

type HomepageShowcaseProps = {
  cases?: readonly HomepageShowcaseCase[];
};

export default function HomepageShowcase({
  cases = APPROVED_HOMEPAGE_CASES,
}: HomepageShowcaseProps) {
  const availableCases = publishableHomepageCases(cases);
  const [selectedCase, setSelectedCase] = useState<HomepageShowcaseCase | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (selectedCase && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
    }
  }, [selectedCase]);

  if (availableCases.length === 0) return null;

  return (
    <section className="shadcn-prototype-start-showcase" aria-labelledby="conversation-start-showcase">
      <div className="shadcn-prototype-start-showcase-head">
        <h2 id="conversation-start-showcase">看看能做出什么</h2>
        <p>真实成片，制作过程按需查看</p>
      </div>
      <div className="shadcn-prototype-start-showcase-grid">
        {availableCases.map((item) => (
          <button
            className="shadcn-prototype-start-showcase-card"
            key={item.id}
            onClick={() => setSelectedCase(item)}
            type="button"
            aria-label={`查看「${item.title}」的制作过程`}
          >
            <span
              className="shadcn-prototype-start-showcase-poster"
              style={{ backgroundImage: `url("${item.posterUrl}")` }}
              aria-hidden="true"
            >
              <span className="shadcn-prototype-start-showcase-play">▶</span>
            </span>
            <span className="shadcn-prototype-start-showcase-copy">
              <span className="shadcn-prototype-start-showcase-path">{item.startPath}</span>
              <strong>{item.title}</strong>
              <span>提供了：{item.provided}</span>
              <span>做成了：{item.result}</span>
              <span className="shadcn-prototype-start-showcase-link">查看案例与制作过程 →</span>
            </span>
          </button>
        ))}
      </div>
      <dialog
        className="shadcn-prototype-start-showcase-dialog"
        ref={dialogRef}
        onClose={() => setSelectedCase(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        {selectedCase ? (
          <div className="shadcn-prototype-start-showcase-detail">
            <div className="shadcn-prototype-start-showcase-detail-head">
              <div>
                <span className="shadcn-prototype-start-showcase-path">{selectedCase.startPath}</span>
                <h2>{selectedCase.title}</h2>
              </div>
              <button type="button" onClick={() => dialogRef.current?.close()} aria-label="关闭案例详情">
                关闭
              </button>
            </div>
            <div className="shadcn-prototype-start-showcase-media">
              {selectedCase.originalVideoUrl ? (
                <div>
                  <h3>原片</h3>
                  <video controls playsInline preload="none" poster={selectedCase.originalPosterUrl} src={selectedCase.originalVideoUrl} />
                </div>
              ) : null}
              <div>
                <h3>最终成片</h3>
                <video controls playsInline preload="none" poster={selectedCase.posterUrl} src={selectedCase.videoUrl} />
              </div>
            </div>
            <div className="shadcn-prototype-start-showcase-summary">
              <p><strong>用户提供</strong>{selectedCase.provided}</p>
              <p><strong>最终成果</strong>{selectedCase.result}</p>
            </div>
            <h3 className="shadcn-prototype-start-showcase-process-title">制作过程</h3>
            <ol className="shadcn-prototype-start-showcase-process">
              {selectedCase.process.map((step, index) => (
                <li key={`${step.label}-${index}`}>
                  <strong>{step.label}</strong>
                  <span>{step.summary}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </dialog>
    </section>
  );
}
