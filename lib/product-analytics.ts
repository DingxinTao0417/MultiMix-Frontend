import { API_BASE } from "./api";


const EVENT_NAMES = new Set([
  "workspace_opened",
  "recommendation_selected",
  "source_evidence_opened",
  "video_editor_opened",
]);
const PROPERTY_KEYS = new Set([
  "recommendation_key",
  "asset_kind",
  "source_type",
  "entry_surface",
]);
const SESSION_STORAGE_KEY = "multimix_product_analytics_session";

export type ProductEventInput = {
  eventName: string;
  conversationId?: string | null;
  assetId?: number | null;
  sessionId?: string | null;
  properties?: Record<string, unknown>;
};


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
  if (!token || !EVENT_NAMES.has(event.eventName)) return;
  const properties = Object.fromEntries(
    Object.entries(event.properties ?? {}).flatMap(([key, value]) => (
      PROPERTY_KEYS.has(key) && typeof value === "string" && value.length <= 120
        ? [[key, value]]
        : []
    )),
  );
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
