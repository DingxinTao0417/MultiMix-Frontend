import { useEffect, useRef, useState } from "react";
import { useEditor } from "@editor/hooks/use-editor";
import {
  API_BASE,
  recomposeSegmentMaterial,
  segmentMaterialCandidates,
  type SegmentMaterialCandidate,
} from "./api";
import { getVideoProjectJob } from "@/lib/video-project-client";
import { waitForJobTerminal } from "@/lib/job-poller";
import { updateEditorProject } from "./bootstrap";
import { segmentIdByElementId, segmentTextByElementId, type BackendProject } from "./buildProject";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@editor/components/ui/sheet";

export function ReplacePanel({ assetId, token }: { assetId?: string | null; token?: string | null }) {
  const selected = useEditor((e) => e.selection.getSelectedElements());
  const tracks = useEditor((e) => e.timeline.getTracks());
  const [localCandidates, setLocalCandidates] = useState<SegmentMaterialCandidate[]>([]);
  const [publicCandidates, setPublicCandidates] = useState<SegmentMaterialCandidate[]>([]);
  const [publicError, setPublicError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [open, setOpen] = useState(false);
  const pollAbortRef = useRef<AbortController | null>(null);

  const sel = selected.length === 1 ? selected[0] : null;
  let selEl: { id: string; type: string; duration: number; startTime: number; trackId: string } | null = null;
  if (sel) {
    for (const t of tracks) {
      if (t.id !== sel.trackId) continue;
      const el = t.elements.find((x) => x.id === sel.elementId);
      if (el && (el.type === "video" || el.type === "image")) {
        selEl = { id: el.id, type: el.type, duration: el.duration, startTime: el.startTime, trackId: t.id };
      }
    }
  }

  // Clear options when selection changes.
  useEffect(() => {
    setLocalCandidates([]);
    setPublicCandidates([]);
    setPublicError(null);
    pollAbortRef.current?.abort();
  }, [selEl?.id]);
  useEffect(() => () => pollAbortRef.current?.abort(), []);
  const segText = selEl ? segmentTextByElementId[selEl.id] || "" : "";
  // Real segment id (not the timeline element id) is what the recompose and
  // candidate endpoints are scoped to.
  const segmentId = selEl ? segmentIdByElementId[selEl.id] || "" : "";
  const canReplace = Boolean(selEl && segmentId && assetId && token);

  if (!canReplace) return null;

  async function reloadProject() {
    if (!assetId) return;
    const res = await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`刷新项目失败：HTTP ${res.status}`);
    const data = await res.json();
    const raw = data.project;
    if (raw?.tracks) {
      await updateEditorProject(raw as BackendProject);
      return;
    }
    if (raw?.timeline?.tracks) {
      await updateEditorProject(raw.timeline as BackendProject);
      return;
    }
    throw new Error("刷新项目失败：缺少时间轴数据");
  }

  async function fetchOptions() {
    if (!selEl || !segmentId || !assetId) return;
    setLoading(true);
    setPublicError(null);
    try {
      // Local first (my library + recommendations), then public asynchronously
      // so a stock-provider outage never blanks out my own material.
      const local = await segmentMaterialCandidates(assetId, segmentId, "local", token);
      setLocalCandidates([
        ...local.groups.recommended,
        ...local.groups.library,
      ]);
      try {
        const remote = await segmentMaterialCandidates(assetId, segmentId, "public", token);
        setPublicCandidates(remote.groups.public);
      } catch (e) {
        setPublicError(e instanceof Error ? e.message : "公共素材加载失败。");
      }
    } catch (e) {
      setPublicError(e instanceof Error ? e.message : "素材加载失败。");
    } finally {
      setLoading(false);
    }
  }

  async function reloadAndClose() {
    await reloadProject();
    setLocalCandidates([]);
    setPublicCandidates([]);
    setOpen(false);
  }

  async function waitForVideoJob(jobId: string) {
    pollAbortRef.current?.abort();
    const controller = new AbortController();
    pollAbortRef.current = controller;
    const job = await waitForJobTerminal(
      () => getVideoProjectJob({ token, jobId }),
      { signal: controller.signal, timeoutMs: 5 * 60_000 },
    );
    if (job.status === "failed") {
      throw new Error(job.error_message || "视频修改失败，请重试。");
    }
  }

  // Replace through the authoritative server recompose (not a browser-only
  // timeline edit): the backend persists the material into video_plan and
  // rebuilds video_project, then we reload the editor from that project.
  async function applyReplace(candidate: SegmentMaterialCandidate) {
    if (!selEl || !segmentId || !assetId || !candidate.selectable) return;
    if (!candidate.candidate_id) {
      alert("该候选已失效，请刷新候选列表后重试。");
      return;
    }
    setReplacing(true);
    try {
      let result = await recomposeSegmentMaterial(assetId, segmentId, candidate.candidate_id, token);
      if (result.kind === "confirm_overwrite") {
        if (!window.confirm(result.message)) {
          setReplacing(false);
          return;
        }
        result = await recomposeSegmentMaterial(assetId, segmentId, candidate.candidate_id, token, true);
      }
      if (result.kind === "started") {
        // Recompose publishes atomically. Wait for its real terminal job state
        // before reading the project; a 202 response still contains the old one.
        if (!result.job.id) throw new Error("重合成任务未返回任务 ID，请重试。");
        await waitForVideoJob(result.job.id);
        await reloadAndClose();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "素材替换失败，请重试。");
    } finally {
      setReplacing(false);
    }
  }

  function renderCandidateGroup(label: string, items: SegmentMaterialCandidate[]) {
    if (!items.length) return null;
    return (
      <div className="space-y-3">
        <div className="text-[12px] font-semibold text-[#17211d]">{label}</div>
        <div className="grid grid-cols-2 gap-3">
          {items.map((candidate, i) => {
            const meta = [
              candidate.media_type === "image" ? "图片" : "视频",
              candidate.duration ? `${candidate.duration.toFixed(1)}s` : "",
              candidate.provider,
              candidate.requires_trim ? "需裁切" : "",
            ].filter(Boolean).join(" · ");
            return (
              <button
                key={candidate.candidate_id ?? `${candidate.provider}-${i}`}
                type="button"
                disabled={replacing || !candidate.selectable}
                onClick={() => applyReplace(candidate)}
                className="overflow-hidden rounded-2xl border border-[#d7ded7] bg-white text-left shadow-[0_8px_18px_rgba(21,32,27,0.04)] transition hover:-translate-y-px hover:shadow-[0_12px_24px_rgba(21,32,27,0.08)] disabled:cursor-default disabled:opacity-60"
              >
                {candidate.preview_url ? (
                  candidate.media_type === "image" ? (
                    <img src={candidate.preview_url} className="block h-28 w-full object-cover" />
                  ) : (
                    <video src={candidate.preview_url} muted className="block h-28 w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-28 w-full items-center justify-center bg-[#f4f6f4] text-[11px] text-[#9aa39d]">无预览</div>
                )}
                <div className="px-3 py-2">
                  <div className="truncate text-[12px] font-medium text-[#17211d]" title={candidate.title}>{candidate.title}</div>
                  {meta ? <div className="mt-0.5 text-[10px] text-[#627069]">{meta}</div> : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="absolute top-4 right-4 z-40 inline-flex min-h-[32px] items-center justify-center rounded-full border border-[#cbd6ce] bg-white/94 px-3 text-xs font-[650] text-[#17211d] shadow-[0_10px_24px_rgba(21,32,27,0.08)] backdrop-blur transition hover:-translate-y-px hover:shadow-[0_12px_26px_rgba(21,32,27,0.12)]"
        >
          替换素材
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-[360px] max-w-[92vw] border-l border-[#eceef0] bg-[#fffffd] p-0">
        <div className="flex h-full flex-col">
          <SheetHeader className="gap-2 border-b border-[#eceef0] px-5 py-5">
            <SheetTitle className="text-[16px] font-semibold text-[#17211d]">替换素材</SheetTitle>
            <SheetDescription className="text-[12px] leading-5 text-[#627069]">
              先选中一个视频或图片片段，再从素材库或公共候选中替换。
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-5">
                <div className="rounded-2xl border border-[#eceef0] bg-[#f7f8f5] p-4">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#627069]">当前片段文案</div>
                  <div className="text-[13px] leading-6 text-[#17211d]">
                    {segText || "该片段暂无可用文案"}
                  </div>
                </div>

                <div>
                  <button
                    onClick={fetchOptions}
                    disabled={loading || !canReplace}
                    className="inline-flex min-h-[38px] items-center justify-center rounded-full border border-[#18181b] bg-[#18181b] px-4 text-[12px] font-[650] text-white disabled:cursor-default disabled:opacity-60"
                  >
                    {loading ? "搜索中…" : "找候选"}
                  </button>
                </div>

                {renderCandidateGroup("我的素材 / 推荐", localCandidates)}
                {renderCandidateGroup("公共素材", publicCandidates)}
                {publicError ? (
                  <div className="rounded-2xl border border-[#f0d9d9] bg-[#fbf3f3] px-4 py-3 text-[12px] leading-5 text-[#9c4a4a]">
                    {publicError}
                  </div>
                ) : null}

              </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
