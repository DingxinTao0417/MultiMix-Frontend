export type SuggestionClickAction = {
  label: string;
  utterance: string;
  actionType?: string;
  enabled?: boolean;
};

export type SuggestionClickIntent = {
  disabled: boolean;
  hidden: boolean;
  mode: "fill_composer" | "submit_message" | "open_panel";
  utterance: string;
};

export function resolveSuggestionClickIntent(action: SuggestionClickAction): SuggestionClickIntent {
  const utterance = (action.utterance || action.label || "").trim();
  const normalizedUtterance = utterance.replace(/\s+/g, "");
  const mode = action.actionType === "submit_message"
    ? "submit_message"
    : action.actionType === "open_panel"
      ? "open_panel"
      : "fill_composer";
  return {
    disabled: action.enabled === false || !utterance,
    hidden: action.actionType === "open_panel" || ["打开剪辑器", "打开编辑器", "预览工程"].includes(normalizedUtterance),
    mode,
    utterance
  };
}
