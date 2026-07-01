"use client";

import { useEffect, useRef, useState } from "react";
import { initEditorWithProject } from "@/editor-engine/vendor/bootstrap";
import type { BackendProject } from "@/editor-engine/vendor/buildProject";
import { EditorCore } from "@editor/core";
import { Timeline } from "@editor/components/editor/panels/timeline";
import { PreviewPanel } from "@editor/components/editor/panels/preview";
import { ExportButton } from "@/editor-engine/vendor/ExportButton";
import { PlayButton } from "@/editor-engine/vendor/PlayButton";
import { ReplacePanel } from "@/editor-engine/vendor/ReplacePanel";
import { API_BASE } from "@/editor-engine/vendor/api";

type LoadState = "idle" | "loading" | "ready" | "error";

async function fetchProject(endpoint: string, token: string | null): Promise<BackendProject> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "无法加载视频项目");
  }
  const data = await res.json();
  if (data.status !== "completed" || !data.project) {
    throw new Error(`项目尚未就绪（${data.status} / ${data.render_stage}）`);
  }
  const raw = data.project;
  // ChangeIn format: video_project.timeline has the BackendProject shape.
  // video_orchestration format: the project itself IS the BackendProject.
  if (raw.tracks) return raw as BackendProject;
  if (raw.timeline && raw.timeline.tracks) return raw.timeline as BackendProject;
  throw new Error("项目格式不兼容（缺少 tracks）");
}

export default function EditorView({ jobId, assetId, token, embed }: { jobId: string | null; assetId: string | null; token: string | null; embed?: boolean }) {
  const [state, setState] = useState<LoadState>("idle");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const startedRef = useRef(false);

  const handleSave = async () => {
    if (!assetId || !token || saving) return;
    setSaving(true);
    try {
      const project = EditorCore.getInstance().project.getActive();
      await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(project),
      });
    } catch {
      // silent for now; could add toast later
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    const endpoint = jobId
      ? `/v1/video/jobs/${encodeURIComponent(jobId)}`
      : assetId
        ? `/v1/video/projects/${encodeURIComponent(assetId)}`
        : null;
    console.log("[Editor] load:", { jobId, assetId, token: token ? "set" : "null", endpoint, API_BASE });
    if (!endpoint) {
      setState("error");
      setError("缺少项目 ID。请从对话中生成视频后再打开剪辑器。");
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    setState("loading");
    void (async () => {
      try {
        const bp = await fetchProject(endpoint, token);
        await initEditorWithProject(bp);
        setTitle(bp.metadata?.title ?? "");
        setState("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setState("error");
      }
    })();
  }, [jobId, assetId, token]);

  return (
    <div className="editor-root dark" style={{ height: "100vh", display: "flex", flexDirection: "column", color: "#eee", background: "#0e0e0e" }}>
      <div style={{ padding: embed ? "6px 12px" : "10px 16px", borderBottom: "1px solid #2a2a2a", flexShrink: 0, display: "flex", alignItems: "center", gap: 12 }}>
        {!embed ? (
          <a href="/app/assets" style={{ color: "#888", fontSize: 12, textDecoration: "none", marginRight: 4 }}>← 工作台</a>
        ) : null}
        <strong style={{ fontSize: embed ? 12 : 14 }}>{title || "视频剪辑器"}</strong>
        {state === "ready" && assetId ? (
          <button onClick={handleSave} disabled={saving} style={{ padding: "4px 12px", fontSize: 12, background: "#2d6cdf", color: "#fff", border: "none", borderRadius: 4, cursor: saving ? "default" : "pointer" }}>
            {saving ? "保存中…" : "💾 保存项目"}
          </button>
        ) : null}
        {state === "ready" ? <ExportButton assetId={assetId} token={token} /> : null}
        {state === "loading" ? <span style={{ color: "#888", fontSize: 13 }}>正在加载项目…</span> : null}
        {state === "error" ? <span style={{ color: "#f66", fontSize: 13 }}>{error}</span> : null}
      </div>

      {state === "ready" ? (
        <>
          <div style={{ flex: "1 1 55%", minHeight: 0, position: "relative", background: "#000" }}>
            <PreviewPanel />
            <ReplacePanel assetId={assetId} token={token} />
          </div>
          <div style={{ padding: "8px 16px", borderTop: "1px solid #2a2a2a", flexShrink: 0 }}>
            <PlayButton />
          </div>
          <div style={{ flex: "1 1 45%", minHeight: 0, position: "relative", borderTop: "1px solid #2a2a2a" }}>
            <Timeline />
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#666" }}>
          {state === "error" ? error : "正在准备剪辑器…"}
        </div>
      )}
    </div>
  );
}
