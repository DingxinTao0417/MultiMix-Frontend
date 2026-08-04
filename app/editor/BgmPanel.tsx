"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  getProjectBGMCatalog,
  updateProjectBGM,
  type BGMAction,
  type BGMChoice,
  type BGMCatalogResponse,
  type BGMCatalogTrack,
  type BGMUpdateResponse,
} from "../../editor-engine/vendor/api";

const CATEGORIES = [
  "商务稳重",
  "轻快活力",
  "温暖生活",
  "科技现代",
  "情绪叙事",
  "轻松趣味",
] as const;
const FILTERS = ["自动配乐", "全部音乐", ...CATEGORIES] as const;
type Filter = (typeof FILTERS)[number];

export default function BgmPanel({
  assetId,
  token,
  initialChoice = null,
  onPrepareChange,
  onProjectChanged,
}: {
  assetId: string;
  token: string | null;
  initialChoice?: BGMChoice | null;
  onPrepareChange: () => Promise<void>;
  onProjectChanged: (result: BGMUpdateResponse) => Promise<void>;
}) {
  const [catalog, setCatalog] = useState<BGMCatalogResponse | null>(null);
  const [available, setAvailable] = useState(true);
  const [choice, setChoice] = useState<BGMChoice | null>(initialChoice);
  const [filter, setFilter] = useState<Filter>("自动配乐");
  const [loading, setLoading] = useState(initialChoice?.enabled !== false);
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState("");
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    setChoice(initialChoice);
    if (initialChoice?.enabled === false) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void getProjectBGMCatalog(assetId, token)
      .then((result) => {
        if (!active) return;
        setCatalog(result);
        setChoice(result.current_choice);
      })
      .catch((cause) => {
        if (!active) return;
        const detail = cause instanceof Error ? cause.message : String(cause);
        if (detail === "Video BGM is disabled.") {
          setAvailable(false);
          return;
        }
        setMessage(`音乐库加载失败：${detail}`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      audioRef.current?.pause();
    };
  }, [assetId, initialChoice, token]);

  const tracks = useMemo(() => {
    if (!catalog) return [];
    if (filter === "全部音乐") return catalog.tracks;
    if (filter !== "自动配乐") return catalog.tracks.filter((track) => track.category === filter);
    const byId = new Map(catalog.tracks.map((track) => [track.id, track]));
    return catalog.recommended_ids.map((id) => byId.get(id)).filter((track): track is BGMCatalogTrack => Boolean(track));
  }, [catalog, filter]);

  if (!available) return null;

  function togglePreview(track: BGMCatalogTrack) {
    if (previewingId === track.id) {
      audioRef.current?.pause();
      audioRef.current = null;
      setPreviewingId(null);
      return;
    }
    audioRef.current?.pause();
    const audio = new Audio(track.preview_url);
    audioRef.current = audio;
    setPreviewingId(track.id);
    audio.addEventListener("ended", () => setPreviewingId(null), { once: true });
    void audio.play().catch(() => {
      setPreviewingId(null);
      setMessage("试听失败，请稍后重试。");
    });
  }

  async function mutate(action: BGMAction, catalogId?: string, loadedCatalog = catalog) {
    if (!loadedCatalog || updating) return;
    setUpdating(true);
    setMessage("");
    try {
      await onPrepareChange();
      const result = await updateProjectBGM(assetId, token, {
        action,
        ...(catalogId ? { catalog_id: catalogId } : {}),
        catalog_version: loadedCatalog.catalog_version,
      });
      await onProjectChanged(result);
      setChoice(result.choice);
      setCatalog((current) => current ? { ...current, current_choice: result.choice } : current);
      setMessage(action === "disable" ? "已关闭背景音乐。" : "背景音乐已更新。");
    } catch (cause) {
      setMessage(`更换失败：${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      setUpdating(false);
    }
  }

  async function restoreAutomatic() {
    if (updating) return;
    if (catalog) {
      await mutate("restore_auto");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const result = await getProjectBGMCatalog(assetId, token);
      setCatalog(result);
      setChoice(result.current_choice);
      await mutate("restore_auto", undefined, result);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      setMessage(`恢复自动配乐失败：${detail}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="editor-bgm-panel" aria-label="背景音乐">
      <div className="editor-bgm-heading">
        <div>
          <strong>背景音乐</strong>
          <span>{choice?.enabled === false ? "已关闭" : choice?.selected_by === "auto" ? "已自动配乐" : "已自选"}</span>
        </div>
        <div className="editor-bgm-actions">
          <button type="button" disabled={updating || loading || choice?.enabled === false} onClick={() => void mutate("disable")}>无配乐</button>
          <button type="button" disabled={updating || loading} onClick={() => void restoreAutomatic()}>恢复自动配乐</button>
        </div>
      </div>

      {choice?.enabled === false && !catalog ? (
        <div className="editor-bgm-list" aria-live="polite">
          <p className="editor-bgm-empty">本片未使用背景音乐。</p>
        </div>
      ) : (
        <>
          <div className="editor-bgm-filters" aria-label="音乐分类">
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item}
                className={filter === item ? "active" : ""}
                aria-pressed={filter === item}
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>

          <div className="editor-bgm-list" aria-live="polite">
            {loading ? <p className="editor-bgm-empty">正在加载内置音乐…</p> : null}
            {!loading && tracks.length === 0 ? <p className="editor-bgm-empty">这个分类暂无可用音乐。</p> : null}
            {tracks.map((track) => {
              const current = choice?.enabled !== false && choice?.catalog_id === track.id;
              const reason = track.match_reason
                || (choice?.catalog_id === track.id ? choice.selection_reason : choice?.alternate_reasons?.[track.id]);
              return (
                <article className={`editor-bgm-card${current ? " current" : ""}`} key={track.id}>
                  <div className="editor-bgm-card-copy">
                    <span className="editor-bgm-title" data-current={current ? "true" : "false"}>{track.title}</span>
                    <span>{track.category} · {track.mood_tags.join(" / ")}</span>
                    <span>{track.provider || "内置音乐"} · {Math.round(track.duration_seconds)} 秒</span>
                    {reason ? <small>{reason}</small> : null}
                  </div>
                  <div className="editor-bgm-card-actions">
                    <button type="button" onClick={() => togglePreview(track)}>
                      {previewingId === track.id ? "停止试听" : "试听"}
                    </button>
                    <button
                      type="button"
                      disabled={updating || current}
                      aria-label={`选择 ${track.title}`}
                      onClick={() => void mutate("select", track.id)}
                    >
                      {current ? "当前" : "选择"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
      {message ? <p className={message.startsWith("更换失败") || message.includes("加载失败") ? "editor-bgm-message error" : "editor-bgm-message"}>{message}</p> : null}
    </aside>
  );
}
