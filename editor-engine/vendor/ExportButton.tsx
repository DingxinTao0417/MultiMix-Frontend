import { useState } from "react";

export function ExportButton({
  onExport,
  disabled = false,
  disabledReason = "",
}: {
  onExport: (onProgress: (progress: number) => void) => Promise<Blob | null>;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [verifiedBlob, setVerifiedBlob] = useState<Blob | null>(null);
  const [errorText, setErrorText] = useState("");

  async function handleExport() {
    setExporting(true);
    setProgress(0);
    setVerifiedBlob(null);
    setErrorText("");
    try {
      const blob = await onExport(setProgress);
      if (blob) setVerifiedBlob(blob);
    } catch (cause) {
      setErrorText("导出失败：" + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setExporting(false);
      setProgress(0);
    }
  }

  function handleDownload() {
    if (!verifiedBlob) return;
    const url = URL.createObjectURL(verifiedBlob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `video-${Date.now()}.mp4`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        onClick={handleExport}
        disabled={exporting || disabled}
        title={disabled ? disabledReason : undefined}
        className="editor-action-pill primary"
      >
        {exporting ? `导出中 ${Math.round(progress * 100)}%` : "导出视频"}
      </button>
      {verifiedBlob ? (
        <button onClick={handleDownload} className="editor-action-pill">
          下载成片
        </button>
      ) : null}
      {errorText ? <span className="text-[11px] font-medium text-[#b42318]">{errorText}</span> : null}
    </span>
  );
}
