"use client";

// Embed edit surface: film strip + per-segment property card (spec §5.5,
// interaction baseline final/workspace-video.html). Replaces the multi-track
// timeline in embed mode behind UI_V3_FILMSTRIP; the full-screen /editor keeps
// the OpenCut timeline for分轨 work.
//
// Two-layer boundary (spec §5.5):
// - Strip operations (trim/split/delete) act on the render layer. They are
//   auto-saved via PUT /v1/video/projects/{id}, which marks timeline_dirty on
//   the backend, so a later AI rebuild must be confirmed.
// - Property-card operations (换素材/重新配音/MG 开关) act on the segment
//   semantic layer via POST .../segments/{id}/recompose. On 409
//   code=timeline_dirty the user confirms「会覆盖你的手工剪辑」and the call is
//   re-sent with confirm_overwrite=true (docs/API.md §12.5).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorCore } from "@editor/core";
import type { TimelineElement, TimelineTrack } from "@editor/lib/timeline/types";
import { API_BASE } from "@/editor-engine/vendor/api";
import { serializeBackendProject } from "@/editor-engine/vendor/serializeProject";
import { segmentIdByElementId, segmentTextByElementId } from "@/editor-engine/vendor/buildProject";
import AssetPicker, { type AssetPickerItem } from "@/app/assets/components/asset-picker";
import { useSegmentMaterialCandidates } from "@/app/assets/lib/use-segment-material-candidates";
import { UI_V3_ASSET_PICKER } from "@/app/assets/lib/ui-flags";
import {
  applyEdgeTrim,
  formatClock,
  segmentNumberByElementId,
  visibleDuration,
} from "./filmstrip-utils";

type RecomposeBody = {
  operation: "replace_material" | "revoice" | "toggle_mg";
  candidate_id?: string;
  voiceover?: string;
  mg_enabled?: boolean;
};

type RecomposeState =
  | { phase: "idle" }
  | { phase: "submitting" }
  | { phase: "running"; jobId: string; stageLabel: string }
  | { phase: "error"; message: string };

const OVERWRITE_FALLBACK_MESSAGE =
  "重新合成会覆盖你在剪辑器里做的手工剪辑（裁剪/分割）；素材、配音、字卡的修改不受影响。确认后将继续。";

export default function FilmStrip({
  assetId,
  token,
  initialSegmentId = null,
  openMaterialPicker = false,
}: {
  assetId: string | null;
  token: string | null;
  initialSegmentId?: string | null;
  openMaterialPicker?: boolean;
}) {
  const core = EditorCore.getInstance();
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [voiceDraft, setVoiceDraft] = useState("");
  const [saveNote, setSaveNote] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [recompose, setRecompose] = useState<RecomposeState>({ phase: "idle" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragRef = useRef<{ edge: "left" | "right"; startX: number; committed: boolean } | null>(null);
  const initialSelectionAppliedRef = useRef(false);
  const initialPickerOpenedRef = useRef(false);

  useEffect(() => core.timeline.subscribe(() => setRevision((r) => r + 1)), [core]);

  const tracks: TimelineTrack[] = core.timeline.getTracks();
  const mainTrack = useMemo(
    () => tracks.find((t) => t.type === "video" && t.isMain) ?? tracks.find((t) => t.type === "video") ?? null,
    // revision invalidates the memo when the engine mutates the timeline
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tracks, revision],
  );
  const clips = useMemo(
    () => (mainTrack ? [...mainTrack.elements].sort((a, b) => a.startTime - b.startTime) : []),
    [mainTrack],
  );
  const segmentNumbers = useMemo(
    () => segmentNumberByElementId(clips, (id) => segmentIdByElementId[id]),
    [clips],
  );
  const totalVisible = clips.reduce((sum, el) => sum + visibleDuration(el), 0);
  const selected: TimelineElement | null = clips.find((el) => el.id === selectedId) ?? null;
  const canvasSize = core.project.getActiveOrNull()?.settings.canvasSize;
  const pickerRatio = canvasSize
    ? canvasSize.width > canvasSize.height ? "16:9" : canvasSize.width < canvasSize.height ? "9:16" : "1:1"
    : "";
  const selectedSegmentId = selected ? segmentIdByElementId[selected.id] : undefined;
  const selectedText = selected ? segmentTextByElementId[selected.id] ?? "" : "";
  const materialCandidates = useSegmentMaterialCandidates({
    token,
    projectAssetId: assetId ? Number(assetId) : null,
    segmentId: selectedSegmentId ?? null,
    enabled: Boolean(pickerOpen && assetId && token && selectedSegmentId),
  });
  const mediaName = useMemo(() => {
    if (!selected || !("mediaId" in selected) || !selected.mediaId) return "";
    return core.media.getAssets().find((a) => a.id === selected.mediaId)?.name ?? "";
  }, [core, selected]);
  // MG 字卡 on = an overlay-track element is anchored to this segment
  // (mg_decision is authoritative server-side; overlays are its rendered form).
  const mgActive = useMemo(() => {
    if (!selectedSegmentId) return false;
    return tracks.some(
      (t) =>
        t.type === "video" &&
        !t.isMain &&
        t.elements.some((el) => segmentIdByElementId[el.id] === selectedSegmentId),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, selectedSegmentId, revision]);

  useEffect(() => setVoiceDraft(selectedText), [selectedText]);

  useEffect(() => {
    if (initialSelectionAppliedRef.current || !initialSegmentId || !clips.length) return;
    const clip = clips.find((element) => segmentIdByElementId[element.id] === initialSegmentId);
    if (!clip) return;
    initialSelectionAppliedRef.current = true;
    setSelectedId(clip.id);
    core.playback.seek({ time: clip.startTime + 0.01 });
  }, [clips, core, initialSegmentId]);

  useEffect(() => {
    const onLocateMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const message = event.data as {
        source?: string;
        type?: string;
        segmentId?: string;
      };
      if (
        message?.source !== "multimix-workspace"
        || message.type !== "multimix-editor-locate-segment"
        || !message.segmentId
      ) return;
      const clipIndex = clips.findIndex(
        (element) => segmentIdByElementId[element.id] === message.segmentId,
      );
      const clip = clips[clipIndex];
      if (!clip) return;
      setSelectedId(clip.id);
      core.playback.seek({ time: clip.startTime + 0.01 });
      const clipButton = stripRef.current?.children.item(clipIndex);
      if (clipButton instanceof HTMLElement) {
        clipButton.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        clipButton.focus();
      }
    };
    window.addEventListener("message", onLocateMessage);
    return () => window.removeEventListener("message", onLocateMessage);
  }, [clips, core]);

  const authHeaders = useMemo(
    () => (token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>)),
    [token],
  );

  // Render-layer edits persist via debounced save; the backend marks
  // timeline_dirty so AI rebuilds ask before overwriting (API.md §12.5).
  const queueSave = useCallback(() => {
    if (!assetId || !token) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveNote("saving");
    saveTimer.current = setTimeout(async () => {
      try {
        const body = serializeBackendProject(EditorCore.getInstance());
        const res = await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setSaveNote("saved");
      } catch {
        setSaveNote("error");
      }
    }, 800);
  }, [assetId, token, authHeaders]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const selectClip = (el: TimelineElement) => {
    setSelectedId(el.id);
    core.playback.seek({ time: el.startTime + 0.01 });
  };

  const handleSplit = () => {
    if (!selected || !mainTrack) return;
    const start = selected.startTime;
    const end = start + visibleDuration(selected);
    const playhead = core.playback.getCurrentTime();
    const splitTime = playhead > start + 0.2 && playhead < end - 0.2 ? playhead : (start + end) / 2;
    core.timeline.splitElements({
      elements: [{ trackId: mainTrack.id, elementId: selected.id }],
      splitTime,
    });
    queueSave();
  };

  const handleDelete = () => {
    if (!selected || !mainTrack) return;
    core.timeline.deleteElements({
      elements: [{ trackId: mainTrack.id, elementId: selected.id }],
      rippleEnabled: true,
    });
    setSelectedId(null);
    queueSave();
  };

  const handleUndo = () => {
    core.command.undo();
    queueSave();
  };

  // Trim-handle drag: px→seconds through the strip's visible-duration scale;
  // committed on pointerup so mid-drag we only move the pointer, not history.
  const onHandleDown = (edge: "left" | "right") => (event: React.PointerEvent<HTMLSpanElement>) => {
    if (!selected || !stripRef.current || totalVisible <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    const secondsPerPx = totalVisible / Math.max(1, stripRef.current.clientWidth);
    const element = selected;
    const startX = event.clientX;
    dragRef.current = { edge, startX, committed: false };
    const move = (ev: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = (ev.clientX - drag.startX) * secondsPerPx;
      const next = applyEdgeTrim(
        {
          trimStart: element.trimStart ?? 0,
          trimEnd: element.trimEnd ?? 0,
          duration: element.duration,
          startTime: element.startTime,
        },
        edge,
        edge === "left" ? delta : delta,
      );
      core.timeline.updateElementTrim({
        elementId: element.id,
        trimStart: next.trimStart,
        trimEnd: next.trimEnd,
        startTime: next.startTime,
        pushHistory: false,
        rippleEnabled: true,
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      dragRef.current = null;
      queueSave();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const postToParent = useCallback(
    (payload: Record<string, unknown>) => {
      if (typeof window === "undefined" || window.parent === window) return;
      window.parent.postMessage({ source: "multimix-editor", assetId, ...payload }, window.location.origin);
    },
    [assetId],
  );

  // Semantic-layer change → partial recompose. Falls back to the timeline
  // dirty confirmation loop on 409 (docs/API.md §12.4/§12.5).
  const submitRecompose = useCallback(
    async (body: RecomposeBody, confirmOverwrite = false): Promise<void> => {
      if (!assetId || !token || !selectedSegmentId) return;
      setRecompose({ phase: "submitting" });
      try {
        const res = await fetch(
          `${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}/segments/${encodeURIComponent(selectedSegmentId)}/recompose`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders },
            body: JSON.stringify({ ...body, confirm_overwrite: confirmOverwrite }),
          },
        );
        if (res.status === 409) {
          const payload = await res.json().catch(() => null);
          const detail = payload?.detail;
          if (detail && typeof detail === "object" && detail.code === "timeline_dirty") {
            const message = typeof detail.message === "string" && detail.message ? detail.message : OVERWRITE_FALLBACK_MESSAGE;
            setRecompose({ phase: "idle" });
            if (window.confirm(message)) await submitRecompose(body, true);
            return;
          }
          throw new Error(typeof detail === "string" ? detail : "当前无法重新合成。");
        }
        if (!res.ok) {
          const payload = await res.json().catch(() => null);
          throw new Error(typeof payload?.detail === "string" ? payload.detail : `HTTP ${res.status}`);
        }
        const job = await res.json();
        postToParent({ type: "multimix-editor-recompose-started", jobId: job?.public_id ?? null });
        setRecompose({ phase: "running", jobId: String(job?.public_id ?? ""), stageLabel: "已开始重新合成" });
      } catch (cause) {
        setRecompose({ phase: "error", message: cause instanceof Error ? cause.message : String(cause) });
      }
    },
    [assetId, token, selectedSegmentId, authHeaders, postToParent],
  );

  // While a recompose job runs, poll its real status; reload the editor with
  // the rebuilt project when it lands (no fake progress — labels come from the
  // job's render stage).
  const runningJobId = recompose.phase === "running" ? recompose.jobId : "";
  useEffect(() => {
    if (!runningJobId) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/video/jobs/${encodeURIComponent(runningJobId)}`, { headers: authHeaders });
        if (!res.ok) return;
        const job = await res.json();
        if (job.status === "completed") {
          clearInterval(timer);
          window.location.reload();
        } else if (job.status === "failed") {
          clearInterval(timer);
          setRecompose({ phase: "error", message: job.error_message || "重新合成失败，可回到对话重试。" });
        } else {
          setRecompose((prev) =>
            prev.phase === "running" ? { ...prev, stageLabel: `正在重新合成（${job.render_stage || job.status}）` } : prev,
          );
        }
      } catch {
        // transient poll errors: keep waiting
      }
    }, 5000);
    return () => clearInterval(timer);
  }, [runningJobId, authHeaders]);

  const openPicker = useCallback(() => {
    if (!assetId || !token || !selectedSegmentId) return;
    // The shared candidate hook loads local first, then public, keyed off
    // pickerOpen + the selected segment.
    setPickerOpen(true);
  }, [assetId, selectedSegmentId, token]);

  useEffect(() => {
    if (
      initialPickerOpenedRef.current
      || !openMaterialPicker
      || !initialSegmentId
      || selectedSegmentId !== initialSegmentId
      || !token
    ) return;
    initialPickerOpenedRef.current = true;
    void openPicker();
  }, [initialSegmentId, openMaterialPicker, openPicker, selectedSegmentId, token]);

  const handlePickMaterial = (item: AssetPickerItem) => {
    setPickerOpen(false);
    if (item.candidateId) {
      void submitRecompose({ operation: "replace_material", candidate_id: item.candidateId });
    } else {
      setRecompose({ phase: "error", message: "该候选已失效，请刷新候选列表后重试。" });
    }
  };

  const handleRevoice = () => {
    const text = voiceDraft.trim();
    if (!text || text === selectedText.trim()) return;
    void submitRecompose({ operation: "revoice", voiceover: text });
  };

  const handleToggleMg = (checked: boolean) => {
    void submitRecompose({ operation: "toggle_mg", mg_enabled: checked });
  };

  if (!clips.length) return null;

  const canRecompose = Boolean(assetId && token && selectedSegmentId) && recompose.phase !== "submitting";
  const selectedNumber = selected ? segmentNumbers[selected.id] : null;

  return (
    <div className="shadcn-prototype-filmstrip" data-testid="filmstrip">
      {recompose.phase === "running" ? (
        <div className="shadcn-prototype-filmstrip-busy" role="status">
          <span className="dot" aria-hidden="true" />
          {recompose.stageLabel} · 完成后会自动刷新（约需几分钟）
        </div>
      ) : null}
      {recompose.phase === "error" ? (
        <div className="shadcn-prototype-filmstrip-error" role="alert">
          {recompose.message}
          <button type="button" onClick={() => setRecompose({ phase: "idle" })}>知道了</button>
        </div>
      ) : null}

      <div className="shadcn-prototype-filmstrip-strip" ref={stripRef}>
        {clips.map((el) => {
          const width = totalVisible > 0 ? (visibleDuration(el) / totalVisible) * 100 : 0;
          const isSelected = el.id === selectedId;
          return (
            <button
              type="button"
              key={el.id}
              className={`shadcn-prototype-filmstrip-clip${isSelected ? " selected" : ""}`}
              style={{ width: `${Math.max(4, width)}%` }}
              onClick={() => selectClip(el)}
              aria-pressed={isSelected}
            >
              <span className="inner" aria-hidden="true" />
              <span className="lb">#{segmentNumbers[el.id]}</span>
              <span className="du">{visibleDuration(el).toFixed(1)}s</span>
              {isSelected ? (
                <>
                  <span className="handle l" role="presentation" onPointerDown={onHandleDown("left")} />
                  <span className="handle r" role="presentation" onPointerDown={onHandleDown("right")} />
                </>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="shadcn-prototype-filmstrip-acts">
        <span className="who">
          {selected ? `分镜 #${selectedNumber}${selectedText ? ` · ${selectedText.slice(0, 18)}` : ""}` : "点选一段进行编辑"}
        </span>
        <button type="button" className="act" onClick={handleSplit} disabled={!selected}>✂ 分割</button>
        <button type="button" className="act" onClick={handleDelete} disabled={!selected || clips.length <= 1}>删除</button>
        <span className="tip">拖动选中段两侧的把手可裁剪时长（2–15 秒）</span>
      </div>

      {selected && selectedSegmentId ? (
        <div className="shadcn-prototype-filmstrip-props">
          <div className="row">
            <span className="k">画面</span>
            <span className="v" title={mediaName}>{mediaName || "当前素材"}</span>
            {UI_V3_ASSET_PICKER && canRecompose ? (
              <button type="button" className="act" onClick={() => void openPicker()}>换素材</button>
            ) : null}
          </div>
          {selectedText ? (
            <div className="row">
              <span className="k">配音</span>
              <input
                className="input"
                value={voiceDraft}
                onChange={(event) => setVoiceDraft(event.target.value)}
                maxLength={2000}
                aria-label="配音文本"
              />
              <button
                type="button"
                className="act"
                onClick={handleRevoice}
                disabled={!canRecompose || !voiceDraft.trim() || voiceDraft.trim() === selectedText.trim()}
              >
                重新配音
              </button>
            </div>
          ) : null}
          <div className="row">
            <span className="k">MG 字卡</span>
            <label className="toggle">
              <input
                type="checkbox"
                checked={mgActive}
                disabled={!canRecompose}
                onChange={(event) => handleToggleMg(event.target.checked)}
              />
              <i aria-hidden="true" />
            </label>
            <span className="v">{mgActive ? "已启用字卡" : "无字卡"}</span>
            <span className="hint">想换字卡文案？回到对话直接说，比如「第 {selectedNumber} 段字卡换成保修年限」</span>
          </div>
        </div>
      ) : null}

      <div className="shadcn-prototype-filmstrip-note">
        字幕会自动跟随配音文本 · 需要分轨调整？
        <a href={assetId ? `/editor?asset=${encodeURIComponent(assetId)}` : "/editor"} target="_blank" rel="noreferrer">
          全屏打开 ↗
        </a>
      </div>
      <div className="shadcn-prototype-filmstrip-foot">
        <button type="button" className="undo" onClick={handleUndo} disabled={!core.command.canUndo()}>↺ 撤销</button>
        <span className="warn">仅裁剪/分割会被 AI 重排覆盖；素材/配音/字卡修改不受影响</span>
        <span className="save" aria-live="polite">
          {saveNote === "saving" ? "保存中…" : saveNote === "saved" ? "已自动保存" : saveNote === "error" ? "保存失败" : ""}
        </span>
        <span className="total">总时长 {formatClock(totalVisible)}</span>
      </div>

      <AssetPicker
        open={pickerOpen}
        title={`为分镜 #${selectedNumber ?? "-"} 换素材`}
        subtitle="替换后只更新当前分镜，不影响其他分镜。"
        ratio={pickerRatio}
        current={materialCandidates.current}
        recommended={materialCandidates.recommended}
        library={materialCandidates.library}
        publicItems={materialCandidates.publicItems}
        providerStatuses={materialCandidates.providerStatuses}
        loading={materialCandidates.localLoading}
        error={materialCandidates.localError}
        publicLoading={materialCandidates.publicLoading}
        publicError={materialCandidates.publicError}
        hasMorePublic={materialCandidates.hasMorePublic}
        onLoadMorePublic={materialCandidates.loadMorePublic}
        onSelect={handlePickMaterial}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  );
}
