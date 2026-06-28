"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";

export default function ConversationStart({ suggestions }: { suggestions: string[] }) {
  const [composerValue, setComposerValue] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeComposer = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "52px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  useEffect(() => {
    if (composerRef.current) {
      resizeComposer(composerRef.current);
    }
  }, [composerValue]);

  return (
    <section className="shadcn-prototype-start" aria-label="新建创作">
      <div className="shadcn-prototype-start-inner">
        <h1>开始创作</h1>
        <p>告诉我你要生成什么，我会先确认产物类型和关键参数，再在右侧展示结果。</p>
        <div className="shadcn-prototype-start-composer">
          <textarea
            ref={composerRef}
            aria-label="输入创作指令"
            placeholder="输入内容目标、渠道、视频规格或成片指令"
            rows={1}
            value={composerValue}
            onChange={(event) => setComposerValue(event.currentTarget.value)}
            onInput={(event) => resizeComposer(event.currentTarget)}
          />
          <button className="primary" type="button" aria-label="发送">
            <ArrowUp size={17} aria-hidden="true" />
          </button>
        </div>
        {suggestions.length > 0 ? (
          <div className="shadcn-prototype-start-suggestions" aria-label="推荐指令">
            {suggestions.map((suggestion) => (
              <button
                type="button"
                key={suggestion}
                onClick={() => {
                  setComposerValue(suggestion);
                  requestAnimationFrame(() => {
                    composerRef.current?.focus();
                    if (composerRef.current) {
                      resizeComposer(composerRef.current);
                    }
                  });
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
