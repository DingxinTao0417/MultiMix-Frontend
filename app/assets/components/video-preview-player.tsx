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
  muted?: boolean;
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
    muted = false,
    initialTime = 0,
    onTimeUpdate,
    onError,
  }, forwardedRef) {
    const localRef = useRef<HTMLVideoElement | null>(null);
    const playbackRequestRef = useRef(0);
    const [duration, setDuration] = useState(0);
    const [intrinsicGeometry, setIntrinsicGeometry] = useState<{ width: number; height: number } | null>(null);
    const effectiveRatioClass = ratioClassName || (intrinsicGeometry
      ? intrinsicGeometry.width < intrinsicGeometry.height ? "ratio-portrait" : "ratio-landscape"
      : "");
    const [currentTime, setCurrentTime] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [failed, setFailed] = useState(false);
    const [failureLabel, setFailureLabel] = useState("视频暂时无法加载");
    const [playbackNotice, setPlaybackNotice] = useState("");
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

    const readMetadata = useCallback((video: HTMLVideoElement) => {
      setDuration(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0);
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setIntrinsicGeometry({ width: video.videoWidth, height: video.videoHeight });
      }
      if (initialTime > 0 && initialTime < video.duration) video.currentTime = initialTime;
      setCurrentTime(Number.isFinite(video.currentTime) ? video.currentTime : 0);
    }, [initialTime]);

    const readBuffer = useCallback((video: HTMLVideoElement) => {
      if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.buffered.length) return;
      const end = video.buffered.end(video.buffered.length - 1);
      setBufferedPercent(Math.min(100, Math.max(0, (end / video.duration) * 100)));
    }, []);

    useEffect(() => {
      playbackRequestRef.current += 1;
      setDuration(0);
      setIntrinsicGeometry(null);
      setCurrentTime(0);
      setPlaying(false);
      setFailed(false);
      setFailureLabel("视频暂时无法加载");
      setPlaybackNotice("");
      setReady(false);
      setBufferedPercent(null);

      // Cached media may finish loading before hydration attaches React's listeners.
      const video = localRef.current;
      if (!video) return;
      if (video.error) {
        setFailed(true);
        return;
      }
      if (video.readyState >= video.HAVE_METADATA) {
        readMetadata(video);
        readBuffer(video);
      }
      if (video.readyState >= video.HAVE_FUTURE_DATA) setReady(true);
      setPlaying(!video.paused && !video.ended);
    }, [src, reloadRevision, readMetadata, readBuffer]);

    const togglePlayback = () => {
      const video = localRef.current;
      if (!video || !ready) return;
      if (playing) {
        playbackRequestRef.current += 1;
        video.pause();
      }
      else {
        const requestId = ++playbackRequestRef.current;
        setPlaybackNotice("");
        void video.play().catch((error: unknown) => {
          if (localRef.current !== video || playbackRequestRef.current !== requestId) return;
          const name = error && typeof error === "object" && "name" in error ? error.name : null;
          if (name === "AbortError") return;
          if (name === "NotSupportedError") {
            setFailureLabel("当前视频无法解码");
            setFailed(true);
            setReady(false);
            onError?.();
            return;
          }
          setPlaybackNotice(name === "NotAllowedError"
            ? "浏览器阻止了播放，请检查播放设置后重试。"
            : "视频暂时无法播放，请重试。");
        });
      }
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
        <div className={`shadcn-prototype-preview-player ${effectiveRatioClass}`} role="group" aria-label={label}>
          <div className="shadcn-prototype-preview-player-error" role="alert">
            <strong>{failureLabel}</strong>
            <button type="button" aria-label={`${label}：重新加载视频`} onClick={() => {
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
      <div className={`shadcn-prototype-preview-player ${effectiveRatioClass}`} role="group" aria-label={label}>
        <button
          type="button"
          className="shadcn-prototype-preview-player-screen"
          aria-label={`${label}：${playing ? "暂停视频" : "播放视频"}`}
          disabled={!ready}
          style={!ratioClassName && intrinsicGeometry ? { aspectRatio: `${intrinsicGeometry.width} / ${intrinsicGeometry.height}` } : undefined}
          onClick={togglePlayback}
        >
          <video
            key={`${src}::${reloadRevision}`}
            ref={assignRef}
            src={src}
            poster={posterSrc || undefined}
            preload="auto"
            playsInline
            muted={muted}
            onLoadedMetadata={(event) => readMetadata(event.currentTarget)}
            onProgress={(event) => readBuffer(event.currentTarget)}
            onCanPlay={() => setReady(true)}
            onTimeUpdate={(event) => {
              const time = event.currentTarget.currentTime;
              setCurrentTime(time);
              onTimeUpdate?.(time);
            }}
            onPlay={() => {
              playbackRequestRef.current += 1;
              setPlaying(true);
              setPlaybackNotice("");
            }}
            onPause={() => {
              playbackRequestRef.current += 1;
              setPlaying(false);
            }}
            onEnded={() => {
              playbackRequestRef.current += 1;
              setPlaying(false);
            }}
            onError={() => {
              playbackRequestRef.current += 1;
              setFailureLabel("视频暂时无法加载");
              setFailed(true);
              setReady(false);
              setPlaying(false);
              setPlaybackNotice("");
              onError?.();
            }}
          />
          {playbackNotice ? <span className="shadcn-prototype-preview-player-playback-notice" role="status">
            {playbackNotice}
          </span> : null}
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
            aria-label={`${label}：播放进度`}
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
