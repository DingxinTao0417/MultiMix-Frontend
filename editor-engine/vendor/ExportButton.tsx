import { ExportVariantMenu } from "@/components/export-variant-menu";
import {
  brandShowcaseFilename,
  type ExportVariant,
} from "@/lib/brand-showcase";

export type ExportProgressState = {
  phase: "idle" | "rendering" | "uploading" | "verifying" | "completed" | "error";
  progress: number;
};

const EXPORT_OPTIONS = [
  { variant: "original" as const, label: "原始成片" },
  { variant: "brand_showcase" as const, label: "品牌展示版" },
];

function exportButtonLabel(state: ExportProgressState, variant: ExportVariant): string {
  const variantLabel = variant === "brand_showcase" ? "品牌展示版" : "原始成片";
  if (state.phase === "rendering") {
    return `${variantLabel} · 正在合成 ${Math.round(state.progress * 100)}%`;
  }
  if (state.phase === "uploading") return `${variantLabel} · 正在上传`;
  if (state.phase === "verifying") return `${variantLabel} · 正在检查`;
  return "导出视频";
}

export function ExportButton({
  onExport,
  exportState,
  activeExportVariant,
  verifiedBlobs,
  errorText = "",
  disabled = false,
  disabledReason = "",
}: {
  onExport: (variant: ExportVariant) => Promise<void>;
  exportState: ExportProgressState;
  activeExportVariant: ExportVariant;
  verifiedBlobs: Partial<Record<ExportVariant, Blob>>;
  errorText?: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const busy = ["rendering", "uploading", "verifying"].includes(exportState.phase);

  function handleDownload(blob: Blob, variant: ExportVariant) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = brandShowcaseFilename(`video-${Date.now()}.mp4`, variant);
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleVariant(variant: ExportVariant) {
    const verifiedBlob = verifiedBlobs[variant];
    if (verifiedBlob) {
      handleDownload(verifiedBlob, variant);
      return;
    }
    await onExport(variant);
  }

  return (
    <span className="inline-flex items-center gap-2" title={disabled ? disabledReason : undefined}>
      <ExportVariantMenu
        triggerLabel={exportButtonLabel(exportState, activeExportVariant)}
        triggerClassName="editor-action-pill primary"
        menuAriaLabel="选择视频导出版本"
        disabled={busy || disabled}
        options={EXPORT_OPTIONS}
        onSelect={(variant) => handleVariant(variant)}
      />
      {errorText ? (
        <span className="text-[11px] font-medium text-[#b42318]">
          {activeExportVariant === "brand_showcase" ? "品牌展示版" : "原始成片"}导出失败：{errorText}
        </span>
      ) : null}
    </span>
  );
}
