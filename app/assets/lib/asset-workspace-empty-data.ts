import type { AssetConversation, AssetProduct, AssetWorkspaceData, AssetWorkshop, AssetWorkspaceView } from "./asset-workspace-types";

const emptyProduct: AssetProduct = {
  id: "empty-product",
  mode: "copy",
  title: "尚未生成内容",
  status: "空状态",
  summary: "",
  ratio: "",
  duration: "",
  phase: "",
  sections: [],
  timeline: [],
  actions: [],
};

const newConversation: AssetConversation = {
  id: "new",
  title: "新建对话",
  type: "对话",
  updatedAt: "",
  assetLabel: "",
  status: "",
  prompt: "",
  response: "",
  canvasTitle: "新建对话",
  canvasMeta: "",
  raw: "",
  judgment: "",
  action: "",
  delivery: "",
  suggestions: [
    "写一条小红书文案",
    "生成 9:16 短视频脚本",
    "做一张封面图",
    "把好评截图变成种草帖",
  ],
  messages: [],
  product: emptyProduct,
  products: [],
};

const TITLES: Record<Exclude<AssetWorkspaceView, "conversation">, string> = {
  assets: "资产库",
  copy: "文案库",
  image: "图片库",
  video: "视频库",
};

function emptyWorkshop(title: string): AssetWorkshop {
  return { kicker: "", title, description: "", metrics: [], rows: [] };
}

export const emptyAssetWorkspaceData: AssetWorkspaceData = {
  conversations: [],
  newConversation,
  workshops: {
    assets: emptyWorkshop(TITLES.assets),
    copy: emptyWorkshop(TITLES.copy),
    image: emptyWorkshop(TITLES.image),
    video: emptyWorkshop(TITLES.video),
  },
};
