"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE } from "../../../lib/api";
import type { AssetSubtitleControls, AssetSubtitleOperation } from "../lib/asset-workspace-types";
import styles from "./subtitle-review-panel.module.css";

export type SubtitleReviewPanelProps = {
  assetId: number;
  contentHash: string;
  controls: AssetSubtitleControls;
  disabled?: boolean;
  onRequest: (operation: AssetSubtitleOperation) => Promise<void>;
};

export default function SubtitleReviewPanel({ assetId, contentHash, controls, disabled, onRequest }: SubtitleReviewPanelProps) {
  const revision = controls.available ? controls.revision : -1;
  const scope = `${assetId}:${contentHash}:${revision}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const audioRef = useRef<HTMLAudioElement>(null);
  const audition = useRef<{ start_seconds: number; end_seconds: number } | null>(null);
  const stopTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<{ scope: string; cueId: string; text: string } | null>(null);
  const [selection, setSelection] = useState<{ scope: string; revision: string } | null>(null);
  const [feedback, setFeedback] = useState<{ scope: string; text: string; error: boolean } | null>(null);
  const [audioError, setAudioError] = useState("");
  const originalRef = controls.available ? controls.original_audio_ref : null;
  const audioUrl = originalRef ? `${API_BASE}/v1/video/media?ref=${encodeURIComponent(originalRef)}` : undefined;

  const stopAudition = useCallback(() => {
    audition.current = null;
    if (stopTimer.current !== null) clearInterval(stopTimer.current);
    stopTimer.current = null;
    audioRef.current?.pause();
  }, []);

  useEffect(() => {
    const media = audioRef.current;
    setAudioError("");
    return () => {
      audition.current = null;
      if (stopTimer.current !== null) clearInterval(stopTimer.current);
      stopTimer.current = null;
      media?.pause();
    };
  }, [scope, audioUrl]);

  const playRange = () => {
    const media = audioRef.current;
    const range = audition.current;
    if (!media || !range) return;
    const requestScope = scope;
    media.currentTime = range.start_seconds;
    void media.play().then(() => {
      if (currentScope.current !== requestScope || audition.current !== range) return;
      if (stopTimer.current !== null) clearInterval(stopTimer.current);
      stopTimer.current = setInterval(() => {
        if (media.currentTime >= range.end_seconds) stopAudition();
      }, 50);
    }).catch(() => {
      if (currentScope.current === requestScope) {
        stopAudition();
        setAudioError("原音暂时无法播放，请重试或打开原素材核对。");
      }
    });
  };

  const send = async (operation: AssetSubtitleOperation) => {
    if (disabled || busy || pending.current || !contentHash) return;
    const requestScope = scope;
    pending.current = true;
    setBusy(true);
    setFeedback(null);
    stopAudition();
    try {
      await onRequest(operation);
      if (currentScope.current === requestScope) {
        setDraft(null);
        setFeedback({ scope, text: "修改请求已发送，请在对话中确认。", error: false });
      }
    } catch (error) {
      if (currentScope.current === requestScope) setFeedback({
        scope, text: error instanceof Error ? error.message : "字幕修改未能提交，请重试。", error: true,
      });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  const visibleDraft = draft?.scope === scope ? draft : null;
  const visibleFeedback = feedback?.scope === scope ? feedback : null;
  const blocked = Boolean(disabled || busy || !contentHash);
  const base = { assetId, expectedContentHash: contentHash, expectedSubtitleRevision: revision };
  const selectedRevision = selection?.scope === scope ? selection.revision
    : String(controls.available ? controls.revisions.find((item) => item.active)?.revision ?? "" : "");

  return (
    <details className={styles.panel} aria-label="字幕核对" onToggle={(event) => {
      if (!event.currentTarget.open) stopAudition();
    }}>
      <summary>核对字幕</summary>
      {!controls.available ? <p role="status">{controls.reason}</p> : (
        <div className={styles.body}>
          <div className={styles.actions}>
            <button type="button" role="switch" aria-label="添加字幕" aria-checked={controls.enabled}
              disabled={blocked || (!controls.enabled && !controls.can_enable)}
              onClick={() => void send({ ...base, action: "set_subtitle_visibility", subtitlesEnabled: !controls.enabled })}>
              {controls.enabled ? "字幕已开启" : "字幕已关闭"}
            </button>
            <button type="button" disabled={blocked || !controls.can_undo || !controls.enabled}
              onClick={() => void send({ ...base, action: "undo_subtitle_edit" })}>撤销上次改字</button>
          </div>
          <p>修改只影响所选字幕文字，原声音频保持不变。</p>
          {!controls.enabled ? <p>关闭仅影响新增字幕，原声和原视频中的文字会保留。</p> : null}
          {!controls.enabled && !controls.can_enable ? <p>此版本没有可恢复的字幕，请先生成字幕版本。</p> : null}
          {!controls.enabled && controls.enable_requires_generation ? <p>开启后将生成原语言字幕，请在对话中确认。原声和画面保持不变。</p> : null}
          {audioUrl ? <audio ref={audioRef} src={audioUrl} controls preload="none" aria-label="原音核对"
            onLoadedMetadata={playRange}
            onTimeUpdate={(event) => {
              if (audition.current && event.currentTarget.currentTime >= audition.current.end_seconds) stopAudition();
            }}
            onError={() => { stopAudition(); setAudioError("原音暂时无法播放，请重试或打开原素材核对。"); }}
          /> : <p>当前版本的原音暂不可用。</p>}
          {audioError ? <p role="alert">{audioError}</p> : null}
          <ol className={styles.cues}>
            {controls.cues.map((cue, index) => (
              <li key={cue.cue_id}>
                <div className={styles.cueHeading}>
                  <strong>第 {index + 1} 句</strong>
                  <span>{cue.start_seconds.toFixed(2)}–{cue.end_seconds.toFixed(2)} 秒（原音）</span>
                  {cue.user_edited ? <em>已人工修改</em> : null}
                </div>
                {visibleDraft?.cueId === cue.cue_id ? (
                  <form onSubmit={(event) => {
                    event.preventDefault();
                    if (!blocked && controls.enabled && visibleDraft.text.trim()) void send({
                      ...base, action: "correct_subtitle", cueId: cue.cue_id, text: visibleDraft.text,
                    });
                  }}>
                    <textarea aria-label="字幕文字" value={visibleDraft.text} maxLength={200} disabled={blocked}
                      onChange={(event) => setDraft({ ...visibleDraft, text: event.currentTarget.value })} />
                    <div className={styles.actions}>
                      <button type="submit" disabled={blocked || !controls.enabled || !visibleDraft.text.trim() || visibleDraft.text.length > 200}>保存修改</button>
                      <button type="button" disabled={busy} onClick={() => setDraft(null)}>取消</button>
                    </div>
                  </form>
                ) : <p className={styles.subtitle}>{cue.text}</p>}
                <div className={styles.actions}>
                  <button type="button" disabled={blocked || !controls.enabled}
                    onClick={() => setDraft({ scope, cueId: cue.cue_id, text: cue.text })}>修改字幕</button>
                  <button type="button" disabled={!audioUrl} onClick={() => {
                    stopAudition();
                    setAudioError("");
                    audition.current = cue;
                    if ((audioRef.current?.readyState ?? 0) >= 1) playRange();
                    else audioRef.current?.load();
                  }}>试听原音</button>
                </div>
              </li>
            ))}
          </ol>
          {controls.revisions.length ? <div className={styles.actions}>
            <label>字幕历史 <select aria-label="字幕历史" value={selectedRevision} disabled={blocked || !controls.enabled}
              onChange={(event) => setSelection({ scope, revision: event.currentTarget.value })}>
              {controls.revisions.map((item) => <option key={item.revision} value={item.revision}>
                {item.revision === 0 ? "最初字幕" : `第 ${item.revision} 次修改`}{item.active ? "（当前）" : ""}
              </option>)}
            </select></label>
            <button type="button" disabled={blocked || !controls.enabled || !controls.revisions.some((item) => String(item.revision) === selectedRevision && !item.active)}
              onClick={() => void send({ ...base, action: "restore_subtitle_revision", subtitleRevision: Number(selectedRevision) })}>恢复此版</button>
          </div> : null}
          {visibleFeedback ? <p role={visibleFeedback.error ? "alert" : "status"}>{visibleFeedback.text}</p> : null}
        </div>
      )}
    </details>
  );
}
