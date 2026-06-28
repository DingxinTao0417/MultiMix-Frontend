// Maps backend ContentAsset / AssetConversationResponse shapes into the
// frontend AssetProduct / AssetConversation contract. Ported from ChangeIn
// frontend assets-workspace-client.tsx helpers.

import type { AssetConversation, AssetProduct, AssetProductMode } from "../app/assets/lib/asset-workspace-types";
import type { AssetConversationResponse, ContentAsset } from "./api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stringListValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map((item) => String(item).trim()).filter(Boolean);
  return items.length ? items : undefined;
}

function relativeTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "刚刚";
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 60_000) return "刚刚";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}分钟前`;
  if (diffMs < 86_400_000) return "今天";
  return date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
}

function markdownToParagraphs(markdown: string): string[] {
  return markdown
    .split(/\n{2,}/)
    .map((item) => item.replace(/^#{1,6}\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 24);
}

function firstMeaningfulLine(markdown: string): string | undefined {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .find((line) => line && !/^[-*]\s*Source note/i.test(line));
}

function formatTimelineSecond(value: number): string {
  const total = Math.max(0, Math.round(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function timelineFromBody(markdown: string, unsupported: boolean) {
  if (unsupported) return [];
  const matches = Array.from(markdown.matchAll(/(?:^|\n)(?:#{2,4}\s*)?(?:分镜|Scene)\s*([0-9一二三四五六七八九十]+)?[:：]?\s*([^\n]*)/gi));
  return matches.slice(0, 5).map((match, index) => ({
    time: `00:${String(index * 12).padStart(2, "0")}`,
    title: (match[2] || `分镜 ${index + 1}`).trim(),
    status: "草稿"
  }));
}

function timelineFromVideoProject(videoProject: Record<string, unknown> | undefined) {
  const timeline = isRecord(videoProject?.timeline) ? videoProject.timeline : undefined;
  const tracks = Array.isArray(timeline?.tracks) ? timeline.tracks : [];
  const textTrack = tracks.find((track) => isRecord(track) && track.type === "text");
  const elements = isRecord(textTrack) && Array.isArray(textTrack.elements) ? textTrack.elements : [];
  if (!elements.length) {
    const segments = Array.isArray(videoProject?.segments) ? videoProject.segments.filter(isRecord) : [];
    if (!segments.length) return undefined;
    return segments.slice(0, 8).map((segment, index) => ({
      time: formatTimelineSecond(typeof segment.startTime === "number" ? segment.startTime : index * 8),
      title: stringValue(segment.title) || `片段 ${index + 1}`,
      status: stringValue(segment.material_state) || stringValue(segment.voiceover_state) || "待执行",
      line: stringValue(segment.narration) || stringValue(segment.subtitle)
    }));
  }
  return elements.slice(0, 8).filter(isRecord).map((element, index) => {
    const start = typeof element.startTime === "number" ? element.startTime : index * 8;
    return {
      time: formatTimelineSecond(start),
      title: `片段 ${index + 1}`,
      status: "字幕轨道",
      line: stringValue(element.content) || "字幕待生成"
    };
  });
}

function videoProjectStatusLabel(mp4State: string): string {
  if (mp4State === "ready") return "视频工程 · MP4已生成";
  if (mp4State === "running") return "视频工程 · 成片生成中";
  if (mp4State === "failed") return "视频工程 · 成片失败";
  return "视频工程 · 待生成成片";
}

function suggestionsForCapability(capability: string): string[] {
  if (capability.includes("video")) return ["缩短到30秒", "换成9:16", "改成数字人口播", "生成封面提示词"];
  if (capability.includes("image") || capability === "cover_image" || capability === "storyboard_image") return ["换成9:16", "标题更醒目", "减少画面元素"];
  if (capability === "social_post") return ["改得更专业", "缩短到120字", "拆成60秒口播"];
  return ["生成LinkedIn文案", "拆成短视频脚本", "改得更具体"];
}

function assetLabelFromProduct(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  if (metadata.no_asset_hit) return "未命中素材";
  const count = Array.isArray(asset.linked_asset_ids) ? asset.linked_asset_ids.length : 0;
  return count > 0 ? `已关联 ${count} 个素材` : "模型通用知识";
}

export function statusLabelFromProduct(asset: ContentAsset): string {
  const metadata = asset.metadata ?? {};
  if (metadata.video_project) return "视频工程";
  if (metadata.unsupported_adapter) return "准备产物";
  if (metadata.no_asset_hit) return "通用能力生成";
  return "有来源";
}

function contentAssetTypeLabel(contentType: string): string {
  const labels: Record<string, string> = {
    content_plan: "内容方案",
    social_post: "发帖文案",
    short_video_narration: "短视频口播稿",
    video_script: "视频脚本",
    cover_image: "封面图提示词",
    storyboard_image: "分镜图提示词",
    video_render: "成片准备",
    digital_human_video: "数字人视频准备",
    mg_animation_video: "MG动画准备",
    real_scene_video: "实景视频准备",
    generated_video: "生成视频准备",
    image_generation: "图片生成提示词",
    image_edit: "图片编辑提示词"
  };
  return labels[contentType] ?? "内容产物";
}

function productModeFromAsset(asset: ContentAsset, unsupported: boolean): AssetProductMode {
  if (unsupported) return "copy";
  if (asset.content_type === "digital_human_video") return "digital-human";
  if (asset.asset_kind === "image") return "image";
  if (asset.asset_kind === "video" || asset.asset_kind === "video_render") return "video";
  return "copy";
}

export function contentAssetToProduct(asset: ContentAsset): AssetProduct {
  const metadata = asset.metadata ?? {};
  const capability = typeof metadata.capability === "string" ? metadata.capability : asset.content_type;
  const intent = isRecord(metadata.intent) ? metadata.intent : {};
  const videoProject = isRecord(metadata.video_project) ? metadata.video_project : undefined;
  const videoSegments = Array.isArray(videoProject?.segments) ? videoProject.segments.filter(isRecord) : [];
  const stageResults = isRecord(videoProject?.stage_results) ? videoProject.stage_results : undefined;
  const unsupported = (Boolean(metadata.unsupported_adapter) || metadata.generation_state === "preparation_only") && !videoProject;
  const mode = productModeFromAsset(asset, unsupported);
  const body = markdownToParagraphs(asset.body);
  const sourceCount = Array.isArray(asset.linked_asset_ids) ? asset.linked_asset_ids.length : 0;
  const noAssetHit = Boolean(metadata.no_asset_hit);
  const mp4State = stringValue(videoProject?.mp4_state) || "";
  const status = videoProject
    ? videoProjectStatusLabel(mp4State)
    : unsupported
    ? "准备产物 · adapter未配置"
    : noAssetHit
      ? "草稿 · 未命中素材"
      : "草稿 · 有来源";
  const ratio = stringValue(videoProject?.ratio) || stringValue(intent.ratio) || (mode === "copy" ? "Markdown" : "按指令");
  const duration = videoProject?.duration_seconds ? `${videoProject.duration_seconds}秒` : stringValue(intent.duration) || (capability.includes("video") ? "待确认" : `${body.length} 段`);
  const capabilityLabel = stringValue(metadata.capability_label) || contentAssetTypeLabel(asset.content_type);
  const sections = [
    {
      label: "能力",
      title: capabilityLabel,
      detail: videoProject ? "已生成可编辑视频工程；成片需用户确认后导出。" : unsupported ? "当前仅生成准备产物，未创建真实渲染任务。" : "已通过后端 LLM 编排生成草稿。",
      status: videoProject ? "工程已生成" : unsupported ? "未配置adapter" : "已生成"
    },
    {
      label: "来源",
      title: noAssetHit ? "未命中素材" : `${sourceCount} 个素材`,
      detail: noAssetHit ? "该产物使用模型通用知识生成，不能视为素材证据支持。" : "生成 metadata 保留了素材来源映射。",
      status: noAssetHit ? "no-asset-hit" : "已关联"
    },
    {
      label: "参数",
      title: [stringValue(intent.channel), stringValue(intent.style)].filter(Boolean).join(" / ") || "按自然语言指令",
      detail: stringValue(videoProject?.render_error) || asset.error_message || "可继续通过对话调整比例、时长、风格、素材或表达方式。",
      status: mp4State === "failed" ? "成片失败" : "可调整"
    }
  ];
  if (videoProject) {
    sections.splice(1, 0, {
      label: "段落",
      title: videoSegments.length ? `${videoSegments.length} 段 MultiMix 脚本` : "已生成关键轨道",
      detail: "脚本、文案和段落拆分由 MultiMix 对话生成；Modal 从逐段配音和素材匹配开始执行。",
      status: stringValue(videoProject.segments_source) || "segments"
    });
    sections.splice(2, 0, {
      label: "成片",
      title: mp4State === "ready" ? "MP4 已生成" : mp4State === "running" ? "正在生成 MP4" : "等待确认导出",
      detail: mp4State === "failed" ? "工程已保留，可调整后重试生成成片。" : stringValue(videoProject.mp4_ref) || "点击生成成片后，将由 Modal 逐段生成配音、匹配素材、对齐时间线并导出 MP4。",
      status: mp4State || "not_requested"
    });
    if (stageResults) {
      sections.splice(3, 0, {
        label: "Modal",
        title: [
          `配音 ${stringValue(stageResults.voiceover) || "pending"}`,
          `素材 ${stringValue(stageResults.material_match) || "pending"}`,
          `渲染 ${stringValue(stageResults.mp4_render) || "pending"}`
        ].join(" / "),
        detail: "执行阶段会写回 metadata，失败时保留可编辑工程和稳定失败原因。",
        status: stringValue(videoProject.latest_render_stage) || "执行状态"
      });
    }
  }
  return {
    id: `asset-${asset.id}`,
    backendAssetId: asset.id,
    metadata,
    mode,
    title: asset.title,
    status,
    summary: firstMeaningfulLine(asset.body) || asset.title,
    ratio,
    duration,
    phase: capabilityLabel,
    version: asset.versions?.length ? `v${asset.versions.length}` : "v1",
    body,
    sections,
    timeline: timelineFromVideoProject(videoProject) ?? timelineFromBody(asset.body, unsupported),
    actions: suggestionsForCapability(capability),
    sourceIds: asset.linked_asset_ids.map((id) => String(id)),
    preview: {
      title: asset.title,
      subtitle: mp4State === "ready" ? "MP4 已生成，可直接播放" : videoProject ? "视频工程已生成，可查看关键轨道并按需导出 MP4" : unsupported ? "准备产物，未渲染图片或视频" : (noAssetHit ? "通用能力生成，未命中素材" : "后端 LLM 生成草稿"),
      eyebrow: capabilityLabel
    }
  };
}

// Convert a persisted backend conversation row into the frontend Conversation
// shape. A fallbackProduct (newly created) may be passed to keep selection stable.
export function conversationFromPersisted(
  row: AssetConversationResponse,
  newConversationProduct: AssetProduct,
  fallbackProduct?: AssetProduct
): AssetConversation {
  const products = row.products.map(contentAssetToProduct);
  const product = fallbackProduct
    ? products.find((item) => item.id === fallbackProduct.id) ?? fallbackProduct
    : products[products.length - 1] ?? newConversationProduct;
  const messages = row.messages.map((message) => ({
    role: message.role,
    text: message.text,
    assetId: message.asset_id,
    suggestions: message.role === "assistant" ? stringListValue(message.metadata.suggestions) : undefined
  }));
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user")?.text ?? "";
  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === "assistant")?.text ?? "";
  const lastAsset = row.products[row.products.length - 1];
  return {
    id: row.id,
    title: row.title || product.title,
    type: "llm-generation",
    updatedAt: relativeTimeLabel(row.updated_at),
    assetLabel: lastAsset ? assetLabelFromProduct(lastAsset) : "对话历史",
    status: lastAsset ? statusLabelFromProduct(lastAsset) : row.status,
    prompt: lastUserMessage,
    response: lastAssistantMessage,
    canvasTitle: product.title,
    canvasMeta: `${product.status} · ${product.ratio}`,
    raw: fallbackProduct?.body?.join("\n\n") ?? lastAsset?.body ?? "",
    judgment: "",
    action: "",
    delivery: lastAssistantMessage,
    suggestions: products[products.length - 1]?.actions ?? [],
    messages,
    product,
    products: fallbackProduct && !products.some((item) => item.id === fallbackProduct.id) ? [...products, fallbackProduct] : products,
    sourceIds: Array.from(new Set(row.products.flatMap((asset) => asset.linked_asset_ids.map((id) => String(id)))))
  };
}

export function mergePersistedConversations(
  rows: AssetConversationResponse[],
  current: AssetConversation[],
  newConversationProduct: AssetProduct
): AssetConversation[] {
  const persisted = rows.map((row) => conversationFromPersisted(row, newConversationProduct));
  const persistedIds = new Set(persisted.map((conversation) => conversation.id));
  return [
    ...persisted,
    ...current.filter((conversation) => !persistedIds.has(conversation.id) && conversation.id !== "new")
  ];
}
