import type { AssetSourceResolutionSelection } from "./asset-workspace-types";

export type SuggestionClickAction = {
  label: string;
  utterance: string;
  actionType?: string;
  enabled?: boolean;
  targetAssetId?: number;
  sourceResolutionId?: string;
};

export type SuggestionClickIntent = {
  disabled: boolean;
  hidden: boolean;
  mode: "fill_composer" | "submit_message" | "open_panel" | "select_source";
  utterance: string;
  sourceResolutionSelection?: AssetSourceResolutionSelection;
};

export function resolveSuggestionClickIntent(action: SuggestionClickAction): SuggestionClickIntent {
  const utterance = (action.utterance || action.label || "").trim();
  const normalizedUtterance = utterance.replace(/\s+/g, "");
  const mode = action.actionType === "select_source"
    ? "select_source"
    : action.actionType === "submit_message"
    ? "submit_message"
    : action.actionType === "open_panel"
      ? "open_panel"
      : "fill_composer";
  const sourceResolutionId = (action.sourceResolutionId || "").trim();
  const sourceResolutionSelection = mode === "select_source"
    && Number.isInteger(action.targetAssetId)
    && Number(action.targetAssetId) > 0
    && sourceResolutionId
    ? {
        resolutionId: sourceResolutionId,
        assetId: Number(action.targetAssetId),
      }
    : undefined;
  return {
    disabled: action.enabled === false || !utterance || (mode === "select_source" && !sourceResolutionSelection),
    hidden: action.actionType === "open_panel" || ["打开剪辑器", "打开编辑器", "预览工程"].includes(normalizedUtterance),
    mode,
    utterance,
    ...(sourceResolutionSelection ? { sourceResolutionSelection } : {}),
  };
}
