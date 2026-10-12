"use client";
import { useEffect, useRef, useState } from "react";
import type { ClarityCandidate } from "../lib/video-clarity-types";
import { clarityRange } from "../lib/video-clarity-presentation";
import VideoPreviewPlayer from "./video-preview-player";
import styles from "./video-clarity.module.css";

const MAX_COMPARISON_DRIFT_SECONDS = .04;

export default function VideoClarityComparison({ candidate }: { candidate: ClarityCandidate }) {
  const original = useRef<HTMLVideoElement>(null), enhanced = useRef<HTMLVideoElement>(null);
  const [nativeSize, setNativeSize] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    const a = original.current, b = enhanced.current;
    if (!a || !b) return;
    const pair = (source: HTMLVideoElement, target: HTMLVideoElement) => {
      const seek = () => { if (Math.abs(source.currentTime - target.currentTime) > MAX_COMPARISON_DRIFT_SECONDS) target.currentTime = source.currentTime; };
      const play = () => { seek(); if (target.paused) void target.play().catch(() => { source.pause(); setFailed(true); }); };
      const pause = () => { if (!target.paused) target.pause(); };
      const names = ["seeking", "timeupdate", "play", "pause", "ended"] as const, callbacks = [seek, seek, play, pause, pause];
      names.forEach((name, index) => source.addEventListener(name, callbacks[index]));
      return () => names.forEach((name, index) => source.removeEventListener(name, callbacks[index]));
    };
    const cleanA = pair(a, b), cleanB = pair(b, a);
    return () => { cleanA(); cleanB(); a.pause(); b.pause(); };
  }, [candidate.candidate_id, candidate.comparison]);
  const comparison = candidate.comparison;
  if (!comparison || comparison.preview_independently_reviewed !== false) return <p>比较预览暂不可用，请刷新后再核对。</p>;
  return <section className={styles.card} aria-label="画质候选对比">
    <h3>{candidate.scene_id} · {clarityRange(candidate.start_seconds, candidate.end_seconds)}</h3>
    <p>同一完整分镜同步对比。两份均为编码预览，未经独立画质复检；合格结论来自原生候选。原声在采用时保留。</p>
    <label><input type="checkbox" checked={nativeSize} onChange={e => setNativeSize(e.target.checked)} />按原尺寸查看局部细节</label>
    <div className={styles.grid}>{(["original", "candidate"] as const).map(kind => {
      const media = comparison[kind];
      return <div className={styles.viewport} key={kind}>
        <p>{kind === "original" ? "原版完整分镜" : "增强候选 · 尚未采用"}</p>
        <div style={nativeSize ? { width: media.width } : undefined}>
          <VideoPreviewPlayer ref={kind === "original" ? original : enhanced} src={media.preview_url}
            label={kind === "original" ? "原版完整分镜播放器" : "增强候选播放器"} muted={kind === "candidate"}
            ratioClassName={media.width < media.height ? "ratio-portrait" : "ratio-landscape"}
            onError={() => { original.current?.pause(); enhanced.current?.pause(); setFailed(true); }} />
        </div>
      </div>;
    })}</div>
    {failed ? <p role="alert">对比播放失败，请刷新候选或重试播放；当前作品没有改变。</p> : null}
  </section>;
}
