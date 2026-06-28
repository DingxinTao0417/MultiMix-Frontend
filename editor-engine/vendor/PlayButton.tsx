import { useEffect } from "react";
import { useEditor } from "@editor/hooks/use-editor";

// Reliable play/pause control that drives PlaybackManager directly.
// (OpenCut's own preview play button isn't wired in this embed.)
export function PlayButton() {
  const editor = useEditor();
  const playing = useEditor((e) => e.playback.getIsPlaying());
  const currentTime = useEditor((e) => e.playback.getCurrentTime());
  const total = useEditor((e) => e.timeline.getLastSeekableTime());

  // Spacebar toggles play/pause (ignored while typing in inputs).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      editor.playback.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editor]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={() => editor.playback.toggle()}
        style={{ padding: "6px 16px", fontSize: 14, background: "#2d6cdf", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
        {playing ? "⏸ 暂停" : "▶ 播放"}
      </button>
      <button onClick={() => editor.playback.seek({ time: 0 })}
        style={{ padding: "6px 12px", fontSize: 13, background: "#444", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
        ⏮
      </button>
      <span style={{ fontSize: 13, color: "#aaa", fontVariantNumeric: "tabular-nums" }}>
        {currentTime.toFixed(1)} / {total.toFixed(1)}s
      </span>
      <span style={{ fontSize: 12, color: "#666" }}>空格播放/暂停</span>
    </div>
  );
}

