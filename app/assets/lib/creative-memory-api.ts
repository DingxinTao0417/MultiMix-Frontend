import { api } from "../../../lib/api";

export function getCreativeProfileCapabilities(token: string): Promise<{ visible: boolean }> {
  return api("/auth/me/creative-profile/capabilities", token);
}

export type CreativeProjectSnapshot = {
  schema_version: "project_creative_memory_snapshot:v1";
  memory_revision: number;
  selected_items: Array<Pick<CreativeMemoryItem, "id" | "kind" | "key" | "value">>;
};

export type CreativeProjectUsage = {
  ignoreProfile: boolean;
  snapshot: CreativeProjectSnapshot | null;
};

export function creativeSnapshotForProduct(product: {
  contentType?: string;
  metadata?: Record<string, unknown>;
}): CreativeProjectSnapshot | null {
  const metadata = product.metadata ?? {};
  const brief = product.contentType === "video_script"
    ? metadata.creative_brief
    : product.contentType === "video_project"
      ? (metadata.video_plan as Record<string, unknown> | undefined)?.material_policy
      : null;
  const source = product.contentType === "video_project"
    ? (brief as Record<string, unknown> | undefined)?.creative_brief
    : brief;
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const snapshot = (source as Record<string, unknown>).creative_memory_snapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, unknown>;
  return value.schema_version === "project_creative_memory_snapshot:v1"
    && typeof value.memory_revision === "number"
    && Array.isArray(value.selected_items)
    ? snapshot as CreativeProjectSnapshot
    : null;
}

export async function createCreativeProject(token: string, ignoreProfile: boolean): Promise<string> {
  const conversation = await api<{ id: string }>("/assets/conversations", token, {
    method: "POST",
    body: JSON.stringify({ ignore_profile: ignoreProfile }),
  });
  return conversation.id;
}

function projectUsageFromConversation(value: { metadata?: Record<string, unknown> }): CreativeProjectUsage {
  const metadata = value.metadata ?? {};
  const raw = metadata.creative_memory_snapshot;
  const snapshot = raw && typeof raw === "object" && !Array.isArray(raw)
    && (raw as Record<string, unknown>).schema_version === "project_creative_memory_snapshot:v1"
    ? raw as CreativeProjectSnapshot
    : null;
  return { ignoreProfile: metadata.creative_memory_ignore_profile === true, snapshot };
}

export async function getCreativeProjectUsage(token: string, conversationId: string): Promise<CreativeProjectUsage> {
  const conversation = await api<{ metadata: Record<string, unknown> }>(
    `/assets/conversations/${encodeURIComponent(conversationId)}?include_project_resource_items=false`, token,
  );
  return projectUsageFromConversation(conversation);
}

export async function setCreativeProjectUsage(
  token: string, conversationId: string, ignoreProfile: boolean,
): Promise<CreativeProjectUsage> {
  const conversation = await api<{ metadata: Record<string, unknown> }>(
    `/assets/conversations/${encodeURIComponent(conversationId)}/creative-profile-usage`, token,
    { method: "PATCH", body: JSON.stringify({ ignore_profile: ignoreProfile }) },
  );
  return projectUsageFromConversation(conversation);
}

export type CreativeMemoryKind =
  | "identity"
  | "topic"
  | "audience"
  | "expression_preference"
  | "confirmed_fact"
  | "must_follow"
  | "avoid";

export type CreativeMemoryItem = {
  id: string;
  kind: CreativeMemoryKind;
  key: "display_name" | "description" | null;
  value: string;
  source: { type: "manual" | "confirmed_candidate"; reference_id: number | null };
  fingerprint: string;
  updated_at: string;
};

export type CreativeProfile = {
  schema_version: "user_creative_memory:v1";
  revision: number;
  enabled: boolean;
  candidate_prompt_mode: "normal" | "reduced" | "off";
  dismissal_streak?: number;
  profile: { items: CreativeMemoryItem[] };
  updated_at: string | null;
};

export type CreativeMemoryCandidate = {
  id: number;
  kind: Exclude<CreativeMemoryKind, "identity" | "confirmed_fact">;
  value: string;
  source_event_refs: Array<number | string>;
  expires_at: string;
};

export type CreativeCandidateBatch = {
  status: "off" | "none" | "queued" | "running" | "ready" | "no_candidates" | "failed" | "expired";
  batch_id: number | null;
  candidates: CreativeMemoryCandidate[];
};

export type CreativeCandidateDecision = {
  candidate_id: number;
  action: "accepted" | "rejected" | "dismissed";
};

export function getCreativeCandidates(token: string, projectAssetId: number): Promise<CreativeCandidateBatch> {
  return api(`/auth/me/creative-profile/candidates?project_asset_id=${projectAssetId}`, token);
}

export function resolveCreativeCandidates(
  token: string,
  payload: { expected_revision: number; idempotency_key: string; decisions: CreativeCandidateDecision[] },
): Promise<CreativeProfile> {
  return api("/auth/me/creative-profile/candidates/resolve", token, {
    method: "POST", body: JSON.stringify(payload),
  });
}

export type CreativeSuppression = {
  id: number;
  kind: CreativeMemoryKind;
  value: string;
  fingerprint: string;
  created_at: string;
};

type ManualItem = {
  id?: string;
  kind: CreativeMemoryKind;
  key: "display_name" | "description" | null;
  value: string;
};

export type CreativeProfilePatch = {
  expected_revision: number;
  enabled?: boolean;
  candidate_prompt_mode?: CreativeProfile["candidate_prompt_mode"];
  upsert_items?: ManualItem[];
};

export type CreativeProfileDelete = {
  expected_revision: number;
  suppress_future_suggestions: boolean;
};

export function getCreativeProfile(token: string): Promise<CreativeProfile> {
  return api("/auth/me/creative-profile", token);
}

export function patchCreativeProfile(token: string, payload: CreativeProfilePatch): Promise<CreativeProfile> {
  return api("/auth/me/creative-profile", token, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteCreativeProfileItem(
  token: string,
  itemId: string,
  payload: CreativeProfileDelete,
): Promise<CreativeProfile> {
  return api(`/auth/me/creative-profile/items/${encodeURIComponent(itemId)}`, token, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}

export function clearCreativeProfile(token: string, payload: CreativeProfileDelete): Promise<CreativeProfile> {
  return api("/auth/me/creative-profile", token, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}

export function getCreativeSuppressions(token: string): Promise<CreativeSuppression[]> {
  return api("/auth/me/creative-profile/suppressions", token);
}

export function restoreCreativeSuppression(
  token: string,
  suppressionId: number,
  payload: { expected_revision: number },
): Promise<CreativeProfile> {
  return api(`/auth/me/creative-profile/suppressions/${suppressionId}`, token, {
    method: "DELETE",
    body: JSON.stringify(payload),
  });
}
