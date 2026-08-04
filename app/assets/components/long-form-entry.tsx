"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link2, LoaderCircle, Upload, Video, X } from "lucide-react";

import { formatComposerError } from "../../../lib/api";
import {
  importLongFormSourceUrl,
  uploadLongFormSource,
  waitForLongFormSourceReady,
  type LongFormSourceReady,
} from "../lib/long-form-client";
import styles from "./long-form-entry.module.css";

const LONG_FORM_VIDEO_ACCEPT = ".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska";
const LONG_FORM_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv"]);

function supportedVideo(file: File): boolean {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return LONG_FORM_VIDEO_EXTENSIONS.has(extension);
}

export default function LongFormEntry({
  token,
  onSourceReady,
}: {
  token?: string | null;
  onSourceReady: (source: LongFormSourceReady) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"upload" | "url" | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importControllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => importControllerRef.current?.abort(), []);

  const requireToken = () => {
    if (token) return token;
    throw new Error("请先登录并连接后端，再分析长视频。");
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || busy) return;
    if (!supportedVideo(file)) {
      setError("仅支持 MP4、MOV、WebM 或 MKV 视频。");
      return;
    }
    setBusy("upload");
    setProgress(0);
    setError(null);
    setStatus("正在上传原片…");
    try {
      const source = await uploadLongFormSource(requireToken(), file, setProgress);
      setStatus("上传完成，正在理解并整理 Top 候选…");
      await onSourceReady(source);
    } catch (uploadError) {
      setError(formatComposerError(uploadError));
      setStatus(null);
    } finally {
      setBusy(null);
    }
  };

  const handleUrl = async () => {
    const normalizedUrl = sourceUrl.trim();
    if (!normalizedUrl || busy) return;
    let parsed: URL;
    try {
      parsed = new URL(normalizedUrl);
    } catch {
      setError("请输入完整的视频链接。");
      return;
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      setError("视频链接必须使用 HTTP 或 HTTPS。");
      return;
    }
    const controller = new AbortController();
    importControllerRef.current = controller;
    setBusy("url");
    setProgress(null);
    setError(null);
    setStatus("正在解析并下载视频链接…");
    try {
      const imported = await importLongFormSourceUrl(requireToken(), normalizedUrl);
      if (imported.status !== "completed") {
        await waitForLongFormSourceReady(requireToken(), imported.asset_id, controller.signal);
      }
      setStatus("链接解析完成，正在理解并整理 Top 候选…");
      await onSourceReady({ id: imported.asset_id, title: "网络视频" });
    } catch (importError) {
      if (controller.signal.aborted) return;
      setError(formatComposerError(importError));
      setStatus(null);
    } finally {
      if (importControllerRef.current === controller) importControllerRef.current = null;
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className={styles.trigger}
        aria-label="上传长视频或粘贴链接"
        onClick={() => setOpen(true)}
      >
        <Video size={17} aria-hidden="true" />
        <span><strong>长视频 / 播客拆条</strong><small>上传原片或粘贴链接，自动给出 Top 5</small></span>
      </button>
    );
  }

  return (
    <section className={styles.panel} aria-label="长视频或播客拆条入口">
      <header>
        <div><Video size={17} aria-hidden="true" /><strong>长视频 / 播客拆条</strong></div>
        <button type="button" aria-label="关闭长视频入口" disabled={Boolean(busy)} onClick={() => setOpen(false)}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <div className={styles.options}>
        <input
          ref={fileInputRef}
          type="file"
          accept={LONG_FORM_VIDEO_ACCEPT}
          aria-label="选择长视频文件"
          hidden
          onChange={(event) => void handleFile(event)}
        />
        <button
          type="button"
          className={styles.upload}
          disabled={Boolean(busy)}
          onClick={() => fileInputRef.current?.click()}
        >
          {busy === "upload" ? <LoaderCircle className={styles.spin} size={18} aria-hidden="true" /> : <Upload size={18} aria-hidden="true" />}
          <span><strong>上传视频文件</strong><small>MP4 / MOV / WebM / MKV</small></span>
        </button>
        <div className={styles.divider}><span>或</span></div>
        <div className={styles.urlRow}>
          <Link2 size={17} aria-hidden="true" />
          <input
            type="url"
            value={sourceUrl}
            disabled={Boolean(busy)}
            placeholder="粘贴 YouTube、Bilibili 或公开 MP4 链接"
            onChange={(event) => setSourceUrl(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void handleUrl();
              }
            }}
          />
          <button type="button" disabled={Boolean(busy) || !sourceUrl.trim()} onClick={() => void handleUrl()}>
            {busy === "url" ? "解析中" : "解析链接"}
          </button>
        </div>
      </div>
      {busy === "upload" ? (
        <div className={styles.progress} role="progressbar" aria-label="长视频上传进度" aria-valuemin={0} aria-valuemax={100} {...(progress !== null ? { "aria-valuenow": progress } : {})}>
          <span style={progress !== null ? { width: `${progress}%` } : undefined} />
        </div>
      ) : null}
      {status ? <p className={styles.status}>{status}{progress !== null && busy === "upload" ? ` ${progress}%` : ""}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p className={styles.legal}>请确认你拥有素材使用权；暂不支持登录态、付费或 DRM 受保护的视频。</p>
    </section>
  );
}
