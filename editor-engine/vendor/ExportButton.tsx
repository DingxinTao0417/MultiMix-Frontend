import { useState } from "react";
import { useEditor } from "@editor/hooks/use-editor";
import { getExportMimeType } from "@editor/lib/export";

// Export the edited timeline to MP4 using OpenCut's browser-side WebCodecs pipeline.
export function ExportButton() {
  const editor = useEditor();
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);

  async function handleExport() {
    setExporting(true);
    setProgress(0);
    try {
      const result = await editor.renderer.exportProject({
        options: { format: "mp4", quality: "high", includeAudio: true },
        onProgress: ({ progress }) => setProgress(progress),
      });
      if (result.success && result.buffer) {
        const mime = getExportMimeType({ format: "mp4" });
        const blob = new Blob([result.buffer], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `video-${Date.now()}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        alert("导出失败: " + (result.error || "未知错误"));
      }
    } catch (e) {
      alert("导出出错: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setExporting(false);
      setProgress(0);
    }
  }

  return (
    <button onClick={handleExport} disabled={exporting}
      style={{ padding: "8px 20px", fontSize: 14, background: exporting ? "#555" : "#1f9d6b", color: "#fff", border: "none", borderRadius: 4, cursor: exporting ? "default" : "pointer" }}>
      {exporting ? `导出中 ${Math.round(progress * 100)}%` : "⬇ 导出视频"}
    </button>
  );
}
