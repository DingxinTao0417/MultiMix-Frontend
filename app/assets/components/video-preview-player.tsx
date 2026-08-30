"use client";

import { Play } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";

export type VideoPreviewPlayerProps = {
  src: string;
  posterSrc?: string;
  label: string;
  ratioClassName: string;
  initialTime?: number;
  onTimeUpdate?: (time: number) => void;
  onError?: () => void;
};

export function formatPreviewTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safe / 60).toString().padStart(2, "0");
  const remainder = (safe % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

const VideoPreviewPlayer = forwardRef<HTMLVideoElement, VideoPreviewPlayerProps>(
  function VideoPreviewPlayer({
    src,
    posterSrc,
    label,
    ratioClassName,
    initialTime = 0,
    onTimeUpdate,
    onError,
  }, forwardedRef) {
    const localRef = useRef<HTMLVideoElement | null>(null);
    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [failed, setFailed] = useState(false);
    const [ready, setReady] = useState(false);
    const [bufferedPercent, setBufferedPercent] = useState<number | null>(null);
    const [reloadRevision, setReloadRevision] = useState(0);
    const progressPercent = duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0;
    const loadingLabel = bufferedPercent == null
      ? "正在加载视频"
      : `正在加载视频 · 已缓冲 ${Math.floor(bufferedPercent)}%`;

    const assignRef = useCallback((node: HTMLVideoElement | null) => {
      localRef.current = node;
      if (typeof forwardedRef === "function") forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }, [forwardedRef]);

    useEffect(() => {
      setDuration(0);
      setCurrentTime(0);
      setPlaying(false);
      setFailed(false);
      setReady(false);
      setBufferedPercent(null);
    }, [src, reloadRevision]);

    const togglePlayback = () => {
      const video = localRef.current;
      if (!video || !ready) return;
      if (playing) video.pause();
      else void video.play().catch(() => setFailed(true));
    };

    const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
      if (!ready) return;
      const next = Number(event.currentTarget.value);
      if (!localRef.current || !Number.isFinite(next)) return;
      localRef.current.currentTime = next;
      setCurrentTime(next);
      onTimeUpdate?.(next);
    };

    if (failed) {
      return (
        <div className={`shadcn-prototype-preview-player ${ratioClassName}`} aria-label={label}>
          <div className="shadcn-prototype-preview-player-error" role="alert">
            <strong>视频暂时无法加载</strong>
            <button type="button" onClick={() => {
              setFailed(false);
              setReloadRevision((value) => value + 1);
            }}>
              重新加载视频
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className={`shadcn-prototype-preview-player ${ratioClassName}`} aria-label={label}>
        <button
          type="button"
          className="shadcn-prototype-preview-player-screen"
          aria-label={playing ? "点击画面暂停视频" : "点击画面播放视频"}
          disabled={!ready}
          onClick={togglePlayback}
        >
          <video
            key={`${src}::${reloadRevision}`}
            ref={assignRef}
            src={src}
            poster={posterSrc || undefined}
            preload="auto"
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              if (initialTime > 0 && initialTime < video.duration) {
                video.currentTime = initialTime;
                setCurrentTime(initialTime);
              }
            }}
            onProgress={(event) => {
              const video = event.currentTarget;
              if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.buffered.length) return;
              const end = video.buffered.end(video.buffered.length - 1);
              setBufferedPercent(Math.min(100, Math.max(0, (end / video.duration) * 100)));
            }}
            onCanPlay={() => setReady(true)}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setCurrentTime(time);
              onTimeUpdate?.(time);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onError={() => {
              setFailed(true);
              setReady(false);
              setPlaying(false);
              onError?.();
            }}
          />
          {!ready ? (
            <span className="shadcn-prototype-preview-player-loading" role="status">
              <strong>{loadingLabel}</strong>
              <i aria-hidden="true">
                <b style={bufferedPercent == null ? undefined : { width: `${bufferedPercent}%` }} />
              </i>
            </span>
          ) : !playing ? <Play size={16} fill="currentColor" aria-hidden="true" /> : null}
        </button>
        <div className="shadcn-prototype-project-preview-controls">
          <span>{formatPreviewTime(currentTime)}</span>
          <input
            type="range"
            aria-label="播放进度"
            min="0"
            max={duration || 0}
            step="0.01"
            value={Math.min(currentTime, duration || currentTime)}
            style={{ "--preview-progress": `${progressPercent}%` } as CSSProperties}
          disabled={!ready || !duration}
            onChange={handleSeek}
          />
          <span>{formatPreviewTime(duration)}</span>
        </div>
      </div>
    );
  },
);

export default VideoPreviewPlayer;
