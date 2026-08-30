import { emptyAssetWorkspaceData } from "./asset-workspace-empty-data";
import type {
  AgentActionRunResponse,
  AssetConversation,
  AssetLongFormAction,
  AssetProduct,
  AssetPresenterAudioSelectionConfirmation,
  AssetPresenterDirectionConfirmation,
  AssetPresenterDirectionRequest,
  AssetPresenterCleanupConfirmation,
  AssetVideoSceneReplacement,
  AssetVideoParameterConfirmation,
  AssetWorkspaceData,
  AssetWorkspaceView,
  AssetWorkshop,
  SegmentMaterialOption,
  SegmentMaterialOptions,
} from "./asset-workspace-types";
import {
  API_BASE,
  API_CONNECTION_ERROR,
  VIDEO_WRITES_PAUSED,
  VIDEO_WRITES_PAUSED_MESSAGE,
  api,
  apiBlob,
  apiForm,
  cancelAssetGenerationJob,
  getAssetGenerationJob,
  getConversationAgentAction,
  isApiConfigured,
  retryConversationAgentAction,
  retryAssetGenerationJob,
  type AgentActionRunResponse as ApiAgentActionRunResponse,
  type AssetIngestJobActionRead,
  type AssetIngestJobRead,
  type AssetConversationMessageResponse,
  type AssetGenerationJobResponse,
  type AssetConversationResponse,
  type AssetConversationSummaryResponse,
  type ContentAsset,
  type ContentAssetSearchResult,
  type ContentAssetRevisionResponse,
  type PublicMaterialCandidate,
  type PublicSourceRead,
  type SegmentMaterialCandidateResponse
} from "../../../lib/api";
import { conversationFromPersisted, contentAssetToProduct, mergePersistedConversations, relativeTimeLabel } from "../../../lib/asset-mappers";
import { isRecord, normalizeAssetTitle } from "./asset-workspace-shared";
import type { VideoQualityReport } from "./video-quality";
import {
  getSegmentMaterialCandidates,
  getVideoProjectJob,
  recomposeSegmentMaterial,
} from "../../../lib/video-project-client";
import {
  getCurrentExportJob,
  retryExportJob,
  waitForExportJob,
  type ExportFinalizeJob,
} from "../../editor/video-export-client";

export type LibraryRow = {
  assetId?: number;
  title: string;
  meta: string;
  note: string;
  kind: "file" | "copy" | "video" | "image";
  category?: string;
  keywords?: string[];
  body?: string[];
  format?: string;
  contentType?: string;
  contentTypeCode?: string;
  statusLabel?: string;
  updatedLabel?: string;
  updatedAtIso?: string;
  referenceCount?: number;
  sourceLabel?: string;
  sourceUrl?: string;
  previewUrl?: string;
  thumbnailUrl?: string;
  mediaAvailability?: "available" | "missing";
  detailLabel?: string;
  sourceRefs?: string[];
  versions?: string[];
  searchReasons?: string[];
  understandingStatus?: string;
  understandingTags?: string[];
  understandingCaption?: string;
  understandingRoles?: string[];
  licenseLabel?: string;
  productStatus?: "generating" | "completed" | "failed" | null;
  variant?: "digital-human" | "standard";
};

export type LibraryPage = {
  rows: LibraryRow[];
  nextOffset: number | null;
};

export type SourceExcerptAudit = {
  assetId: number;
  projectReady: boolean;
  productCompleted: boolean;
  audit: {
    sourceAssetCount: number;
    sourceWindowDurationSeconds: number;
    retainedRangeCount: number;
    retainedDurationSeconds: number;
    removedRangeCount: number;
    removedDurationSeconds: number;
    hasSafeRemoval: boolean;
    sourceFingerprintConsistent: boolean;
    sourceAudioVisualSubtitleTimelineConsistent: boolean;
    failureCodes: string[];
  };
};

type RawSourceExcerptAudit = {
  asset_id: number;
  project_ready: boolean;
  product_completed: boolean;
  audit: {
    source_asset_count: number;
    source_window_duration_seconds: number;
    retained_range_count: number;
    retained_duration_seconds: number;
    removed_range_count: number;
    removed_duration_seconds: number;
    has_safe_removal: boolean;
    source_fingerprint_consistent: boolean;
    source_audio_visual_subtitle_timeline_consistent: boolean;
    failure_codes: string[];
  };
};

function mapSourceExcerptAudit(raw: RawSourceExcerptAudit): SourceExcerptAudit {
  return {
    assetId: raw.asset_id,
    projectReady: raw.project_ready,
    productCompleted: raw.product_completed,
    audit: {
      sourceAssetCount: raw.audit.source_asset_count,
      sourceWindowDurationSeconds: raw.audit.source_window_duration_seconds,
      retainedRangeCount: raw.audit.retained_range_count,
      retainedDurationSeconds: raw.audit.retained_duration_seconds,
      removedRangeCount: raw.audit.removed_range_count,
      removedDurationSeconds: raw.audit.removed_duration_seconds,
      hasSafeRemoval: raw.audit.has_safe_removal,
      sourceFingerprintConsistent: raw.audit.source_fingerprint_consistent,
      sourceAudioVisualSubtitleTimelineConsistent:
        raw.audit.source_audio_visual_subtitle_timeline_consistent,
      failureCodes: raw.audit.failure_codes,
    },
  };
}

export type LibraryListOptions = {
  offset?: number;
  limit?: number;
  signal?: AbortSignal;
};

type UploadProgressCallback = (percent: number | null) => void;
const UPLOAD_STALL_TIMEOUT_MS = 60_000;
const UPLOAD_STALL_ERROR = "上传长时间没有进展，请检查网络后重试。";

export function assertVideoWritesAvailable(paused = VIDEO_WRITES_PAUSED): void {
  if (paused) throw new Error(VIDEO_WRITES_PAUSED_MESSAGE);
}

function uploadErrorMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && typeof payload.detail === "string") return payload.detail;
  return fallback || "Request failed";
}

function uploadAssetWithProgress<T>(
  path: string,
  token: string | null,
  formData: FormData,
  onProgress: UploadProgressCallback,
  idempotencyKey?: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    let settled = false;
    const send = () => {
      const request = new XMLHttpRequest();
      let requestFinished = false;
      let stallTimer: ReturnType<typeof setTimeout> | null = null;
      const clearStallTimer = () => {
        if (stallTimer !== null) {
          clearTimeout(stallTimer);
          stallTimer = null;
        }
      };
      const finishWithError = (error: Error, retryable: boolean) => {
        if (settled || requestFinished) return;
        requestFinished = true;
        clearStallTimer();
        if (retryable && idempotencyKey && attempt === 0) {
          attempt += 1;
          setTimeout(send, 300);
          return;
        }
        settled = true;
        reject(error);
      };
      const armStallTimer = () => {
        clearStallTimer();
        stallTimer = setTimeout(() => {
          if (settled || requestFinished) return;
          request.onabort = null;
          request.abort();
          finishWithError(new Error(UPLOAD_STALL_ERROR), true);
        }, UPLOAD_STALL_TIMEOUT_MS);
      };
      request.open("POST", `${API_BASE}/v1${path}`);
      if (token) request.setRequestHeader("Authorization", `Bearer ${token}`);
      if (idempotencyKey) request.setRequestHeader("Idempotency-Key", idempotencyKey);
      request.upload.onprogress = (event) => {
        armStallTimer();
        onProgress(event.lengthComputable && event.total > 0
          ? Math.min(99, Math.round((event.loaded / event.total) * 100))
          : null);
      };
      request.onerror = () => finishWithError(new Error(API_CONNECTION_ERROR), true);
      request.onabort = () => finishWithError(new Error(UPLOAD_STALL_ERROR), false);
      request.onload = () => {
        if (settled || requestFinished) return;
        requestFinished = true;
        clearStallTimer();
        let payload: unknown;
        try {
          payload = request.responseText ? JSON.parse(request.responseText) as unknown : undefined;
        } catch {
          payload = undefined;
        }
        if (request.status >= 200 && request.status < 300) {
          settled = true;
          resolve(payload as T);
          return;
        }
        const retryableDatabaseFailure = request.status === 500
          && isRecord(payload)
          && payload.detail === "Database request failed.";
        if (idempotencyKey && (retryableDatabaseFailure || [502, 503, 504].includes(request.status)) && attempt === 0) {
          attempt += 1;
          setTimeout(send, 300);
          return;
        }
        settled = true;
        reject(new Error(uploadErrorMessage(payload, request.statusText)));
      };
      armStallTimer();
      try {
        request.send(formData);
      } catch {
        finishWithError(new Error(API_CONNECTION_ERROR), true);
      }
    };
    send();
  });
}

// Trimming variant on purpose: adapter-level strings feed UI labels directly.
function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function buildConversationMessagePayload({
  conversationId,
  instruction,
  selectedProductId,
  linkedAssetIds,
  clientRequestId,
  videoParameterConfirmation,
  agentConfirmationId,
  longFormAction,
  videoSceneReplacement,
  presenterDirectionConfirmation,
  presenterDirectionRequest,
  presenterCleanupConfirmation,
  presenterAudioSelectionConfirmation,
  sourceSubtitleMode,
}: {
  conversationId: string;
  instruction: string;
  selectedProductId?: number;
  linkedAssetIds?: number[];
  clientRequestId?: string;
  videoParameterConfirmation?: AssetVideoParameterConfirmation;
  agentConfirmationId?: string;
  longFormAction?: AssetLongFormAction;
  videoSceneReplacement?: AssetVideoSceneReplacement;
  presenterDirectionConfirmation?: AssetPresenterDirectionConfirmation;
  presenterDirectionRequest?: AssetPresenterDirectionRequest;
  presenterCleanupConfirmation?: AssetPresenterCleanupConfirmation;
  presenterAudioSelectionConfirmation?: AssetPresenterAudioSelectionConfirmation;
  sourceSubtitleMode?: "translated_zh" | "source" | "bilingual";
}) {
  const serializedLongFormAction = longFormAction
    ? {
        kind: longFormAction.kind,
        ...(longFormAction.kind === "analyze"
          ? { source_asset_id: longFormAction.sourceAssetId }
          : { analysis_asset_id: longFormAction.analysisAssetId }),
        ...(longFormAction.kind === "select"
          ? { candidate_id: longFormAction.candidateId }
          : {}),
        ...(longFormAction.kind === "select" && longFormAction.cleanupMode
          ? { cleanup_mode: longFormAction.cleanupMode }
          : {}),
      }
    : undefined;
  return {
    instruction,
    conversation_id: conversationId === "new" || conversationId.startsWith("draft-") ? undefined : conversationId,
    selected_product_id: selectedProductId,
    linked_asset_ids: linkedAssetIds ?? [],
    client_request_id: clientRequestId,
    ...(agentConfirmationId ? { agent_confirmation_id: agentConfirmationId } : {}),
    ...(sourceSubtitleMode ? { source_subtitle_mode: sourceSubtitleMode } : {}),
    ...(serializedLongFormAction ? { long_form_action: serializedLongFormAction } : {}),
    ...(videoSceneReplacement ? {
      video_scene_replacement: {
        failed_project_asset_id: videoSceneReplacement.failedProjectAssetId,
        scene_id: videoSceneReplacement.sceneId,
      },
    } : {}),
    ...(presenterDirectionConfirmation ? {
      presenter_direction_confirmation: {
        director_candidate_id: presenterDirectionConfirmation.directorCandidateId,
        ...(presenterDirectionConfirmation.ratio ? { ratio: presenterDirectionConfirmation.ratio } : {}),
        ...(presenterDirectionConfirmation.subtitleMode ? { subtitle_mode: presenterDirectionConfirmation.subtitleMode } : {}),
        ...(presenterDirectionConfirmation.targetSeconds ? { target_seconds: presenterDirectionConfirmation.targetSeconds } : {}),
      },
    } : {}),
    ...(presenterDirectionRequest ? {
      presenter_direction_request: {
        current_candidate_id: presenterDirectionRequest.currentCandidateId,
      },
    } : {}),
    ...(presenterCleanupConfirmation ? {
      presenter_cleanup_confirmation: {
        cleanup_plan_id: presenterCleanupConfirmation.cleanupPlanId,
        cleanup_plan_hash: presenterCleanupConfirmation.cleanupPlanHash,
        selected_candidate_ids: presenterCleanupConfirmation.selectedCandidateIds,
        protected_override_candidate_ids: presenterCleanupConfirmation.protectedOverrideCandidateIds,
        confirm_protected_override: presenterCleanupConfirmation.confirmProtectedOverride,
        audio_stream_index: presenterCleanupConfirmation.audioStreamIndex,
      },
    } : {}),
    ...(presenterAudioSelectionConfirmation ? {
      presenter_audio_selection_confirmation: {
        confirmation_id: presenterAudioSelectionConfirmation.confirmationId,
        audio_stream_index: presenterAudioSelectionConfirmation.audioStreamIndex,
        audio_fingerprint: presenterAudioSelectionConfirmation.audioFingerprint,
        transcript_hash: presenterAudioSelectionConfirmation.transcriptHash,
      },
    } : {}),
    ...(videoParameterConfirmation ? {
      video_parameter_confirmation: {
        pending_intent_id: videoParameterConfirmation.pendingIntentId,
        version: videoParameterConfirmation.version,
        ratio: videoParameterConfirmation.ratio,
        target_seconds: videoParameterConfirmation.targetSeconds,
        ...(typeof videoParameterConfirmation.aiVoiceEnabled === "boolean"
          ? { ai_voice_enabled: videoParameterConfirmation.aiVoiceEnabled }
          : {}),
      },
    } : {}),
  };
}

export function createLibraryCreationDraftConversation(
  newConversation: AssetConversation,
  nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`,
): AssetConversation {
  return {
    ...newConversation,
    id: `draft-library-${nonce}`,
  };
}

const VIDEO_PARAMETER_CONFIRMATION_HEADER = "X-MultiMix-Video-Parameter-Confirmation";

export function buildVideoParameterConfirmationHeaders(
  confirmation?: AssetVideoParameterConfirmation,
): Record<string, string> {
  if (!confirmation) return {};
  const payload = {
    pending_intent_id: confirmation.pendingIntentId,
    version: confirmation.version,
    ratio: confirmation.ratio,
    target_seconds: confirmation.targetSeconds,
    ...(typeof confirmation.aiVoiceEnabled === "boolean"
      ? { ai_voice_enabled: confirmation.aiVoiceEnabled }
      : {}),
  };
  return {
    [VIDEO_PARAMETER_CONFIRMATION_HEADER]: `v1.${encodeURIComponent(JSON.stringify(payload))}`,
  };
}

function mapAgentAction(response: ApiAgentActionRunResponse): AgentActionRunResponse {
  return {
    id: response.id,
    status: response.status,
    requiresConfirmation: response.requires_confirmation,
    confirmationId: response.confirmation_id,
    assetId: response.asset_id,
    versionId: response.version_id,
    message: response.message,
    retryable: response.retryable,
  };
}

export function findConversationByClientRequestId(
  rows: AssetConversationResponse[],
  clientRequestId: string,
): AssetConversationResponse | null {
  return rows.find((row) => row.messages.some(
    (message) => stringValue(message.metadata?.client_request_id) === clientRequestId,
  )) ?? null;
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

type AssetUnderstanding = {
  status?: string;
  caption?: string;
  tags: string[];
  roles: Array<{ code: string; label: string; score: number }>;
  sceneTypes: Array<{ code: string; label: string; score: number }>;
};

function understandingStatusLabel(status?: string): string | null {
  if (!status) return null;
  if (status === "pending") return "待理解";
  if (status === "processing") return "理解中";
  if (status === "ready") return "已理解";
  if (status === "failed") return "理解失败";
  return status;
}

function scoredItems(value: unknown): Array<{ code: string; label: string; score: number }> {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!isRecord(item)) return [];
      const code = stringValue(item.code);
      const label = stringValue(item.label) || code;
      if (!code || !label) return [];
      return [{ code, label, score: numberValue(item.score) }];
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, 4);
}

function understandingForAsset(asset: ContentAsset): AssetUnderstanding | null {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  const understanding = metadata.understanding && typeof metadata.understanding === "object"
    ? metadata.understanding as Record<string, unknown>
    : null;
  if (understanding) {
    return {
      status: stringValue(understanding.status) || undefined,
      caption: stringValue(understanding.caption) || undefined,
      tags: Array.isArray(understanding.tags) ? understanding.tags.map((item) => String(item).trim()).filter(Boolean) : [],
      roles: scoredItems(understanding.storyboard_roles),
      sceneTypes: scoredItems(understanding.scene_types)
    };
  }
  return null;
}

export type AssetWorkspaceAdapter = {
  listConversations(): AssetConversation[];
  getNewConversation(): AssetConversation;
  getWorkshop(view: Exclude<AssetWorkspaceView, "conversation">): AssetWorkshop;
  getProductText(product: AssetProduct): string;
  saveProduct(product: AssetProduct, token?: string | null): Promise<{ version: string; savedAt: string }>;
  saveTextEdit(args: {
    token: string;
    product: AssetProduct;
    body: string;
    acceptStructuralChange: boolean;
  }): Promise<
    | { kind: "saved"; product: AssetProduct }
    | { kind: "structural_change"; message: string; changes: Record<string, unknown> }
  >;
  // Backend-backed operations. Without an API, callers render an explicit
  // unconfigured state; writes must not pretend to succeed locally.
  isBackendEnabled(): boolean;
  loadConversationSummaries(token: string): Promise<AssetConversationSummaryResponse[]>;
  mergeConversationSummaries(summaries: AssetConversationSummaryResponse[], current: AssetConversation[]): AssetConversation[];
  loadConversationSnapshot(token: string, conversationId: string): Promise<AssetConversation>;
  loadConversationDetail(token: string, conversationId: string): Promise<AssetConversation>;
  loadConversations(token: string, current: AssetConversation[]): Promise<AssetConversation[]>;
  deleteConversation(token: string, conversationId: string): Promise<void>;
  renameConversation(token: string, conversationId: string, title: string): Promise<void>;
  createMaterialPackage(token: string, payload: { title: string; assetIds: number[]; metadata?: Record<string, unknown> }): Promise<ContentAsset>;
  sendMessage(args: {
    token: string;
    conversationId: string;
    instruction: string;
    selectedProductId?: number;
    linkedAssetIds?: number[];
    clientRequestId?: string;
    videoParameterConfirmation?: AssetVideoParameterConfirmation;
    agentConfirmationId?: string;
    longFormAction?: AssetLongFormAction;
    videoSceneReplacement?: AssetVideoSceneReplacement;
    presenterDirectionConfirmation?: AssetPresenterDirectionConfirmation;
    presenterDirectionRequest?: AssetPresenterDirectionRequest;
    presenterCleanupConfirmation?: AssetPresenterCleanupConfirmation;
    presenterAudioSelectionConfirmation?: AssetPresenterAudioSelectionConfirmation;
    sourceSubtitleMode?: "translated_zh" | "source" | "bilingual";
    signal?: AbortSignal;
  }): Promise<{
    conversationId: string;
    conversation: AssetConversation;
    product: AssetProduct | null;
    generationJob: AssetGenerationJobResponse | null;
    agentAction: AgentActionRunResponse | null;
  }>;
  reconcileMessage(args: {
    token: string;
    clientRequestId: string;
  }): Promise<{
    conversationId: string;
    conversation: AssetConversation;
    product: AssetProduct | null;
    generationJob: AssetGenerationJobResponse | null;
    agentAction: AgentActionRunResponse | null;
  } | null>;
  getGenerationJob(token: string, jobId: string, signal?: AbortSignal): Promise<AssetGenerationJobResponse>;
  retryGenerationJob(token: string, jobId: string): Promise<AssetGenerationJobResponse>;
  cancelGenerationJob(token: string, jobId: string): Promise<AssetGenerationJobResponse>;
  getAgentAction(
    token: string,
    conversationId: string,
    actionRunId: string,
    signal?: AbortSignal,
  ): Promise<AgentActionRunResponse>;
  retryAgentAction(
    token: string,
    conversationId: string,
    actionRunId: string,
  ): Promise<AgentActionRunResponse>;
  restoreProductVersion(args: {
    token: string;
    product: AssetProduct;
    versionId: string;
  }): Promise<{ product: AssetProduct; assistantMessage: string; diffSummary: string }>;
  getVideoJob(token: string, jobId: string): Promise<VideoJobResult>;
  retryVideoJob(token: string, jobId: string): Promise<VideoJobResult>;
  getVideoQuality(token: string, projectAssetId: number): Promise<VideoQualityReport>;
  getSourceExcerptAudit(token: string, projectAssetId: number): Promise<SourceExcerptAudit>;
  getCurrentVideoExport(token: string, projectAssetId: number, signal?: AbortSignal): Promise<ExportFinalizeJob | null>;
  retryVideoExport(
    token: string,
    projectAssetId: number,
    job: ExportFinalizeJob,
    signal?: AbortSignal,
  ): Promise<ExportFinalizeJob>;
  waitForVideoExport(
    token: string,
    projectAssetId: number,
    initialJob: ExportFinalizeJob,
    signal?: AbortSignal,
  ): Promise<ExportFinalizeJob>;
  loadSegmentMaterialCandidates(
    token: string,
    projectAssetId: number,
    segmentId: string,
    scope: "local" | "public",
    cursor?: string | null,
    limit?: number,
  ): Promise<SegmentMaterialOptions>;
  replaceSegmentMaterial(
    token: string,
    projectAssetId: number,
    segmentId: string,
    selection: SegmentMaterialSelection,
    confirmOverwrite?: boolean,
  ): Promise<
    | { kind: "confirm_overwrite"; message: string }
    | { kind: "started"; job: VideoJobResult }
  >;
  listLibrary(
    token: string,
    view: Exclude<AssetWorkspaceView, "conversation">,
    query?: string,
    options?: LibraryListOptions,
  ): Promise<LibraryPage>;
  uploadAsset(
    token: string,
    file: File,
    view: Exclude<AssetWorkspaceView, "conversation">,
    onProgress?: UploadProgressCallback,
    idempotencyKey?: string,
  ): Promise<ContentAsset>;
  getLatestAssetIngestJob(token: string, assetId: number): Promise<AssetIngestJobRead>;
  createWebCapture(token: string, payload: { url: string; title?: string; body: string; contentType?: string }): Promise<ContentAsset>;
  retryAssetIngest(token: string, assetId: number): Promise<AssetIngestJobActionRead>;
  exportAssetMarkdown(token: string, assetId: number): Promise<Blob>;
  downloadAsset(token: string, assetId: number): Promise<Blob>;
  deleteAsset(token: string, assetId: number): Promise<void>;
  reparseAsset(token: string, assetId: number): Promise<ContentAsset>;
  listPublicSources(token: string, mediaType?: "text" | "image" | "video"): Promise<PublicSourceRead[]>;
  searchPublicMaterials(token: string, payload: { query: string; mediaTypes: Array<"text" | "image" | "video">; providers?: string[]; limit?: number }): Promise<PublicMaterialCandidate[]>;
  importPublicMaterial(token: string, candidate: PublicMaterialCandidate): Promise<ContentAsset>;
  listAdminPublicSources(token: string): Promise<PublicSourceRead[]>;
  updateAdminPublicSource(token: string, provider: string, payload: Partial<Pick<PublicSourceRead, "enabled" | "media_types">>): Promise<PublicSourceRead>;
  checkAdminPublicSourceHealth(token: string, provider: string): Promise<PublicSourceRead>;
};

export function conversationFromSummary(
  row: AssetConversationSummaryResponse,
  newConversationProduct: AssetProduct,
): AssetConversation {
  return {
    id: row.id,
    detailsLoaded: false,
    title: row.title,
    type: "llm-generation",
    updatedAt: relativeTimeLabel(row.updated_at),
    assetLabel: "对话历史",
    status: row.status,
    prompt: "",
    response: "",
    canvasTitle: row.title,
    canvasMeta: "",
    raw: "",
    judgment: "",
    action: "",
    delivery: "",
    suggestions: [],
    messages: [],
    product: newConversationProduct,
    products: [],
    sourceIds: [],
  };
}

export async function retryConversationDetailLoad<T>(
  load: () => Promise<T>,
  wait: () => Promise<void> = () => new Promise((resolve) => window.setTimeout(resolve, 600)),
): Promise<T> {
  try {
    return await load();
  } catch {
    await wait();
    return load();
  }
}

export type VideoJobStepResult = {
  key: string;
  label: string;
  status: string;
  retryJobId: string | null;
};

export type VideoJobResult = {
  id: string;
  assetId: number;
  status: string;
  workflowStage: string;
  steps: VideoJobStepResult[];
  errorMessage: string | null;
  project: Record<string, unknown> | null;
  productStatus?: "generating" | "completed" | "failed";
  productCompleted: boolean;
  failureReason?: string | null;
  failureAction?: "retry" | "modify_script" | "replace_scene_asset" | null;
  failureSceneId?: string | null;
  operationStatus?: "generating" | "completed" | "failed" | null;
  operationFailureReason?: string | null;
  operationFailureAction?: "retry" | "modify_script" | "replace_scene_asset" | null;
  operationFailureSceneId?: string | null;
};

type RawVideoJob = {
  id: string;
  asset_id: number;
  status: string;
  workflow_stage?: string | null;
  steps?: Array<{
    key?: string;
    label?: string;
    status?: string;
    retry_job_id?: string | null;
  }> | null;
  error_message: string | null;
  project: Record<string, unknown> | null;
  product_status?: "generating" | "completed" | "failed";
  product_completed?: boolean;
  failure_reason?: string | null;
  failure_action?: "retry" | "modify_script" | "replace_scene_asset" | null;
  failure_scene_id?: string | null;
  operation_status?: "generating" | "completed" | "failed" | null;
  operation_failure_reason?: string | null;
  operation_failure_action?: "retry" | "modify_script" | "replace_scene_asset" | null;
  operation_failure_scene_id?: string | null;
};

// Normalise the public video-job DTO. The server owns semantic step copy and
// exposes only workflow state plus public retry handles.
function mapVideoJob(raw: RawVideoJob): VideoJobResult {
  const steps = Array.isArray(raw.steps)
    ? raw.steps.flatMap((step): VideoJobStepResult[] => {
        const key = typeof step.key === "string" ? step.key : "";
        const label = typeof step.label === "string" ? step.label : "";
        if (!key || !label) return [];
        return [{
          key,
          label,
          status: typeof step.status === "string" ? step.status : "wait",
          retryJobId: typeof step.retry_job_id === "string" ? step.retry_job_id : null
        }];
      })
    : [];
  return {
    id: raw.id,
    assetId: raw.asset_id,
    status: raw.status,
    workflowStage: raw.workflow_stage || raw.status,
    steps,
    errorMessage: raw.error_message,
    project: raw.project,
    productStatus: raw.product_status,
    productCompleted: raw.product_completed === true,
    failureReason: raw.failure_reason,
    failureAction: raw.failure_action,
    failureSceneId: raw.failure_scene_id,
    operationStatus: raw.operation_status,
    operationFailureReason: raw.operation_failure_reason,
    operationFailureAction: raw.operation_failure_action,
    operationFailureSceneId: raw.operation_failure_scene_id,
  };
}

function materialPreviewUrl(value: unknown): string | undefined {
  const ref = stringValue(value);
  if (!ref) return undefined;
  if (/^https?:\/\//i.test(ref) || ref.startsWith("data:") || ref.startsWith("blob:")) return ref;
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
}

// Map a library view to the backend asset_kind values it should display.
function libraryKindsForView(view: Exclude<AssetWorkspaceView, "conversation">): string[] {
  if (view === "copy") return ["copy"];
  if (view === "image") return ["image"];
  if (view === "video") return ["video"];
  return ["asset"]; // 资产库: uploaded/captured knowledge sources
}

function libraryRowKind(asset: ContentAsset): LibraryRow["kind"] {
  if (asset.asset_kind === "image") return "image";
  if (asset.asset_kind === "video") return "video";
  if (asset.asset_kind === "copy") return "copy";
  return "file";
}

export function libraryKeywordsForAsset(asset: ContentAsset): string[] {
  const understanding = understandingForAsset(asset);
  return [...(understanding?.tags ?? [])]
    .map((keyword) => String(keyword).trim())
    .filter((keyword, index, array) => Boolean(keyword) && array.indexOf(keyword) === index)
    .slice(0, 8);
}

export function libraryVariantForAsset(asset: ContentAsset): "digital-human" | "standard" {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  return metadata.video_mode === "digital_human" ? "digital-human" : "standard";
}

function inferAssetSourceCategory(asset: ContentAsset): string {
  const sourceType = String(asset.source_type ?? "").trim().toLowerCase();
  if (sourceType === "upload" || sourceType === "manual_text") return "上传资料";
  if (sourceType === "web_capture" || sourceType === "public_source") return "采集资料";
  if (sourceType === "conversation" || sourceType === "chat_upload") return "对话沉淀";
  return "未分类";
}

function contentTypeLabel(asset: ContentAsset): string {
  const sourceType = asset.source_content_type?.toLowerCase() ?? "";
  const filename = asset.source_filename?.toLowerCase() ?? "";
  const text = `${asset.content_type} ${sourceType} ${filename}`.toLowerCase();
  if (/pdf/.test(text)) return "PDF";
  if (/spreadsheet|excel|xlsx|xls|csv/.test(text)) return "表格";
  if (/presentation|powerpoint|ppt/.test(text)) return "PPT";
  if (/word|docx|doc/.test(text)) return "文档";
  if (/image|png|jpe?g|webp|gif/.test(text)) return "图片";
  if (/video|mp4|mov|webm/.test(text)) return "视频";
  if (/audio|mp3|wav|m4a/.test(text)) return "音频";
  if (/url|web|html|markdown|reader/.test(text)) return "网页";
  return "资料";
}

// Store refs (local://, supabase://, s3://) are only readable through the
// backend's unauthenticated media proxy; browsers can't open them directly.
export function mediaProxyUrl(ref: string): string {
  return `${API_BASE}/v1/video/media?ref=${encodeURIComponent(ref)}`;
}

function browserReadableAssetRef(value: unknown): string | undefined {
  const ref = stringValue(value);
  if (!ref) return undefined;
  if (/^(?:https?:\/\/|data:|blob:)/i.test(ref)) return ref;
  return mediaProxyUrl(ref);
}

function previewUrlForAsset(asset: ContentAsset): string | undefined {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  if (metadata.media_availability === "missing") return undefined;
  const videoProject = metadata.video_project && typeof metadata.video_project === "object" && !Array.isArray(metadata.video_project)
    ? metadata.video_project as Record<string, unknown>
    : null;
  const mp4Ref = typeof videoProject?.mp4_ref === "string" ? videoProject.mp4_ref.trim() : "";
  if (mp4Ref) return mediaProxyUrl(mp4Ref);
  const candidates = [
    metadata.preview_url,
    metadata.thumbnail_url,
    metadata.download_url,
    metadata.source_url,
    asset.original_ref
  ];
  return candidates
    .map(browserReadableAssetRef)
    .find((item): item is string => Boolean(item));
}

function thumbnailUrlForAsset(asset: ContentAsset): string | undefined {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {};
  if (metadata.media_availability === "missing") return undefined;
  const thumbnailRef = typeof metadata.thumbnail_ref === "string" ? metadata.thumbnail_ref.trim() : "";
  if (thumbnailRef) return mediaProxyUrl(thumbnailRef);
  return [metadata.thumbnail_url, metadata.poster_url]
    .map(browserReadableAssetRef)
    .find((item): item is string => Boolean(item));
}

function statusLabel(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "ready") return "已入库";
  if (normalized === "processing") return "解析中";
  if (normalized === "failed") return "解析失败";
  if (normalized === "draft") return "待解析";
  if (normalized === "archived") return "已归档";
  return status;
}

function videoProjectStatusLabel(asset: ContentAsset): string | null {
  if (asset.content_type === "video_script" || asset.content_type === "short_video_narration") {
    return asset.status === "failed" ? "失败" : "完成";
  }
  if (asset.content_type === "video_project") {
    if (asset.product_status === "completed") return "完成";
    if (asset.product_status === "failed") return "失败";
    return "生成中";
  }
  return null;
}

function artifactCategory(asset: ContentAsset): string {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as Record<string, unknown> : {};
  if (typeof metadata.artifact_category === "string" && metadata.artifact_category.trim()) return metadata.artifact_category.trim();
  if (asset.content_type === "content_plan") return "选题方案";
  if (asset.content_type === "short_video_narration" || asset.content_type === "video_script") return "编导稿";
  if (asset.content_type === "social_post") return "文案稿";
  if (asset.content_type === "cover_image") return "封面图";
  if (asset.content_type === "storyboard_image") return "分镜图";
  if (["uploaded_image", "saved_image", "document_embedded_image"].includes(asset.content_type)) return "素材图";
  if (asset.content_type === "video_project") return "视频工程";
  return "";
}

function inferLibraryCategory(asset: ContentAsset): string {
  const explicit = artifactCategory(asset);
  if (explicit) return explicit;
  if (asset.asset_kind === "asset") return inferAssetSourceCategory(asset);
  return "未分类";
}

export function libraryCategoryForAsset(asset: ContentAsset): string {
  return inferLibraryCategory(asset);
}

function searchReasonLabels(fields: string[]): string[] {
  const labels: Record<string, string> = {
    title: "标题命中",
    body: "正文命中",
    source_filename: "来源命中",
    metadata: "元数据命中",
    chunks: "正文命中",
    semantic_chunks: "语义相关"
  };
  return fields.map((field) => labels[field] ?? field).filter((label, index, array) => array.indexOf(label) === index);
}

function contentAssetToLibraryRow(asset: ContentAsset, searchReasons: string[] = []): LibraryRow {
  const category = inferLibraryCategory(asset);
  const understanding = understandingForAsset(asset);
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as Record<string, unknown> : {};
  const noAssetHit = Boolean(metadata.no_asset_hit);
  const mediaUnavailable = metadata.media_availability === "missing";
  const status = category === "编导稿"
    ? (videoProjectStatusLabel(asset) ?? (noAssetHit ? "未命中素材" : "有来源"))
    : (videoProjectStatusLabel(asset)
      ?? (mediaUnavailable
        ? "原文件不可用"
        : ((asset.asset_kind === "image" || asset.asset_kind === "video")
        ? understandingStatusLabel(understanding?.status) ?? statusLabel(asset.status)
        : statusLabel(asset.status))));
  const sourceUrl = typeof asset.metadata?.source_url === "string" ? asset.metadata.source_url : undefined;
  const understandingCaption = understanding?.caption;
  const licenseLabel = typeof asset.metadata?.license_label === "string" ? asset.metadata.license_label : undefined;
  return {
    assetId: asset.id,
    title: normalizeAssetTitle(asset.title),
    meta: asset.asset_kind === "asset" ? `${contentTypeLabel(asset)} · ${status}` : `${category} · ${status}`,
    note: understandingCaption || (asset.body ?? "").replace(/\s+/g, " ").trim().slice(0, 120) || "（无摘要）",
    kind: libraryRowKind(asset),
    category,
    keywords: libraryKeywordsForAsset(asset),
    body: (asset.body ?? "").split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).slice(0, 4),
    contentType: contentTypeLabel(asset),
    contentTypeCode: asset.content_type,
    statusLabel: status,
    updatedLabel: asset.updated_at ? relativeTimeLabel(asset.updated_at) : undefined,
    updatedAtIso: asset.updated_at || undefined,
    referenceCount: typeof metadata.reference_count === "number" && Number.isFinite(metadata.reference_count) && metadata.reference_count >= 0
      ? metadata.reference_count
      : undefined,
    sourceLabel: asset.source_filename ?? sourceUrl ?? asset.original_ref ?? asset.markdown_ref ?? "对话或系统沉淀",
    sourceUrl,
    previewUrl: previewUrlForAsset(asset),
    thumbnailUrl: thumbnailUrlForAsset(asset),
    mediaAvailability: mediaUnavailable ? "missing" : "available",
    sourceRefs: (asset.source_mapping ?? [])
      .filter((item) => item && typeof item === "object")
      .map((item) => {
        const record = item as Record<string, unknown>;
        return [record.title, record.source_type, record.asset_id ?? record.state ?? record.url].filter(Boolean).join(" · ");
      })
      .filter(Boolean)
      .slice(0, 5),
    versions: (asset.versions ?? []).map((version) => `v${version.version}${version.instruction ? ` · ${version.instruction}` : ""}`).slice(-5),
    searchReasons,
    understandingStatus: understanding?.status,
    understandingTags: understanding?.tags ?? [],
    understandingCaption: understanding?.caption,
    understandingRoles: understanding?.roles.map((item) => item.label) ?? [],
    licenseLabel,
    productStatus: asset.product_status,
    variant: libraryVariantForAsset(asset)
  };
}

function libraryKindParam(view: Exclude<AssetWorkspaceView, "conversation">): string {
  return view === "assets" ? "assets" : view;
}

function mergeSearchResults(keywordRows: ContentAssetSearchResult[], semanticRows: ContentAssetSearchResult[]): LibraryRow[] {
  const merged = new Map<number, { asset: ContentAsset; reasons: string[]; score: number; order: number }>();
  let order = 0;
  for (const row of keywordRows) {
    merged.set(row.asset.id, {
      asset: row.asset,
      reasons: searchReasonLabels(row.matched_fields ?? []),
      score: row.score + 10,
      order
    });
    order += 1;
  }
  for (const row of semanticRows) {
    const existing = merged.get(row.asset.id);
    const reasons = searchReasonLabels(row.matched_fields?.length ? row.matched_fields : ["semantic_chunks"]);
    if (existing) {
      existing.reasons = [...existing.reasons, ...reasons].filter((label, index, array) => array.indexOf(label) === index);
      existing.score = Math.max(existing.score, row.score);
      continue;
    }
    merged.set(row.asset.id, {
      asset: row.asset,
      reasons,
      score: row.score,
      order
    });
    order += 1;
  }
  return [...merged.values()]
    .sort((left, right) => (right.score - left.score) || (left.order - right.order))
    .map((item) => contentAssetToLibraryRow(item.asset, item.reasons));
}

// Every selectable local/public row is scoped and signed by the server.
export type SegmentMaterialSelection = { candidateId: string };

function mapSegmentCandidate(row: SegmentMaterialCandidateResponse): SegmentMaterialOption {
  const candidateId = stringValue(row.candidate_id) || undefined;
  const assetId = typeof row.source_asset_id === "number" ? row.source_asset_id : undefined;
  const mediaType = row.media_type === "video" ? "video" : row.media_type === "image" ? "image" : undefined;
  return {
    // Current/non-selectable rows can omit a candidate id.
    id: candidateId ?? (assetId != null ? String(assetId) : `material-${row.provider_item_id || row.title}`),
    title: stringValue(row.title) || "素材",
    thumbnailUrl: materialPreviewUrl(row.preview_url),
    reason: stringValue(row.relevance_reason) || undefined,
    candidateId,
    assetId,
    sourceType: row.source_type,
    mediaType,
    provider: stringValue(row.provider) || undefined,
    author: stringValue(row.author) || undefined,
    license: stringValue(row.license) || undefined,
    attributionUrl: stringValue(row.attribution_url) || undefined,
    durationSeconds: typeof row.duration === "number" && row.duration > 0 ? row.duration : undefined,
    width: typeof row.width === "number" && row.width > 0 ? row.width : undefined,
    height: typeof row.height === "number" && row.height > 0 ? row.height : undefined,
    requiresTrim: Boolean(row.requires_trim),
    verificationStatus: stringValue(row.verification_status) || undefined,
    relevanceStatus: stringValue(row.relevance_status) || undefined,
    relevanceReason: stringValue(row.relevance_reason) || undefined,
    alreadyPersisted: Boolean(row.already_persisted),
    selectable: row.selectable !== false,
  };
}

function createAssetWorkspaceAdapter(data: AssetWorkspaceData): AssetWorkspaceAdapter {
  return {
    listConversations() {
      return data.conversations;
    },
    getNewConversation() {
      return data.newConversation;
    },
    getWorkshop(view) {
      return data.workshops[view];
    },
    getProductText(product) {
      return (product.body && product.body.length > 0 ? product.body : [product.summary]).join("\n\n");
    },
    async saveProduct(product, token) {
      if (isApiConfigured && token && product.backendAssetId) {
        await api<unknown>(`/assets/${product.backendAssetId}`, token, {
          method: "PATCH",
          body: JSON.stringify({
            title: product.title,
            body: product.body?.join("\n\n") ?? product.summary,
          })
        });
        const nextVersion = product.version ? `v${parseInt(product.version.replace("v", "")) + 1}` : "v2";
        return { version: nextVersion, savedAt: new Date().toISOString() };
      }
      throw new Error("未连接后端，无法保存产物。");
    },
    async saveTextEdit({ token, product, body, acceptStructuralChange }) {
      if (!product.backendAssetId || !product.contentHash) {
        throw new Error("当前产物缺少可校验的编辑版本，请刷新后重试。");
      }
      const response = await fetch(`${API_BASE}/v1/assets/${product.backendAssetId}/text-edits`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          body,
          base_content_hash: product.contentHash,
          accept_structural_change: acceptStructuralChange,
        }),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const detail = isRecord(payload.detail) ? payload.detail : {};
      if (response.status === 409 && stringValue(detail.code) === "structural_change_confirmation_required") {
        return {
          kind: "structural_change",
          message: stringValue(detail.message) || "检测到关键结构变化，原版本尚未被覆盖。",
          changes: isRecord(detail.changes) ? detail.changes : {},
        };
      }
      if (!response.ok) {
        throw new Error(
          stringValue(detail.message)
          || (stringValue(detail.code) === "edit_version_conflict" ? "产物已更新，请刷新后再编辑。" : "保存失败，请返回编辑后重试。"),
        );
      }
      return { kind: "saved", product: contentAssetToProduct(payload as unknown as ContentAsset) };
    },
    isBackendEnabled() {
      return isApiConfigured;
    },
    async loadConversationSummaries(token) {
      return api<AssetConversationSummaryResponse[]>("/assets/conversations/summaries", token);
    },
    mergeConversationSummaries(summaries, current) {
      const currentById = new Map(current.map((conversation) => [conversation.id, conversation]));
      return summaries.map((summary) => {
        const existing = currentById.get(summary.id);
        if (existing?.detailsLoaded === true) {
          return {
            ...existing,
            title: summary.title,
            status: summary.status,
            updatedAt: relativeTimeLabel(summary.updated_at),
          };
        }
        return conversationFromSummary(summary, data.newConversation.product);
      });
    },
    async loadConversationDetail(token, conversationId) {
      const row = await retryConversationDetailLoad(
        () => api<AssetConversationResponse>(
          `/assets/conversations/${encodeURIComponent(conversationId)}`,
          token,
        ),
      );
      return {
        ...conversationFromPersisted(row, data.newConversation.product),
        detailsLoaded: true,
      };
    },
    async loadConversationSnapshot(token, conversationId) {
      const row = await api<AssetConversationResponse>(
        `/assets/conversations/${encodeURIComponent(conversationId)}/snapshot`,
        token,
      );
      return {
        ...conversationFromPersisted(row, data.newConversation.product),
        detailsLoaded: false,
      };
    },
    async loadConversations(token, current) {
      const rows = await api<AssetConversationResponse[]>("/assets/conversations", token);
      return mergePersistedConversations(rows, current, data.newConversation.product).map((conversation) => ({
        ...conversation,
        detailsLoaded: true,
      }));
    },
    async deleteConversation(token, conversationId) {
      await api<void>(`/assets/conversations/${encodeURIComponent(conversationId)}`, token, {
        method: "DELETE"
      });
    },
    async renameConversation(token, conversationId, title) {
      await api<AssetConversationResponse>(`/assets/conversations/${encodeURIComponent(conversationId)}`, token, {
        method: "PATCH",
        body: JSON.stringify({ title })
      });
    },
    async createMaterialPackage(token, payload) {
      return api<ContentAsset>("/assets/material-packages", token, {
        method: "POST",
        body: JSON.stringify({
          title: payload.title,
          asset_ids: payload.assetIds,
          metadata: payload.metadata ?? {}
        })
      });
    },
    async sendMessage({
      token,
      conversationId,
      instruction,
      selectedProductId,
      linkedAssetIds,
      clientRequestId,
      videoParameterConfirmation,
      agentConfirmationId,
      longFormAction,
      videoSceneReplacement,
      presenterDirectionConfirmation,
      presenterDirectionRequest,
      presenterCleanupConfirmation,
      presenterAudioSelectionConfirmation,
      sourceSubtitleMode,
      signal,
    }) {
      if (videoParameterConfirmation || videoSceneReplacement || presenterDirectionConfirmation || presenterDirectionRequest || presenterCleanupConfirmation || presenterAudioSelectionConfirmation) {
        assertVideoWritesAvailable();
      }
      const response = await api<AssetConversationMessageResponse>("/assets/conversations/messages", token, {
        method: "POST",
        signal,
        headers: {
          ...(clientRequestId ? { "X-Request-ID": clientRequestId } : {}),
          ...buildVideoParameterConfirmationHeaders(videoParameterConfirmation),
        },
        body: JSON.stringify(buildConversationMessagePayload({
          conversationId,
          instruction,
          selectedProductId,
          linkedAssetIds,
          clientRequestId,
          videoParameterConfirmation,
          agentConfirmationId,
          longFormAction,
          videoSceneReplacement,
          presenterDirectionConfirmation,
          presenterDirectionRequest,
          presenterCleanupConfirmation,
          presenterAudioSelectionConfirmation,
          sourceSubtitleMode,
        }))
      });
      const generatedProduct = response.product ? contentAssetToProduct(response.product) : undefined;
      const conversation = {
        ...conversationFromPersisted(response.conversation, data.newConversation.product, generatedProduct),
        // The message endpoint returns the complete conversation.  Preserve
        // that fact so a concurrent lightweight snapshot cannot temporarily
        // turn the active composer into a read-only loading state.
        detailsLoaded: true,
      };
      const product = generatedProduct ?? null;
      return {
        conversationId: response.conversation_id,
        conversation,
        product,
        generationJob: response.generation_job ?? null,
        agentAction: response.agent_action
          ? mapAgentAction(response.agent_action)
          : null,
      };
    },
    async reconcileMessage({ token, clientRequestId }) {
      const rows = await api<AssetConversationResponse[]>("/assets/conversations", token);
      const row = findConversationByClientRequestId(rows, clientRequestId);
      if (!row) return null;
      const matchedMessage = row.messages.find(
        (message) => stringValue(message.metadata?.client_request_id) === clientRequestId && message.asset_id,
      );
      const generationMessage = row.messages.find(
        (message) => stringValue(message.metadata?.client_request_id) === clientRequestId
          && stringValue(message.metadata?.asset_generation_job_id),
      );
      const generationJobId = stringValue(generationMessage?.metadata?.asset_generation_job_id);
      const generationJob = generationJobId
        ? await getAssetGenerationJob(token, generationJobId)
        : null;
      const conversation = conversationFromPersisted(row, data.newConversation.product);
      const rawActionMessage = row.messages.find(
        (message) => stringValue(message.metadata?.client_request_id) === clientRequestId
          && stringValue(message.metadata?.agent_action_run_id),
      );
      const actionRunId = stringValue(rawActionMessage?.metadata?.agent_action_run_id);
      const mappedActionMessage = conversation.messages?.find(
        (message) => stringValue(message.metadata?.client_request_id) === clientRequestId
          && message.agentAction,
      );
      const agentAction = actionRunId
        ? mapAgentAction(await getConversationAgentAction(token, row.id, actionRunId))
        : mappedActionMessage?.agentAction ?? null;
      const matchedAsset = matchedMessage?.asset_id
        ? row.products.find((asset) => asset.id === matchedMessage.asset_id)
        : agentAction?.assetId
          ? row.products.find((asset) => asset.id === agentAction.assetId)
        : row.products[row.products.length - 1];
      const generatedProduct = matchedAsset ? contentAssetToProduct(matchedAsset) : undefined;
      const mappedConversation = conversationFromPersisted(
        row,
        data.newConversation.product,
        generatedProduct,
      );
      return {
        conversationId: row.id,
        conversation: mappedConversation,
        product: generatedProduct ?? null,
        generationJob,
        agentAction,
      };
    },
    getGenerationJob(token, jobId, signal) {
      return getAssetGenerationJob(token, jobId, signal);
    },
    retryGenerationJob(token, jobId) {
      return retryAssetGenerationJob(token, jobId);
    },
    cancelGenerationJob(token, jobId) {
      return cancelAssetGenerationJob(token, jobId);
    },
    async getAgentAction(token, conversationId, actionRunId, signal) {
      return mapAgentAction(await getConversationAgentAction(
        token,
        conversationId,
        actionRunId,
        signal,
      ));
    },
    async retryAgentAction(token, conversationId, actionRunId) {
      return mapAgentAction(await retryConversationAgentAction(
        token,
        conversationId,
        actionRunId,
      ));
    },
    async restoreProductVersion({ token, product, versionId }) {
      if (!isApiConfigured || !token || !product.backendAssetId) {
        throw new Error("未连接后端，无法恢复版本。");
      }
      const response = await api<ContentAssetRevisionResponse>(`/assets/${product.backendAssetId}/versions/${encodeURIComponent(versionId)}/restore`, token, {
          method: "POST"
        });
      return {
          product: contentAssetToProduct(response.asset),
          assistantMessage: response.assistant_message,
          diffSummary: response.diff_summary
      };
    },
    async getVideoJob(token, jobId) {
      const raw = await getVideoProjectJob({ token, jobId });
      return mapVideoJob(raw);
    },
    async retryVideoJob(token, jobId) {
      assertVideoWritesAvailable();
      const raw = await api<RawVideoJob>(`/video/jobs/${encodeURIComponent(jobId)}/retry`, token, {
        method: "POST",
      });
      return mapVideoJob(raw);
    },
    async getVideoQuality(token, projectAssetId) {
      return api<VideoQualityReport>(
        `/video/projects/${encodeURIComponent(projectAssetId)}/quality?stage=export_preflight`,
        token,
      );
    },
    async getSourceExcerptAudit(token, projectAssetId) {
      return mapSourceExcerptAudit(await api<RawSourceExcerptAudit>(
        `/video/projects/${encodeURIComponent(projectAssetId)}/source-excerpt-audit`,
        token,
      ));
    },
    async getCurrentVideoExport(token, projectAssetId, signal) {
      return getCurrentExportJob({
        apiBase: API_BASE,
        assetId: String(projectAssetId),
        token,
        signal,
      });
    },
    async retryVideoExport(token, projectAssetId, job, signal) {
      return retryExportJob({
        apiBase: API_BASE,
        assetId: String(projectAssetId),
        jobId: job.id,
        token,
        signal,
      });
    },
    async waitForVideoExport(token, projectAssetId, initialJob, signal) {
      return waitForExportJob({
        apiBase: API_BASE,
        assetId: String(projectAssetId),
        token,
        initialJob,
        signal,
      });
    },
    async loadSegmentMaterialCandidates(token, projectAssetId, segmentId, scope, cursor, limit) {
      const data = await getSegmentMaterialCandidates({
        token,
        projectAssetId,
        segmentId,
        scope,
        cursor,
        limit,
      });
      const groups = data.groups ?? { current: [], recommended: [], library: [], public: [] };
      return {
        current: (groups.current ?? []).map(mapSegmentCandidate),
        recommended: (groups.recommended ?? []).map(mapSegmentCandidate),
        library: (groups.library ?? []).map(mapSegmentCandidate),
        public: (groups.public ?? []).map(mapSegmentCandidate),
        providerStatuses: (data.provider_statuses ?? []).map((item) => ({
          provider: stringValue(item.provider),
          status: stringValue(item.status),
        })),
        publicNextCursor: data.next_cursor ?? null,
      };
    },
    async replaceSegmentMaterial(token, projectAssetId, segmentId, selection, confirmOverwrite = false) {
      assertVideoWritesAvailable();
      const result = await recomposeSegmentMaterial({
        token,
        projectAssetId,
        segmentId,
        candidateId: selection.candidateId,
        confirmOverwrite,
      });
      if (result.kind === "confirm_overwrite") return result;
      return { kind: "started" as const, job: mapVideoJob(result.job) };
    },
    async listLibrary(token, view, query, options = {}) {
      const kinds = libraryKindsForView(view);
      const trimmedQuery = query?.trim() ?? "";
      const offset = Math.max(0, Math.floor(options.offset ?? 0));
      const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 48)));
      if (trimmedQuery) {
        const params = new URLSearchParams({ q: trimmedQuery, library_kind: libraryKindParam(view), limit: "50" });
        const [keywordResult, semanticResult] = await Promise.allSettled([
          api<ContentAssetSearchResult[]>(`/assets/search?${params.toString()}`, token, { signal: options.signal }),
          api<ContentAssetSearchResult[]>(`/assets/semantic-search?${params.toString()}`, token, { signal: options.signal })
        ]);
        const keywordRows = keywordResult.status === "fulfilled" ? keywordResult.value : [];
        const semanticRows = semanticResult.status === "fulfilled" ? semanticResult.value : [];
        const mergedRows = mergeSearchResults(keywordRows, semanticRows)
          .filter((row) => row.assetId == null || kinds.includes(row.kind === "file" ? "asset" : row.kind));
        if (mergedRows.length || keywordResult.status === "fulfilled" || semanticResult.status === "fulfilled") {
          return { rows: mergedRows, nextOffset: null };
        }
      }
      const params = new URLSearchParams({
        library_kind: libraryKindParam(view),
        limit: String(limit + 1),
        offset: String(offset),
      });
      const assets = await api<ContentAsset[]>(`/assets?${params.toString()}`, token, { signal: options.signal });
      const hasMore = assets.length > limit;
      const rows = assets
        .slice(0, limit)
        .map((asset) => contentAssetToLibraryRow(asset))
        .sort((a, b) => (b.updatedAtIso ?? "").localeCompare(a.updatedAtIso ?? ""));
      return {
        rows,
        nextOffset: hasMore ? offset + limit : null,
      };
    },
    async uploadAsset(token, file, view, onProgress, idempotencyKey) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("target_kind", view === "assets" ? "asset" : view);
      if (onProgress) return uploadAssetWithProgress<ContentAsset>("/assets/upload", token, formData, onProgress, idempotencyKey);
      return apiForm<ContentAsset>("/assets/upload", token, formData);
    },
    async getLatestAssetIngestJob(token, assetId) {
      return api<AssetIngestJobRead>(`/assets/${assetId}/ingest-jobs/latest`, token);
    },
    async createWebCapture(token, payload) {
      return api<ContentAsset>("/assets/web-captures", token, {
        method: "POST",
        body: JSON.stringify({
          url: payload.url,
          title: payload.title,
          body: payload.body,
          content_type: payload.contentType ?? "text/html"
        })
      });
    },
    async retryAssetIngest(token, assetId) {
      const latest = await api<AssetIngestJobRead>(`/assets/${assetId}/ingest-jobs/latest`, token);
      await api<AssetIngestJobActionRead>(`/assets/ingest-jobs/${encodeURIComponent(latest.id)}/retry`, token, { method: "POST" });
      return api<AssetIngestJobActionRead>(`/assets/ingest-jobs/${encodeURIComponent(latest.id)}/process`, token, { method: "POST" });
    },
    async exportAssetMarkdown(token, assetId) {
      return apiBlob(`/assets/${assetId}/export.md`, token);
    },
    async downloadAsset(token, assetId) {
      return apiBlob(`/assets/${assetId}/download`, token);
    },
    async deleteAsset(token, assetId) {
      await api<void>(`/assets/${assetId}`, token, { method: "DELETE" });
    },
    async reparseAsset(token, assetId) {
      return api<ContentAsset>(`/assets/${assetId}/reparse`, token, { method: "POST" });
    },
    async listPublicSources(token, mediaType) {
      const query = mediaType ? `?media_type=${encodeURIComponent(mediaType)}` : "";
      return api<PublicSourceRead[]>(`/assets/public-sources${query}`, token);
    },
    async searchPublicMaterials(token, payload) {
      const response = await api<{ query: string; candidates: PublicMaterialCandidate[] }>("/assets/public-search", token, {
        method: "POST",
        body: JSON.stringify({
          query: payload.query,
          media_types: payload.mediaTypes,
          providers: payload.providers,
          limit: payload.limit ?? 12
        })
      });
      return response.candidates;
    },
    async importPublicMaterial(token, candidate) {
      return api<ContentAsset>("/assets/public-import", token, {
        method: "POST",
        body: JSON.stringify({ candidate })
      });
    },
    async listAdminPublicSources(token) {
      return api<PublicSourceRead[]>("/admin/public-sources", token);
    },
    async updateAdminPublicSource(token, provider, payload) {
      return api<PublicSourceRead>(`/admin/public-sources/${encodeURIComponent(provider)}`, token, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
    },
    async checkAdminPublicSourceHealth(token, provider) {
      return api<PublicSourceRead>(`/admin/public-sources/${encodeURIComponent(provider)}/health`, token, { method: "POST" });
    }
  };
}

export const assetWorkspaceAdapter = createAssetWorkspaceAdapter(emptyAssetWorkspaceData);
