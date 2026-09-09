function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const TASK_MODES = new Set(["create", "repurpose"]);
const CONTENT_GOALS = new Set(["explain", "promote", "story"]);
const STYLE_PROFILES = new Set(["editorial_clean", "ugc_native", "brand_polished"]);
const PRODUCTION_MODES = new Set(["source_led", "generated_led", "hybrid"]);
const ANCHOR_SOURCES = new Set(["presenter_video", "uploaded_assets", "product_reference"]);

export function videoCreativeProfile(
  videoPlan: unknown,
): Record<string, unknown> | null {
  if (!isRecord(videoPlan) || !isRecord(videoPlan.creative_profile)) return null;
  const profile = videoPlan.creative_profile;
  if (
    !TASK_MODES.has(String(profile.task_mode ?? ""))
    || !CONTENT_GOALS.has(String(profile.content_goal ?? ""))
    || !STYLE_PROFILES.has(String(profile.style_profile ?? ""))
    || !PRODUCTION_MODES.has(String(profile.production_mode ?? ""))
    || !ANCHOR_SOURCES.has(String(profile.anchor_source ?? ""))
    || typeof profile.preserve_source_audio !== "boolean"
  ) return null;
  return profile;
}

export function isFiveLayerVideoPlan(videoPlan: unknown): boolean {
  return videoCreativeProfile(videoPlan) !== null;
}

export function isPresenterSourceVideoPlan(videoPlan: unknown): boolean {
  const profile = videoCreativeProfile(videoPlan);
  if (!profile) return false;
  return profile.task_mode === "repurpose"
    && profile.anchor_source === "presenter_video"
    && profile.preserve_source_audio === true
    && (profile.production_mode === "source_led" || profile.production_mode === "hybrid");
}
