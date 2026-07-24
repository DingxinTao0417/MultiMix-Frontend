// Phase-3 UI feature flags (spec §12 / plan 阶段 3). Each new agentic-workbench
// component is gated so a flag flip returns the exact current behaviour. Flags
// default ON: the components themselves render only when their real data is
// present ("数据不在就不渲染"), so an enabled flag with no data is a no-op.
// Set the env var to "0"/"false"/"off" to force the pre-V3 fallback path.

function flagEnabled(value: string | undefined, defaultOn = true): boolean {
  if (value == null || value === "") return defaultOn;
  return !/^(0|false|off|no)$/i.test(value.trim());
}

// Structured confirmation card (ConfirmCard). Off → plain message + chips.
export const UI_V3_CONFIRM_CARD = flagEnabled(process.env.NEXT_PUBLIC_MULTIMIX_UI_V3_CONFIRM_CARD);

// Sidebar AI background-status capsule (AiBackgroundStatus). Off → hidden.
export const UI_V3_BG_STATUS = flagEnabled(process.env.NEXT_PUBLIC_MULTIMIX_UI_V3_BG_STATUS);

// Asset picker modal (AssetPicker). Off → no picker entry.
export const UI_V3_ASSET_PICKER = flagEnabled(process.env.NEXT_PUBLIC_MULTIMIX_UI_V3_ASSET_PICKER);

// Embed film-strip edit surface (FilmStrip, spec §5.5). Off → the embedded
// editor keeps the OpenCut multi-track timeline (spec §12 fallback).
export const UI_V3_FILMSTRIP = flagEnabled(process.env.NEXT_PUBLIC_MULTIMIX_UI_V3_FILMSTRIP);

// Product generating visuals (aurora / typing caret / live source highlight).
// Off → shimmer-only wait, one-shot full text (spec §12).
export const UI_V3_GENERATING_VISUALS = flagEnabled(process.env.NEXT_PUBLIC_MULTIMIX_UI_V3_GENERATING_VISUALS);
