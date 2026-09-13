import { API_BASE } from "./api";


const EVENT_NAMES = new Set([
  "workspace_opened",
  "recommendation_selected",
  "source_evidence_opened",
  "video_editor_opened",
  "requirement_summary_viewed",
  "requirement_confirmed_first_pass",
  "requirement_corrected",
  "requirement_conflict_resolved",
  "requirement_evidence_opened",
  "requirement_clone_created",
]);
const PROPERTY_KEYS = new Set([
  "recommendation_key",
  "asset_kind",
  "source_type",
  "entry_surface",
  "snapshot_version",
  "requirement_status",
  "conflict_severity",
  "resolution_kind",
  "correction_kind",
  "question_required",
  "source_count",
  "duration_ms",
]);
const NUMBER_PROPERTY_KEYS = new Set(["snapshot_version", "source_count", "duration_ms"]);
const BOOLEAN_PROPERTY_KEYS = new Set(["question_required"]);
const ENUM_PROPERTY_VALUES: Record<string, ReadonlySet<string>> = {
  requirement_status: new Set(["analyzing", "needs_confirmation", "ready", "failed"]),
  conflict_severity: new Set(["blocking", "non_blocking"]),
  resolution_kind: new Set(["choose_evidence", "replace_with_user_value", "exclude_both"]),
  correction_kind: new Set(["manual_value", "source_usage", "requirement_edit", "unnecessary_question"]),
};
const SESSION_STORAGE_KEY = "multimix_product_analytics_session";

export type ProductEventInput = {
  eventName: string;
  conversationId?: string | null;
  assetId?: number | null;
  sessionId?: string | null;
  properties?: Record<string, unknown>;
};

export function isAllowedProductEvent(eventName: string): boolean {
  return EVENT_NAMES.has(eventName);
}

export function sanitizeProductEventProperties(
  properties: Record<string, unknown> = {},
): Record<string, string | number | boolean> {
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (!PROPERTY_KEYS.has(key)) continue;
    if (NUMBER_PROPERTY_KEYS.has(key)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) sanitized[key] = value;
      continue;
    }
    if (BOOLEAN_PROPERTY_KEYS.has(key)) {
      if (typeof value === "boolean") sanitized[key] = value;
      continue;
    }
    if (typeof value !== "string" || value.length > 120) continue;
    const allowedValues = ENUM_PROPERTY_VALUES[key];
    if (!allowedValues || allowedValues.has(value)) sanitized[key] = value;
  }
  return sanitized;
}


export function getProductAnalyticsSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const id = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);
    return id;
  } catch {
    return `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}


export async function trackProductEvent(
  token: string | null | undefined,
  event: ProductEventInput,
): Promise<void> {
  if (!token || !isAllowedProductEvent(event.eventName)) return;
  const properties = sanitizeProductEventProperties(event.properties);
  const body: Record<string, unknown> = {
    event_name: event.eventName,
    properties,
  };
  if (event.conversationId) body.conversation_id = event.conversationId;
  if (event.assetId && Number.isInteger(event.assetId) && event.assetId > 0) {
    body.asset_id = event.assetId;
  }
  if (event.sessionId) body.session_id = event.sessionId;

  try {
    await fetch(`${API_BASE}/v1/product-events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
  } catch {
    // Analytics must never alter the product action it observes.
  }
}
