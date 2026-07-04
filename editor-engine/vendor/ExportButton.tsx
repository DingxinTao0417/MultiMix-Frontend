import { useState } from "react";
import { useEditor } from "@editor/hooks/use-editor";
import { getExportMimeType } from "@editor/lib/export";
import { API_BASE } from "./api";

export function ExportButton({ assetId, token }: { assetId?: string | null; token?: string | null }) {
  const editor = useEditor();
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [lastBlob, setLastBlob] = useState<Blob | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [errorText, setErrorText] = useState("");

  async function handleExport() {
    setExporting(true);
    setProgress(0);
    setLastBlob(null);
    setUploaded(false);
    setErrorText("");
    try {
      const result = await editor.renderer.exportProject({
        options: { format: "mp4", quality: "high", includeAudio: true },
        onProgress: ({ progress }) => setProgress(progress),
      });
      if (result.success && result.buffer) {
        const mime = getExportMimeType({ format: "mp4" });
        const blob = new Blob([result.buffer], { type: mime });
        setLastBlob(blob);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `video-${Date.now()}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        setErrorText("导出失败：" + (result.error || "未知错误"));
      }
    } catch (e) {
      setErrorText("导出出错：" + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
      setProgress(0);
    }
  }

  async function handleUpload() {
    if (!lastBlob || !assetId || !token) return;
    setUploading(true);
    setErrorText("");
    try {
      const res = await fetch(`${API_BASE}/v1/video/projects/${encodeURIComponent(assetId)}/mp4`, {
        method: "POST",
        headers: { "Content-Type": "video/mp4", Authorization: `Bearer ${token}` },
        body: lastBlob,
      });
      if (res.ok) {
        setUploaded(true);
      } else {
        setErrorText(`上传失败（HTTP ${res.status}），可重试。`);
      }
    } catch {
      setErrorText("上传出错，请检查网络后重试。");
    } finally {
      setUploading(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <button onClick={handleExport} disabled={exporting}
        style={{ padding: "4px 14px", fontSize: 12, background: exporting ? "#555" : "#1f9d6b", color: "#fff", border: "none", borderRadius: 4, cursor: exporting ? "default" : "pointer" }}>
        {exporting ? `导出中 ${Math.round(progress * 100)}%` : "⬇ 导出视频"}
      </button>
      {lastBlob && assetId && token && !uploaded ? (
        <button onClick={handleUpload} disabled={uploading}
          style={{ padding: "4px 12px", fontSize: 12, background: "#2d6cdf", color: "#fff", border: "none", borderRadius: 4, cursor: uploading ? "default" : "pointer" }}>
          {uploading ? "上传中…" : "☁ 保存到产物"}
        </button>
      ) : null}
      {uploaded ? <span style={{ fontSize: 11, color: "#4ade80" }}>✓ 已保存</span> : null}
      {errorText ? <span style={{ fontSize: 11, color: "#f87171" }}>{errorText}</span> : null}
    </span>
  );
}
