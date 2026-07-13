"use client";

import { Play } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";

export type VideoPreviewPlayerProps = {
  src: string;
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
    const [reloadRevision, setReloadRevision] = useState(0);

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
    }, [src, reloadRevision]);

    const togglePlayback = () => {
      const video = localRef.current;
      if (!video) return;
      if (playing) video.pause();
      else void video.play().catch(() => setFailed(true));
    };

    const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
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
          onClick={togglePlayback}
        >
          <video
            key={`${src}::${reloadRevision}`}
            ref={assignRef}
            src={src}
            preload="metadata"
            playsInline
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              setDuration(Number.isFinite(video.duration) ? video.duration : 0);
              if (initialTime > 0 && initialTime < video.duration) {
                video.currentTime = initialTime;
                setCurrentTime(initialTime);
              }
            }}
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
              setPlaying(false);
              onError?.();
            }}
          />
          {!playing ? <Play size={28} fill="currentColor" aria-hidden="true" /> : null}
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
            disabled={!duration}
            onChange={handleSeek}
          />
          <span>{formatPreviewTime(duration)}</span>
        </div>
      </div>
    );
  },
);

export default VideoPreviewPlayer;
