import type { AssetConversationSummaryResponse } from "../../../lib/api";

const CACHE_PREFIX = "multimix:conversation-summaries:v2:";
const MAX_CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1_000;
const PROJECT_PROGRESS_CODES = new Set([
  "needs_input",
  "script_review",
  "generating",
  "ready",
  "needs_attention",
]);

export type ConversationSummaryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ConversationSummaryCacheRecord = {
  savedAt: number;
  summaries: AssetConversationSummaryResponse[];
};

function cacheKey(account: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(account.trim().toLowerCase())}`;
}

function isSummary(value: unknown): value is AssetConversationSummaryResponse {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const projectState = row.project_state;
  return typeof row.id === "string"
    && typeof row.title === "string"
    && typeof row.status === "string"
    && typeof row.created_at === "string"
    && typeof row.updated_at === "string"
    && Boolean(row.metadata)
    && typeof row.metadata === "object"
    && !Array.isArray(row.metadata)
    && Boolean(projectState)
    && typeof projectState === "object"
    && !Array.isArray(projectState)
    && PROJECT_PROGRESS_CODES.has(String((projectState as Record<string, unknown>).code));
}

export function readConversationSummaryCache(
  storage: ConversationSummaryStorage,
  account: string,
  now = Date.now(),
): AssetConversationSummaryResponse[] {
  const key = cacheKey(account);
  const raw = storage.getItem(key);
  if (!raw) return [];
  try {
    const record = JSON.parse(raw) as Partial<ConversationSummaryCacheRecord>;
    if (typeof record.savedAt !== "number"
      || now - record.savedAt > MAX_CACHE_AGE_MS
      || !Array.isArray(record.summaries)
      || !record.summaries.every(isSummary)) {
      storage.removeItem(key);
      return [];
    }
    return record.summaries;
  } catch {
    storage.removeItem(key);
    return [];
  }
}

export function writeConversationSummaryCache(
  storage: ConversationSummaryStorage,
  account: string,
  summaries: AssetConversationSummaryResponse[],
  now = Date.now(),
): void {
  storage.setItem(cacheKey(account), JSON.stringify({ savedAt: now, summaries }));
}
