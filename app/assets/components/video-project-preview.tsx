"use client";

import { Play } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";

import { formatPreviewTime } from "./video-preview-player";

type EditorPreviewMessage = {
  source?: string;
  assetId?: string | number | null;
  type?: string;
  time?: number;
  duration?: number;
  playing?: boolean;
  message?: string;
  previewChannel?: string;
};

export type VideoProjectPreviewHandle = {
  seekAndPlay: (time: number) => void;
};

export type VideoProjectPreviewProps = {
  assetId: string | number;
  ratioClassName: string;
  durationSeconds?: number;
  channelId?: string;
  onTimeUpdate?: (time: number) => void;
  onError?: () => void;
};

const VideoProjectPreview = forwardRef<VideoProjectPreviewHandle, VideoProjectPreviewProps>(
  function VideoProjectPreview({
    assetId,
    ratioClassName,
    durationSeconds = 0,
    channelId,
    onTimeUpdate,
    onError,
  }, forwardedRef) {
    const iframeRef = useRef<HTMLIFrameElement | null>(null);
    const generatedChannelId = useId();
    const previewChannel = channelId ?? `video-preview-${generatedChannelId}`;
    const [ready, setReady] = useState(false);
    const [failed, setFailed] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(durationSeconds);
    const safeDuration = duration > 0 ? duration : Math.max(0, durationSeconds);
    const progressPercent = safeDuration > 0
      ? Math.min(100, Math.max(0, (currentTime / safeDuration) * 100))
      : 0;

    useEffect(() => {
      setReady(false);
      setFailed(false);
      setPlaying(false);
      setCurrentTime(0);
      setDuration(durationSeconds);
    }, [assetId, durationSeconds]);

    const postCommand = useCallback((type: string, time?: number) => {
      const target = iframeRef.current?.contentWindow;
      if (!target || typeof window === "undefined") return;
      target.postMessage({
        source: "multimix-workspace",
        type,
        ...(typeof time === "number" ? { time } : {}),
      }, window.location.origin);
    }, []);

    const seek = useCallback((time: number) => {
      if (!Number.isFinite(time)) return;
      const next = Math.max(0, safeDuration > 0 ? Math.min(time, safeDuration) : time);
      setCurrentTime(next);
      onTimeUpdate?.(next);
      postCommand("multimix-editor-preview-seek", next);
    }, [onTimeUpdate, postCommand, safeDuration]);

    useImperativeHandle(forwardedRef, () => ({
      seekAndPlay(time: number) {
        seek(time);
        postCommand("multimix-editor-preview-play");
      },
    }), [postCommand, seek]);

    useEffect(() => {
      if (typeof window === "undefined") return;
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data as EditorPreviewMessage;
        if (!data || typeof data !== "object" || data.source !== "multimix-editor") return;
        if (String(data.assetId ?? "") !== String(assetId)) return;
        if (data.previewChannel !== previewChannel) return;

        if (data.type === "multimix-editor-ready") {
          setReady(true);
          setFailed(false);
          return;
        }
        if (data.type === "multimix-editor-error") {
          setReady(false);
          setFailed(true);
          setPlaying(false);
          onError?.();
          return;
        }
        if (data.type !== "multimix-editor-preview-state") return;

        setReady(true);
        setFailed(false);
        if (typeof data.time === "number" && Number.isFinite(data.time)) {
          const next = Math.max(0, data.time);
          setCurrentTime(next);
          onTimeUpdate?.(next);
        }
        if (typeof data.duration === "number" && Number.isFinite(data.duration) && data.duration > 0) {
          setDuration(data.duration);
        }
        setPlaying(data.playing === true);
      };
      window.addEventListener("message", onMessage);
      return () => window.removeEventListener("message", onMessage);
    }, [assetId, onError, onTimeUpdate, previewChannel]);

    const handleSeek = (event: ChangeEvent<HTMLInputElement>) => {
      seek(Number(event.currentTarget.value));
    };

    return (
      <div className={`shadcn-prototype-preview-player ${ratioClassName}`} aria-label="视频工程播放器">
        <div className="shadcn-prototype-preview-player-screen">
          <iframe
            ref={iframeRef}
            className="shadcn-prototype-project-preview-frame"
            src={`/editor?asset=${encodeURIComponent(String(assetId))}&embed=1&mode=preview&previewChannel=${encodeURIComponent(previewChannel)}`}
            title="视频工程预播"
            allow="autoplay"
          />
          {!ready && !failed ? <span className="shadcn-prototype-project-preview-loading">正在准备工程预览…</span> : null}
          {failed ? <span className="shadcn-prototype-project-preview-loading" role="alert">工程预览暂不可用</span> : null}
          {!failed ? (
            <button
              type="button"
              className="shadcn-prototype-project-preview-toggle"
              aria-label={playing ? "点击画面暂停视频" : "点击画面播放视频"}
              disabled={!ready}
              onClick={() => postCommand("multimix-editor-preview-toggle")}
            >
              {!playing ? <Play size={16} fill="currentColor" aria-hidden="true" /> : null}
            </button>
          ) : null}
        </div>
        <div className="shadcn-prototype-project-preview-controls">
          <span>{formatPreviewTime(currentTime)}</span>
          <input
            type="range"
            aria-label="播放进度"
            min="0"
            max={safeDuration || 0}
            step="0.01"
            value={Math.min(currentTime, safeDuration || currentTime)}
            style={{ "--preview-progress": `${progressPercent}%` } as CSSProperties}
            disabled={!ready || !safeDuration}
            onChange={handleSeek}
          />
          <span>{formatPreviewTime(safeDuration)}</span>
        </div>
      </div>
    );
  },
);

export default VideoProjectPreview;
