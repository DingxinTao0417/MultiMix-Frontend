export type ExportProgressState = {
  phase: "idle" | "rendering" | "uploading" | "verifying" | "completed" | "error";
  progress: number;
};

function exportButtonLabel(state: ExportProgressState): string {
  if (state.phase === "rendering") {
    return `正在合成视频 ${Math.round(state.progress * 100)}%`;
  }
  if (state.phase === "uploading") return "正在上传成片";
  if (state.phase === "verifying") return "正在检查成片";
  return "导出视频";
}

export function ExportButton({
  onExport,
  exportState,
  verifiedBlob,
  errorText = "",
  disabled = false,
  disabledReason = "",
}: {
  onExport: () => Promise<void>;
  exportState: ExportProgressState;
  verifiedBlob: Blob | null;
  errorText?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const busy = ["rendering", "uploading", "verifying"].includes(exportState.phase);

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
        onClick={() => void onExport()}
        disabled={busy || disabled}
        title={disabled ? disabledReason : undefined}
        className="editor-action-pill primary"
      >
        {exportButtonLabel(exportState)}
      </button>
      {verifiedBlob ? (
        <button onClick={handleDownload} className="editor-action-pill">
          下载成片
        </button>
      ) : null}
      {errorText ? (
        <span className="text-[11px] font-medium text-[#b42318]">导出失败：{errorText}</span>
      ) : null}
    </span>
  );
}
