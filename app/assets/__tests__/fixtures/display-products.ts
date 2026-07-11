import type { AssetConversation, AssetProduct } from "../../lib/asset-workspace-types";


export const falseReadyProduct: AssetProduct = {
  id: "display-false-ready",
  backendAssetId: 9001,
  videoProjectReady: false,
  mode: "video",
  title: "假完成视频工程",
  status: "工程异常 · 待恢复",
  summary: "工程仍在生成，不能进入编辑器。",
  ratio: "9:16",
  duration: "9秒",
  phase: "视频工程",
  sections: [],
  timeline: [],
  actions: [],
  metadata: {
    orchestration_pending: true,
    video_workflow_stage: "video_project_building",
    video_project: {
      tracks: [],
      media: [],
    },
  },
  preview: {
    title: "假完成视频工程",
    subtitle: "工程状态不完整，已停止进入编辑器并等待恢复。",
  },
};


export const falseReadyConversation: AssetConversation = {
  id: "display-false-ready-conversation",
  title: "假完成视频工程",
  type: "视频",
  updatedAt: "刚刚",
  assetLabel: "测试素材",
  status: "工程异常",
  prompt: "打开假完成视频工程",
  response: "工程仍在恢复。",
  canvasTitle: "假完成视频工程",
  canvasMeta: "9:16",
  raw: "",
  judgment: "",
  action: "",
  delivery: "",
  suggestions: [],
  product: falseReadyProduct,
  products: [falseReadyProduct],
};

export const DISPLAY_CASE_IDS = [
  "case-01-director-draft",
  "case-02-saved-asset-match",
  "case-03-no-asset-hit",
  "case-04-project-running",
  "case-05-project-failed",
  "case-06-project-ready-no-mp4",
  "case-07-project-ready-mp4",
  "case-08-mg-failed-project-ready",
] as const;

export type DisplayCaseId = (typeof DISPLAY_CASE_IDS)[number];

const baseProduct: AssetProduct = {
  id: "display-base",
  backendAssetId: 9100,
  mode: "video",
  title: "门店获客短视频",
  status: "编导稿已生成",
  summary: "三段式门店获客短视频。",
  ratio: "9:16",
  duration: "9秒",
  phase: "编导稿",
  sections: [],
  timeline: [
    { time: "00:00", title: "门店外观", status: "已规划" },
    { time: "00:03", title: "服务过程", status: "已规划" },
  ],
  actions: [],
  preview: { title: "门店获客短视频", subtitle: "测试案例" },
};

const basePlan = {
  duration_seconds: 9,
  audience: "本地潜在客户",
  style: "真实可信",
  summary: {
    topic: "门店获客短视频",
    scene_count: 2,
    material_hit_count: 0,
    public_material_fill_count: 0,
    material_gap_count: 0,
    mg_needed_count: 0,
    mg_failed_count: 0,
  },
  scenes: [],
};

const readySegments = [
  { id: "segment-1", index: 1, title: "门店外观", startSeconds: 0, endSeconds: 1.5, assetTitle: "测试门店素材", isFallback: false },
  { id: "segment-2", index: 2, title: "服务过程", startSeconds: 1.5, endSeconds: 3, assetTitle: "服务过程素材", isFallback: false },
];

const readyProject = {
  tracks: [{ id: "main", type: "video", clips: [] }],
  media: [{ id: "media-1", type: "image", ref: "display-sample.png" }],
};

export const displayProducts: Record<DisplayCaseId, AssetProduct> = {
  "case-01-director-draft": {
    ...baseProduct,
    id: "case-01-director-draft",
    metadata: { video_workflow_stage: "director_script_draft", video_plan: basePlan },
  },
  "case-02-saved-asset-match": {
    ...baseProduct,
    id: "case-02-saved-asset-match",
    metadata: {
      video_plan: {
        ...basePlan,
        summary: { ...basePlan.summary, material_hit_count: 1 },
        scenes: [{
          id: "scene-saved",
          title: "门店外观",
          asset_reference: {
            status: "matched",
            chosen_asset_id: 9000,
            source_snapshot: { title: "测试门店素材", thumbnail_url: "/display-sample.png" },
          },
        }],
      },
    },
  },
  "case-03-no-asset-hit": {
    ...baseProduct,
    id: "case-03-no-asset-hit",
    metadata: {
      material_gap_notice: "未命中素材，已使用公共素材自动补充。",
      video_plan: {
        ...basePlan,
        summary: { ...basePlan.summary, public_material_fill_count: 1, material_gap_count: 1 },
        scenes: [{ id: "scene-gap", title: "服务过程", asset_reference: { status: "no_asset_hit" } }],
      },
    },
  },
  "case-04-project-running": {
    ...baseProduct,
    id: "case-04-project-running",
    status: "正在生成",
    phase: "视频工程生成中",
    metadata: { orchestration_pending: true, video_workflow_stage: "material_search", latest_job_public_id: "job-running" },
  },
  "case-05-project-failed": {
    ...baseProduct,
    id: "case-05-project-failed",
    status: "生成失败 · 可重试",
    phase: "失败",
    metadata: { latest_job_public_id: "job-failed", error_message: "素材合成步骤失败，请重试。" },
  },
  "case-06-project-ready-no-mp4": {
    ...baseProduct,
    id: "case-06-project-ready-no-mp4",
    status: "已生成",
    phase: "视频工程",
    videoProjectReady: true,
    segments: readySegments,
    metadata: { orchestration_pending: false, video_project: readyProject, video_plan: basePlan },
  },
  "case-07-project-ready-mp4": {
    ...baseProduct,
    id: "case-07-project-ready-mp4",
    status: "已生成",
    phase: "视频工程",
    videoProjectReady: true,
    segments: readySegments,
    metadata: { orchestration_pending: false, video_project: { ...readyProject, mp4_ref: "display-sample.mp4" }, video_plan: basePlan },
  },
  "case-08-mg-failed-project-ready": {
    ...baseProduct,
    id: "case-08-mg-failed-project-ready",
    status: "已生成",
    phase: "视频工程",
    videoProjectReady: true,
    segments: [
      { ...readySegments[0], mgLabel: "数字强调", mgStatus: "failed", subLine: "MG 渲染失败，原分镜仍保留" },
      readySegments[1],
    ],
    metadata: {
      orchestration_pending: false,
      video_project: readyProject,
      video_plan: { ...basePlan, summary: { ...basePlan.summary, mg_needed_count: 1, mg_failed_count: 1 } },
    },
  },
};

export function conversationForDisplayProduct(product: AssetProduct): AssetConversation {
  return {
    ...falseReadyConversation,
    id: `${product.id}-conversation`,
    title: product.title,
    status: product.status,
    product,
    products: [product],
  };
}
