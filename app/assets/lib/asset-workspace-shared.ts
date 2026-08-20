import type { AssetConversation, AssetProduct, AssetProductMode, AssetWorkspaceView } from "./asset-workspace-types";

// Local aliases keep component signatures short and stable across files.
export type ActiveView = AssetWorkspaceView;
export type ProductMode = AssetProductMode;
export type ProductArtifact = AssetProduct;

export async function runExclusiveConversationDelete(
  inFlightConversationIds: Set<string>,
  conversationId: string,
  operation: () => Promise<void>,
): Promise<boolean> {
  if (inFlightConversationIds.has(conversationId)) return false;
  inFlightConversationIds.add(conversationId);
  try {
    await operation();
    return true;
  } finally {
    inFlightConversationIds.delete(conversationId);
  }
}
export type Conversation = AssetConversation;

// Type guards for untyped JSON payloads (backend metadata, video_project blobs).
// Note: this stringValue does NOT trim; the adapter keeps its own trimming variant.
export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function normalizeAssetTitle(title: string): string {
  let clean = title.replace(/\s+/g, " ").trim().replace(/^[\-—–·｜|]+|[\-—–·｜|]+$/g, "");
  if (!clean) return "MultiMix";
  const suffixPattern = /\s*(?:-|—|–|·|｜|\|)\s*(?:MP4\s*成片(?:\s*v\d+)?|视频工程|编导文稿|编导稿|视频脚本|视频文案草稿|文案草稿|内容草稿|准备稿|草稿)\s*$/i;
  for (let index = 0; index < 4; index += 1) {
    const next = clean.replace(suffixPattern, "").trim().replace(/^[\-—–·｜|]+|[\-—–·｜|]+$/g, "");
    if (next === clean) break;
    clean = next;
  }
  return clean || title;
}

export function getConversationProducts(conversation: Conversation) {
  const products = conversation.products && conversation.products.length > 0 ? conversation.products : [conversation.product];
  return products.filter((product) => !isPlaceholderProduct(product));
}

export function resolveConversationProduct(conversation: Conversation, selectedProductId: string | undefined) {
  const products = getConversationProducts(conversation);
  return products.find((product) => product.id === selectedProductId) ?? products[products.length - 1] ?? null;
}

export function isPlaceholderProduct(product: ProductArtifact | null | undefined) {
  return !product || product.id === "empty-product" || product.status === "等待指令";
}

export function shouldReviseSelectedProduct(
  instruction: string,
  product: { backendAssetId?: number } | null,
): boolean {
  if (!product?.backendAssetId) return false;
  const text = instruction.trim().toLowerCase();
  if (!text) return false;
  if (/(mp4|成片|渲染|导出视频|render|export)/i.test(text)) return false;
  if (/(再做|另外|新增|新建|再生成|另做|add another|new one|create another)/i.test(text)) return false;
  if (/(基于|做成|变成|转成|turn into|make it).*(文案|图片|图|视频|copy|image|video)/i.test(text)) return false;

  const explicitEditAction = /(修改|调整|改成|改为|改得|改写|重写|优化|润色|缩短|压到|扩写|提炼|删掉|删除|替换|换成|保留|shorten|revise|rewrite|edit|change|adjust|optimize)/i;
  if (explicitEditAction.test(text)) return true;

  const readOnlyQuestion = /[?？]|(是什么|说了什么|为什么|怎么安排|如何安排|是不是|有没有|多少|几段|几镜|吗|呢)$/i;
  if (readOnlyQuestion.test(text)) return false;

  return /(短一点|更短|更口语|更专业|构图更|色调更)/i.test(text);
}

export function getProductModeLabel(mode: ProductMode) {
  if (mode === "copy") return "文案";
  if (mode === "image") return "图片";
  if (mode === "audio") return "音频";
  if (mode === "mg-overlay") return "MG 动效";
  return "视频";
}

export function getProductRatioClass(ratio: string) {
  if (ratio.includes("16:9")) return "ratio-landscape";
  if (ratio.includes("9:16")) return "ratio-portrait";
  if (ratio.includes("4:5")) return "ratio-cover";
  return "";
}

// Minimal shape of a chat composer attachment, mirrored from ChatImageAttachment
// in conversation-studio.tsx. Kept local so both composers can share the send
// guard without a component <-> lib import cycle.
export type ChatAttachmentStatus = "uploading" | "processing" | "ready" | "failed";
export type ChatAttachmentFileKind = "image" | "video" | "source";

type AttachmentState = {
  status: ChatAttachmentStatus;
};

type ReconciliationAttachmentState = {
  id: string;
  assetId?: number;
  fileKind?: ChatAttachmentFileKind;
  status: ChatAttachmentStatus;
};

export function pendingAttachmentReconciliationKeys(
  uploadsByConversation: Record<string, ReconciliationAttachmentState[]>,
): Array<{ key: string; conversationId: string; uploadId: string; assetId: number }> {
  return Object.entries(uploadsByConversation).flatMap(([conversationId, uploads]) => uploads.flatMap((upload) => {
    if (upload.status !== "processing" || typeof upload.assetId !== "number") return [];
    return [{
      key: `${conversationId}:${upload.id}:${upload.assetId}`,
      conversationId,
      uploadId: upload.id,
      assetId: upload.assetId,
    }];
  }));
}

export function shouldImmediatelyReconcileAcceptedUpload(
  upload: Pick<ReconciliationAttachmentState, "assetId" | "fileKind" | "status">,
): boolean {
  return upload.status === "processing" && typeof upload.assetId === "number";
}

export function chatAttachmentFileKind(file: Pick<File, "name" | "type">): ChatAttachmentFileKind {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(file.name)) return "video";
  return "source";
}

export function chatAttachmentStatusLabel(attachment: Pick<AttachmentState, "status"> & {
  uploadProgress?: number | null;
  error?: string;
}): string {
  if (attachment.status === "failed") return attachment.error || "上传失败";
  if (attachment.status === "uploading") {
    return typeof attachment.uploadProgress === "number" ? `上传中 ${attachment.uploadProgress}%` : "上传中";
  }
  return "上传完成";
}

// Whether the composer should refuse to send because attachments are not yet
// usable. An upload that failed (e.g. storage timeout) or is still in flight has
// no backend asset id, so sending would drop the material silently and the agent
// would answer as if no source was ever provided. Returns a user-facing reason to
// show, or null when sending is safe.
export function attachmentSendBlockReason(attachments: readonly AttachmentState[]): string | null {
  if (!attachments.length) return null;
  if (attachments.some((attachment) => attachment.status === "failed")) {
    return "有素材上传失败，请点“重试”或移除后再发送。";
  }
  if (attachments.some((attachment) => attachment.status === "uploading" || attachment.status === "processing")) {
    return "资料正在准备，暂不可发送。";
  }
  return null;
}

// Minimal structural shape of a composer keyboard event, so the shared guard
// accepts both React synthetic events and plain projected native events.
export type ComposerEnterKeyEvent = {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean } | null;
};

// Whether a composer textarea keydown should submit: only a plain Enter that is
// not part of an IME composition. During composition the Enter key confirms the
// candidate instead of sending, so it must keep its native behavior untouched.
export function shouldSubmitComposerOnEnter(event: ComposerEnterKeyEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey === true) return false;
  if (event.isComposing === true) return false;
  if (event.nativeEvent?.isComposing === true) return false;
  return true;
}
