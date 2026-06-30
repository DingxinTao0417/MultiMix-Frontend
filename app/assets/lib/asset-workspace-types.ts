export type AssetWorkspaceView = "conversation" | "assets" | "copy" | "image" | "video";

export type AssetProductMode = "copy" | "image" | "video" | "audio" | "digital-human";

export type AssetProductSection = {
  label: string;
  title: string;
  detail: string;
  status: string;
};

export type AssetProductTimelineItem = {
  time: string;
  title: string;
  status: string;
  line?: string;
};

export type AssetProductVersion = {
  id: string;
  label: string;
  savedAt: string;
  status: string;
};

export type AssetProductPreviewFrame = {
  title: string;
  subtitle: string;
  tone?: "neutral" | "blue" | "green" | "dark";
};

export type AssetProductPreview = {
  title: string;
  subtitle: string;
  eyebrow?: string;
  posterText?: string;
  prompt?: string;
  frames?: AssetProductPreviewFrame[];
};

export type AssetSource = {
  id: string;
  title: string;
  kind: "reader-markdown" | "upload" | "copy-product" | "video-product" | "image-product" | "audio-product";
  status: string;
};

export type AssetProduct = {
  id: string;
  mode: AssetProductMode;
  title: string;
  status: string;
  summary: string;
  ratio: string;
  duration: string;
  phase: string;
  version?: string;
  body?: string[];
  // Raw markdown source (backend assets only) for rich rendering; `body` is the
  // paragraph-split plain-text fallback used by mock data.
  markdownBody?: string;
  sections: AssetProductSection[];
  timeline: AssetProductTimelineItem[];
  actions: string[];
  sourceIds?: string[];
  versions?: AssetProductVersion[];
  preview?: AssetProductPreview;
  // Set when this product is backed by a real backend ContentAsset.
  backendAssetId?: number;
  metadata?: Record<string, unknown>;
};

export type AssetConversationMessage = {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];
  // Backend-backed message fields (optional for mock data).
  assetId?: number | null;
  pending?: boolean;
};

export type AssetConversation = {
  id: string;
  // Read-only sample conversations cannot be continued (mock starters).
  readonly?: boolean;
  title: string;
  type: string;
  updatedAt: string;
  assetLabel: string;
  status: string;
  prompt: string;
  response: string;
  canvasTitle: string;
  canvasMeta: string;
  raw: string;
  judgment: string;
  action: string;
  delivery: string;
  suggestions: string[];
  messages?: AssetConversationMessage[];
  product: AssetProduct;
  products?: AssetProduct[];
  sourceIds?: string[];
};

export type AssetWorkshop = {
  kicker: string;
  title: string;
  description: string;
  metrics: Array<{ value: string; label: string; detail: string }>;
  rows: Array<{
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
    statusLabel?: string;
    sourceLabel?: string;
    sourceUrl?: string;
    detailLabel?: string;
    sourceRefs?: string[];
    versions?: string[];
    searchReasons?: string[];
    captionStatus?: string;
    variant?: "digital-human" | "standard";
  }>;
};

export type AssetWorkspaceData = {
  conversations: AssetConversation[];
  newConversation: AssetConversation;
  workshops: Record<Exclude<AssetWorkspaceView, "conversation">, AssetWorkshop>;
  sources: AssetSource[];
};
