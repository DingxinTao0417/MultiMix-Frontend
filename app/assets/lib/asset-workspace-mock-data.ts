import type { AssetConversation, AssetProduct, AssetWorkspaceData, AssetWorkspaceView, AssetWorkshop } from "./asset-workspace-types";

const assetWorkshops: Record<Exclude<AssetWorkspaceView, "conversation">, AssetWorkshop> = {
  assets: {
    kicker: "Asset workshop",
    title: "资产库",
    description: "沉淀上传资料、采集资料和对话沉淀，作为后续内容生成与检索的证据基础。",
    metrics: [
      { value: "8", label: "上传资料", detail: "PDF / Office / 媒体" },
      { value: "5", label: "采集资料", detail: "网页 / 链接 / Markdown" },
      { value: "3", label: "对话沉淀", detail: "品牌 / 卖点 / 偏好" }
    ],
    rows: [
      {
        title: "市场规则变化素材包",
        meta: "网页 · 已入库",
        note: "来自平台公告与公开政策页面，可生成 LinkedIn 文案和销售话术。",
        kind: "file",
        category: "采集资料",
        contentType: "网页",
        statusLabel: "已入库",
        sourceLabel: "平台公告 / 公开政策页面",
        keywords: ["平台规则", "税费透明", "跨境电商", "买家体验"],
        body: ["平台公告和公开政策页面已解析为可检索资料。", "主要内容包括税费透明、支付体验、物流和售后规则变化。"],
        detailLabel: "内容摘要"
      },
      {
        title: "6月平台政策摘录",
        meta: "PDF · 已入库",
        note: "按规则、支付、物流和售后体验整理为月度素材。",
        kind: "file",
        category: "上传资料",
        contentType: "PDF",
        statusLabel: "已入库",
        sourceLabel: "6月平台政策摘录.pdf",
        keywords: ["月度政策", "支付", "物流", "售后体验"],
        body: ["用户上传的政策摘录已完成解析和切片。", "后续创作可以按规则、支付、物流和售后体验检索引用。"],
        detailLabel: "内容摘要"
      },
      {
        title: "LinkedIn买家洞察",
        meta: "对话记录 · 已沉淀",
        note: "从历史对话中沉淀出的客户沟通角度和买家关注点。",
        kind: "file",
        category: "对话沉淀",
        contentType: "对话记录",
        statusLabel: "已沉淀",
        sourceLabel: "历史创作对话",
        keywords: ["LinkedIn", "买家洞察", "沟通角度", "销售邮件"],
        body: ["对话中沉淀了买家对税费、交付确定性和售后摩擦的关注点。", "这些信息可用于后续生成销售邮件、LinkedIn 帖文和短视频选题。"],
        detailLabel: "沉淀内容"
      }
    ]
  },
  copy: {
    kicker: "Copy workshop",
    title: "文案库",
    description: "管理发帖文案、内容方案和编导稿，保留版本和素材关联。",
    metrics: [
      { value: "18", label: "文案", detail: "方案 / 发帖 / 编导" },
      { value: "7", label: "待编辑", detail: "草稿 / 冲突 / 长文" },
      { value: "12", label: "有来源", detail: "关联资产证据" }
    ],
    rows: [
      {
        title: "独立站税费透明 LinkedIn 帖文",
        meta: "发帖文案 · v2",
        note: "强调 checkout 体验和 landed cost 透明。",
        kind: "copy",
        category: "文案稿",
        keywords: ["LinkedIn", "税费透明", "独立站", "获客"],
        body: [
          "Many cross-border DTC teams still treat duties and import taxes as a back-office compliance detail.",
          "But the buyer experience is changing. When landed cost is unclear at checkout, buyers hesitate and support teams get more questions.",
          "A useful next step: check whether your store shows duties and import taxes clearly for key destination markets."
        ],
        format: "LinkedIn 帖文"
      },
      {
        title: "外贸运营月度选题包",
        meta: "内容方案 · 草稿",
        note: "用于拆分周更内容和销售邮件开场。",
        kind: "copy",
        category: "选题方案",
        keywords: ["选题", "外贸运营", "月度内容", "销售邮件"],
        body: ["本月内容主线围绕平台规则变化、买家信任、结账体验和售后摩擦展开。", "每个主题可以拆成一篇长文、一条短视频口播和一个销售邮件开场。"],
        format: "内容方案"
      },
      {
        title: "60 秒规则变化口播稿",
        meta: "编导稿 · v1",
        note: "开场、证据、判断、收束结构已完成。",
        kind: "copy",
        category: "编导稿",
        keywords: ["口播", "60秒", "规则变化", "短视频"],
        body: ["如果你做跨境独立站，最近要重点看一个变化：税费信息正在从后台合规问题，变成用户结账体验的一部分。", "用户在付款前看不清 landed cost，就会犹豫、咨询，甚至在签收后产生退货摩擦。", "所以这周可以先检查三个位置：商品页、购物车和 checkout 页面。"],
        format: "编导稿"
      },
      {
        title: "客户品牌约束文案",
        meta: "品牌上下文 · v1",
        note: "客户行业、语气和禁用词已应用。",
        kind: "copy",
        category: "文案稿",
        keywords: ["品牌约束", "语气", "禁用词", "客户资料"],
        body: ["语气保持专业、直接、可信，不使用夸张承诺。", "避免使用 lowest price、guaranteed growth 等绝对化表达。"],
        format: "品牌上下文"
      },
      {
        title: "产品种草视频编导稿",
        meta: "编导稿 · v1",
        note: "包含镜头、画面、字幕、节奏和素材要求。",
        kind: "copy",
        category: "编导稿",
        keywords: ["编导", "镜头", "字幕", "素材要求"],
        body: ["镜头 1：产品特写，字幕突出核心卖点。", "镜头 2：使用场景展示，配合旁白说明用户痛点。", "镜头 3：对比前后效果，结尾给出行动引导。"],
        format: "编导稿"
      }
    ]
  },
  image: {
    kicker: "Image workshop",
    title: "图片库",
    description: "管理封面图、商品图、配图和图片生成提示词，保留来源和比例参数。",
    metrics: [
      { value: "6", label: "图片资产", detail: "封面 / 商品图 / 配图" },
      { value: "4", label: "可复用", detail: "已关联内容链路" },
      { value: "2", label: "待确认", detail: "比例 / 主体 / 风格" }
    ],
    rows: [
      {
        title: "4:5 LinkedIn 封面图",
        meta: "封面图 · 草稿",
        note: "税费透明主题，白色商务风格，可继续调整比例和标题。",
        kind: "image",
        category: "封面图",
        statusLabel: "已解析",
        referenceCount: 2,
        keywords: ["封面图", "LinkedIn", "4:5", "商务风"],
        body: ["主体：结账页面和税费说明卡片。", "风格：白底、清晰标题、轻量商务质感。"],
        format: "4:5"
      },
      {
        title: "产品主图参考",
        meta: "商品图 · 已上传",
        note: "用于后续生成产品种草文案和视频分镜。",
        kind: "image",
        category: "素材图",
        statusLabel: "已解析",
        referenceCount: 3,
        keywords: ["产品图", "主图", "种草", "参考素材"],
        body: ["主体清晰，适合作为产品介绍、封面和短视频首帧参考。"],
        format: "1:1"
      },
      {
        title: "短视频封面提示词",
        meta: "图片提示词 · v1",
        note: "保留画面主体、标题层级和负向约束。",
        kind: "image",
        category: "分镜图",
        statusLabel: "待处理",
        referenceCount: 0,
        keywords: ["封面", "提示词", "短视频", "标题层级"],
        body: ["画面主体：跨境卖家查看 checkout 页面。", "标题层级：主标题 8 字以内，副标题保留一行解释。", "负向约束：不要夸张表情、不要复杂背景。"],
        format: "9:16"
      }
    ]
  },
  video: {
    kicker: "Video workshop",
    title: "视频库",
    description: "整理混剪、数字人、MG动画、实景拍摄和生成视频素材。",
    metrics: [
      { value: "10", label: "视频资产", detail: "脚本 / 实景 / 数字人" },
      { value: "5", label: "分镜", detail: "等待确认" },
      { value: "5", label: "待渲染", detail: "处理中 / adapter 未配置" }
    ],
    rows: [
      {
        title: "短视频分镜脚本",
        meta: "视频脚本 · 成功",
        note: "四段式结构：开场、证据、判断、CTA。",
        kind: "video",
        category: "混剪视频",
        keywords: ["分镜", "短视频", "CTA", "脚本"],
        body: ["00:00 开场：用一句问题抓住跨境卖家。", "00:08 证据：展示平台规则变化。", "00:25 判断：解释为什么影响转化。", "00:45 CTA：建议检查 checkout 页面。"],
        format: "9:16 · 60秒",
        variant: "standard"
      },
      {
        title: "实景讲解视频",
        meta: "拍摄清单 · v1",
        note: "顾问出镜、屏幕录制和桌面 B-roll 已分配。",
        kind: "video",
        category: "实景拍摄视频",
        keywords: ["实景", "讲解", "B-roll", "屏幕录制"],
        body: ["镜头 1：顾问正面说明核心变化。", "镜头 2：录屏展示 checkout 页面。", "镜头 3：桌面 B-roll 作为转场。"],
        format: "16:9 · 90秒",
        variant: "standard"
      },
      {
        title: "文生视频概念预览",
        meta: "提示词 · 待渲染",
        note: "保留正向提示词、负向约束和三段缩略帧。",
        kind: "video",
        category: "生成视频素材",
        keywords: ["文生视频", "概念预览", "提示词", "待渲染"],
        body: ["第一段：跨境卖家查看订单和税费说明。", "第二段：用户在 checkout 页面犹豫。", "第三段：清晰展示 landed cost 后完成付款。"],
        format: "9:16 · 30秒",
        variant: "standard"
      },
      {
        title: "税费透明 MG 动画视频",
        meta: "MG动画 · 待渲染",
        note: "用图形动效解释 checkout 税费展示变化。",
        kind: "video",
        category: "MG动画视频",
        keywords: ["MG动画", "图形动效", "解释视频", "税费透明"],
        body: ["00:00 图形化展示订单金额拆分。", "00:08 动效放大 duties 和 import taxes 字段。", "00:20 用箭头说明透明展示如何减少咨询和弃单。"],
        format: "9:16 · 30秒",
        variant: "standard"
      },
      {
        title: "数字人口播视频",
        meta: "数字人 · 待渲染",
        note: "口播、字幕和人设已匹配，等待适配器。",
        kind: "video",
        category: "数字人视频",
        keywords: ["数字人", "口播", "字幕", "小红书"],
        body: ["大家好，今天用一分钟讲一个跨境独立站很容易忽略的问题：税费透明。", "很多卖家以为 duties 和 import taxes 只是后台配置，但用户真正感受到它，是在准备付款的那一刻。", "如果用户看不清最终成本，就会停下来问客服，或者直接放弃下单。", "所以建议你优先检查三个页面：商品页、购物车和 checkout。让用户在付款前知道自己到底要付多少。"],
        format: "9:16 · 45秒",
        detailLabel: "口播文稿",
        variant: "digital-human"
      }
    ]
  }
};

const marketRulePackProduct: AssetProduct = {
  id: "market-rule-pack",
  mode: "copy",
  title: "市场规则变化内容包",
  status: "已生成 · 二次处理内容",
  summary: "从平台公告和公开政策页面里整理出变化点、证据、判断和可复用内容角度，可继续生成文案、视频脚本或销售话术。",
  ratio: "素材包",
  duration: "5 个要点",
  phase: "可继续生成",
  version: "v1",
  body: [
    "变化点：平台开始强调 checkout 阶段的税费与 duties 展示，原本偏后台合规的问题正在前置到买家体验。",
    "来源证据：平台公告与公开政策页面新增 duties、import taxes、landed cost 相关说明，可作为内容判断的依据。",
    "内容判断：对跨境独立站来说，税费透明不只是合规问题，也会影响转化率、签收预期和退货摩擦。",
    "可复用角度：买家信任、成本透明、checkout 体验、售后摩擦、服务商可提供的税费链路检查。",
    "可派生产物：LinkedIn 发帖文案、销售邮件开场、60 秒短视频口播、封面图标题和客户沟通话术。"
  ],
  sections: [
    { label: "来源", title: "平台公告与公开政策页面", detail: "原始网页和 Reader Markdown 仍作为来源素材保留。", status: "已关联" },
    { label: "变化", title: "税费展示前置", detail: "从后台合规问题变成买家结账体验问题。", status: "已提炼" },
    { label: "判断", title: "影响转化与售后摩擦", detail: "内容可围绕 landed cost 透明展开。", status: "已生成" },
    { label: "复用", title: "文案 / 视频 / 销售话术", detail: "可作为后续产物的内容依据。", status: "可派生" }
  ],
  timeline: [],
  actions: ["生成LinkedIn文案", "拆成短视频", "生成销售话术", "精细调整"],
  preview: {
    title: "市场规则变化内容包",
    subtitle: "变化点、证据、判断和可复用角度已整理",
    eyebrow: "二次处理内容"
  }
};

const marketRuleProduct: AssetProduct = {
  id: "market-rule-linkedin-copy",
  mode: "copy",
  title: "LinkedIn 发帖文案",
  status: "已生成 · 有来源",
  summary: "把平台规则变化转成面向独立站客户的英文获客内容，保留证据、判断和可执行建议。",
  ratio: "LinkedIn",
  duration: "1,180 字",
  phase: "可直接编辑",
  version: "v1",
  body: [
    "Many cross-border DTC teams still treat duties and import taxes as a back-office compliance detail.",
    "But the buyer experience is changing. When landed cost is unclear at checkout, buyers hesitate, support teams get more questions, and merchants take on avoidable return friction.",
    "The signal from recent platform policy updates is simple: tax and duty visibility is moving closer to the checkout experience. That means it is no longer only a finance or compliance topic. It is part of conversion, trust, and post-purchase expectation management.",
    "For independent brands selling internationally, this is a practical moment to review how duties, import taxes, shipping fees, and estimated landed cost are explained before payment.",
    "A useful next step: check whether your store shows duties and import taxes clearly for key destination markets, then compare the checkout message with what your sales and support teams tell customers."
  ],
  sections: [
    { label: "文案", title: "开场 + 判断 + CTA", detail: "围绕税费透明和 landed cost 体验组织内容。", status: "已生成" },
    { label: "证据", title: "市场规则变化素材包", detail: "保留平台公告和公开政策页面来源。", status: "已关联" },
    { label: "复用", title: "销售话术 / 短视频口播", detail: "可继续拆成视频脚本或客户沟通开场。", status: "可生成" },
    { label: "参数", title: "语气：专业克制", detail: "面向跨境独立站服务客户。", status: "可调整" }
  ],
  timeline: [],
  actions: ["改得更专业", "生成配图", "拆成60秒视频", "精细调整"],
  sourceSummary: {
    headline: "基于 2 个素材生成",
    refs: [
      { id: "mock-source-rule-pack", title: "市场规则变化素材包", statusLabel: "已解析", referenceCount: 3 },
      { id: "mock-source-buyer-insight", title: "LinkedIn买家洞察", statusLabel: "已解析", referenceCount: 1 }
    ]
  },
  preview: {
    title: "LinkedIn 发帖文案",
    subtitle: "Evidence to judgment to buyer action",
    eyebrow: "来源支持内容"
  }
};

const policyPlanProduct: AssetProduct = {
  id: "platform-policy-content-plan",
  mode: "copy",
  title: "月度内容方案",
  status: "草稿 · 待确认",
  summary: "把 6 月平台政策摘录整理成外贸运营团队可复用的选题包，适合继续生成发帖和销售邮件。",
  ratio: "内容方案",
  duration: "8 个选题",
  phase: "待挑选",
  version: "v1",
  body: [
    "主题方向一：买家信任与成本透明。围绕平台规则变化，解释为什么税费、物流和售后承诺需要更早进入客户沟通。",
    "主题方向二：跨境支付与结账体验。把支付限制、费用展示和目的国差异整理成销售团队可直接使用的话术。",
    "主题方向三：交付确定性。用物流规则和售后体验变化提醒客户检查交付承诺、签收预期和退货政策。",
    "推荐拆分：先生成 3 条英文 LinkedIn 帖文，再把其中 1 条改成销售邮件开场，最后挑 2 个角度做短视频脚本。"
  ],
  sections: [
    { label: "选题", title: "买家信任与成本透明", detail: "从平台规则变化提炼客户沟通角度。", status: "已生成" },
    { label: "渠道", title: "LinkedIn / 邮件 / 口播", detail: "每个选题可拆成多渠道素材。", status: "可扩展" },
    { label: "证据", title: "6月平台政策摘录", detail: "素材仍可回溯到原始政策摘录。", status: "已关联" },
    { label: "下一步", title: "优先生成 LinkedIn 帖文", detail: "建议先产出一组英文短帖。", status: "推荐" }
  ],
  timeline: [],
  actions: ["生成3条帖文", "转成邮件开场", "提炼销售话术", "精细调整"],
  preview: {
    title: "月度内容方案",
    subtitle: "8 个选题方向，可继续拆分为 LinkedIn、邮件和口播",
    eyebrow: "平台政策摘录"
  }
};

const videoScriptProduct: AssetProduct = {
  id: "short-video-storyboard",
  mode: "video",
  title: "60 秒短视频分镜",
  status: "已生成 · 视频模式",
  summary: "当前产物是一条 9:16 短视频脚本，包含四段分镜、素材建议、口播节奏和字幕检查项。",
  ratio: "9:16",
  duration: "00:60",
  phase: "脚本 + 分镜",
  version: "v1",
  sections: [
    { label: "分镜", title: "开场 / 证据 / 判断 / CTA", detail: "四段结构已经生成，可继续压缩或扩写。", status: "已生成" },
    { label: "素材", title: "平台公告截图 + 规则摘要", detail: "第 2 段建议使用来源页面截图。", status: "待确认" },
    { label: "音频", title: "60 秒口播节奏", detail: "口播稿已匹配分镜，等待音色选择。", status: "待选择" },
    { label: "字幕", title: "移动端大字幕", detail: "默认保留两行以内字幕，适合 9:16 观看。", status: "可调整" },
    { label: "时间轴", title: "0-8 / 8-25 / 25-45 / 45-60", detail: "时间点已按四段内容预分配。", status: "已匹配" },
    { label: "参数", title: "模式：实景口播", detail: "可切换 MG 动画、实景或数字人。", status: "可切换" }
  ],
  timeline: [
    { time: "00:00", title: "开场误区", status: "口播 + 标题字幕" },
    { time: "00:08", title: "来源证据", status: "素材截图待确认" },
    { time: "00:25", title: "业务判断", status: "旁白已匹配" },
    { time: "00:45", title: "行动建议", status: "CTA 已生成" }
  ],
  segments: [
    {
      id: "storyboard-seg-1",
      index: 1,
      title: "开场误区",
      startSeconds: 0,
      endSeconds: 8,
      line: "很多独立站把税费当成后台问题。",
      subLine: "口播 + 标题字幕",
      assetTitle: "产品主图参考",
      isFallback: false
    },
    {
      id: "storyboard-seg-2",
      index: 2,
      title: "来源证据",
      startSeconds: 8,
      endSeconds: 25,
      line: "平台正在强化 checkout 阶段的费用透明。",
      subLine: "来源页面截图 · 待确认",
      assetTitle: "市场规则变化素材包",
      isFallback: false,
      mgLabel: "MG 字卡"
    },
    {
      id: "storyboard-seg-3",
      index: 3,
      title: "业务判断",
      startSeconds: 25,
      endSeconds: 45,
      line: "税费透明会影响转化率和退货摩擦。",
      subLine: "旁白已匹配 · 放慢语速",
      assetTitle: "4:5 LinkedIn 封面图",
      isFallback: false
    },
    {
      id: "storyboard-seg-4",
      index: 4,
      title: "行动建议",
      startSeconds: 45,
      endSeconds: 60,
      line: "检查你的 landed cost 展示链路。",
      subLine: "建议换成你的产品实拍",
      assetTitle: "通用结账界面画面",
      isFallback: true
    }
  ],
  sourceSummary: {
    headline: "基于 3 个已保存素材 + 1 段兜底素材生成",
    note: "素材命中率 3/4 · 兜底素材只在没有你的素材可用时使用",
    refs: [
      { id: "mock-source-product-hero", title: "产品主图参考", statusLabel: "已解析", referenceCount: 1 },
      { id: "mock-source-rule-pack-shot", title: "市场规则变化素材包", statusLabel: "已解析", referenceCount: 1 },
      { id: "mock-source-cover-image", title: "4:5 LinkedIn 封面图", statusLabel: "已解析", referenceCount: 1 },
      { id: "mock-source-stock-checkout", title: "通用结账界面画面", isFallback: true }
    ]
  },
  actions: ["缩短到30秒", "换成数字人", "生成封面图", "精细调整"],
  preview: {
    title: "60 秒短视频分镜",
    subtitle: "开场 / 证据 / 判断 / CTA",
    eyebrow: "9:16 视频预览",
    frames: [
      { title: "封面图", subtitle: "税费透明", tone: "dark" },
      { title: "分镜 01", subtitle: "运营误区", tone: "neutral" },
      { title: "分镜 02", subtitle: "来源证据", tone: "blue" }
    ]
  }
};

// A finished video project (has both a video_project and a playable file) so
// the demo browse state (player + jumpable segment cards) is reachable offline.
// The editor embed still takes over when the「编辑」toggle is pressed.
const finishedVideoProduct: AssetProduct = {
  ...videoScriptProduct,
  id: "finished-short-video",
  title: "60 秒短视频成片",
  status: "已生成 · 成片",
  phase: "成片",
  version: "v2",
  metadata: {
    // video_project marks it a finished project; the top-level video_url is
    // what playableVideoUrl() reads (mp4_ref would route through the API proxy,
    // unreachable in offline mock — a direct https URL plays as-is).
    video_project: { status: "completed" },
    video_url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
  }
};

const imageCoverProduct: AssetProduct = {
  id: "linkedin-cover-image",
  mode: "image",
  title: "4:5 封面图",
  status: "已生成 · 图片",
  summary: "基于市场规则变化素材生成三张封面图方向，保留来源素材、画面主体、标题层级和比例参数。",
  ratio: "4:5",
  duration: "3 张",
  phase: "可重绘",
  sections: [
    { label: "图片", title: "封面图 3 版", detail: "主画面突出税费透明和跨境结算场景。", status: "已生成" },
    { label: "素材", title: "平台公告 + 独立站后台", detail: "来源截图作为画面参考，不直接伪造 UI。", status: "已关联" },
    { label: "文案", title: "税费透明正在影响转化", detail: "标题保留为可编辑文字层。", status: "可调整" },
    { label: "参数", title: "4:5 / 白色商务风格", detail: "可通过对话调整比例、主体、风格和标题。", status: "可重绘" }
  ],
  timeline: [],
  actions: ["换成9:16", "标题更醒目", "生成产品图风格", "精细调整"],
  preview: {
    title: "税费透明正在影响转化",
    subtitle: "Checkout experience is becoming a growth topic",
    eyebrow: "4:5 LinkedIn cover",
    prompt: "白色商务风格，跨境电商后台、费用标签、清晰标题层级，避免复杂插画。",
    frames: [
      { title: "白色商务", subtitle: "主标题强", tone: "neutral" },
      { title: "数据标签", subtitle: "规则变化", tone: "blue" },
      { title: "客户场景", subtitle: "咨询表达", tone: "green" }
    ]
  }
};

const mgAnimationProduct: AssetProduct = {
  id: "mg-animation-explainer",
  mode: "video",
  title: "MG 动画说明视频",
  status: "脚本 + 动效指令",
  summary: "把政策变化解释成 45 秒 MG 动画，用图标、路径和数字标签说明税费展示如何影响买家体验。",
  ratio: "16:9",
  duration: "00:45",
  phase: "待生成分镜图",
  sections: [
    { label: "分镜", title: "问题 / 变化 / 影响 / 建议", detail: "每段都有画面说明和转场指令。", status: "已生成" },
    { label: "动效", title: "路径箭头 + 费用标签", detail: "用轻量动效展示 checkout 成本变化。", status: "待确认" },
    { label: "素材", title: "公告截图转信息卡", detail: "将来源证据改写成动画信息块。", status: "已分配" },
    { label: "参数", title: "16:9 / MG 动画", detail: "可切换 9:16 或减少动效复杂度。", status: "可调整" }
  ],
  timeline: [
    { time: "00:00", title: "提出误区", status: "标题动画" },
    { time: "00:10", title: "展示规则变化", status: "证据信息卡" },
    { time: "00:25", title: "解释影响", status: "流程图动效" },
    { time: "00:38", title: "落到建议", status: "CTA 字幕" }
  ],
  actions: ["改成9:16", "减少动效", "生成分镜图", "精细调整"],
  preview: {
    title: "MG 动画说明视频",
    subtitle: "费用标签流向 checkout 的动效草稿",
    eyebrow: "16:9 MG storyboard",
    frames: [
      { title: "问题标题", subtitle: "误区", tone: "dark" },
      { title: "费用路径", subtitle: "箭头动效", tone: "blue" },
      { title: "行动建议", subtitle: "检查清单", tone: "green" }
    ]
  }
};

const audioSyncProduct: AssetProduct = {
  id: "audio-subtitle-timeline",
  mode: "audio",
  title: "口播音频与时间轴",
  status: "已匹配 · 音频",
  summary: "把 60 秒口播稿匹配到音频、字幕和时间轴，便于后续生成视频或数字人口播。",
  ratio: "中文口播",
  duration: "00:60",
  phase: "待试听",
  sections: [
    { label: "音频", title: "60 秒口播", detail: "已按四段内容估算停顿和重音。", status: "已匹配" },
    { label: "文案", title: "口播稿逐句拆分", detail: "每句可单独缩短或改语气。", status: "已拆分" },
    { label: "字幕", title: "移动端双行字幕", detail: "默认每屏不超过 18 个中文字符。", status: "可调整" },
    { label: "时间轴", title: "句子级时间点", detail: "后续可同步视频分镜或数字人口型。", status: "已生成" }
  ],
  timeline: [
    { time: "00:00", title: "开场句", status: "0.4s 停顿" },
    { time: "00:09", title: "来源说明", status: "强调证据" },
    { time: "00:28", title: "判断句", status: "放慢语速" },
    { time: "00:48", title: "行动建议", status: "收束 CTA" }
  ],
  actions: ["语速更快", "字幕更大", "换成英文口播", "精细调整"],
  preview: {
    title: "口播音频与时间轴",
    subtitle: "四段口播、字幕长度和停顿已预匹配",
    eyebrow: "Audio timeline"
  }
};

const digitalHumanProduct: AssetProduct = {
  id: "digital-human-video",
  mode: "digital-human",
  title: "数字人口播视频",
  status: "待渲染 · 数字人",
  summary: "把已保存的短视频脚本转成 9:16 数字人口播视频，展示当前口播稿、视频预览和逐句音轨字幕匹配。",
  ratio: "9:16",
  duration: "00:45",
  phase: "待选择人设",
  version: "v1",
  body: [
    "很多独立站仍把税费透明当成后台合规问题。",
    "但平台规则变化正在把 duties、import taxes 和 landed cost 推到 checkout 体验里。",
    "当买家在付款前看不清真实成本，转化、签收预期和售后摩擦都会受到影响。",
    "建议先检查 Shopify 店铺在核心目的国是否清楚展示税费，再统一销售和客服口径。"
  ],
  sections: [
    { label: "来源产物", title: "60 秒短视频分镜脚本 v1", detail: "数字人口播基于已保存脚本生成，来源链路保留在详情中。", status: "已关联" },
    { label: "口播", title: "45 秒精简脚本", detail: "每句话已匹配到下方音轨和字幕时间点。", status: "已生成" },
    { label: "人设", title: "商务顾问型数字人", detail: "适合面向外贸服务客户解释规则变化。", status: "待确认" },
    { label: "字幕", title: "中英大字号字幕", detail: "默认移动端优先，可改为纯英文字幕或缩小字号。", status: "可调整" },
    { label: "背景", title: "浅色办公场景", detail: "避免复杂装饰，突出信息解释。", status: "待确认" },
    { label: "渲染", title: "数字人视频模式", detail: "渲染依赖适配器；无适配器时保留脚本、字幕和时间轴。", status: "待适配" }
  ],
  timeline: [
    { time: "00:00", title: "开场", status: "正面口播", line: "很多独立站仍把税费透明当成后台合规问题。" },
    { time: "00:10", title: "规则变化", status: "字幕强调关键词", line: "但平台规则变化正在把 duties、import taxes 和 landed cost 推到 checkout 体验里。" },
    { time: "00:25", title: "业务判断", status: "放慢语速", line: "当买家在付款前看不清真实成本，转化、签收预期和售后摩擦都会受到影响。" },
    { time: "00:38", title: "行动建议", status: "收束 CTA", line: "建议先检查 Shopify 店铺在核心目的国是否清楚展示税费，再统一销售和客服口径。" }
  ],
  actions: ["换女性商务人设", "改成英文字幕", "插入产品图", "精细调整"],
  preview: {
    title: "数字人口播视频",
    subtitle: "商务顾问型数字人 · 中英字幕 · 9:16",
    eyebrow: "Digital human preview",
    frames: [
      { title: "口播视频", subtitle: "正面人设", tone: "dark" },
      { title: "字幕样式", subtitle: "中英大字", tone: "blue" },
      { title: "产品插图", subtitle: "待插入", tone: "green" }
    ]
  }
};

const realSceneVideoProduct: AssetProduct = {
  id: "real-scene-video",
  mode: "video",
  title: "实景讲解视频",
  status: "脚本 + 拍摄清单",
  summary: "把内容包转成实景拍摄方案，包含主持人口播、桌面素材、屏幕录制和 B-roll 插入点。",
  ratio: "9:16",
  duration: "00:50",
  phase: "待拍摄",
  version: "v1",
  sections: [
    { label: "镜头", title: "真人讲解 + 屏幕录制", detail: "适合服务商顾问出镜解释规则变化。", status: "已生成" },
    { label: "素材", title: "公告截图 / checkout 示例", detail: "第 2 段插入来源截图，第 3 段切到 checkout 示例。", status: "已分配" },
    { label: "口播", title: "50 秒精简稿", detail: "保留判断和行动建议，减少背景解释。", status: "已匹配" },
    { label: "拍摄", title: "白色办公桌面", detail: "自然光、浅色背景、手机竖屏拍摄。", status: "待执行" }
  ],
  timeline: [
    { time: "00:00", title: "出镜开场", status: "真人口播" },
    { time: "00:08", title: "来源截图", status: "插入屏幕录制" },
    { time: "00:24", title: "checkout 示例", status: "B-roll" },
    { time: "00:40", title: "行动建议", status: "顾问 CTA" }
  ],
  actions: ["改成横屏", "减少出镜", "补拍摄清单", "精细调整"],
  preview: {
    title: "实景讲解视频",
    subtitle: "顾问出镜 + 来源截图 + checkout 示例",
    eyebrow: "Real-scene video",
    frames: [
      { title: "出镜开场", subtitle: "顾问解释", tone: "neutral" },
      { title: "来源截图", subtitle: "证据画面", tone: "blue" },
      { title: "桌面 B-roll", subtitle: "操作场景", tone: "green" }
    ]
  }
};

const textToVideoProduct: AssetProduct = {
  id: "text-to-video-demo",
  mode: "video",
  title: "文生视频概念预览",
  status: "提示词 · 待渲染",
  summary: "把规则变化转成 12 秒概念视频提示词，用抽象的费用标签、物流路径和结账界面表达 landed cost 变化。",
  ratio: "16:9",
  duration: "00:12",
  phase: "待接入模型",
  version: "v1",
  body: [
    "Prompt: clean white business UI environment, floating labels for duties, import taxes and landed cost, a checkout path turning from blurred to clear, soft camera movement, professional B2B style, no fake brand logos.",
    "Negative prompt: no real platform logo, no fabricated government seal, no messy charts, no overly dramatic neon cyber style."
  ],
  sections: [
    { label: "提示词", title: "费用标签变清晰", detail: "用视觉隐喻表达 landed cost 透明。", status: "已生成" },
    { label: "限制", title: "不伪造真实平台 UI", detail: "避免出现平台 logo、真实品牌或不可验证公告。", status: "已约束" },
    { label: "素材", title: "内容包作为语义来源", detail: "只提取判断和关键词，不直接渲染来源页面。", status: "已关联" },
    { label: "适配", title: "视频模型待接入", detail: "当前保留提示词和预览，后续可交给模型。", status: "待渲染" }
  ],
  timeline: [
    { time: "00:00", title: "模糊费用", status: "标签从模糊出现" },
    { time: "00:04", title: "路径清晰", status: "checkout 路径亮起" },
    { time: "00:08", title: "成本透明", status: "费用标签稳定" }
  ],
  actions: ["改成9:16", "更商务", "减少抽象感", "精细调整"],
  preview: {
    title: "文生视频概念预览",
    subtitle: "费用标签从模糊到清晰",
    eyebrow: "Text-to-video prompt",
    frames: [
      { title: "模糊费用", subtitle: "风险", tone: "dark" },
      { title: "路径亮起", subtitle: "checkout", tone: "blue" },
      { title: "成本透明", subtitle: "landed cost", tone: "green" }
    ]
  }
};

const multiVersionCopyProduct: AssetProduct = {
  id: "multi-version-linkedin-v3",
  mode: "copy",
  title: "LinkedIn 发帖文案 v3",
  status: "已保存 · 多版本",
  summary: "同一条 LinkedIn 文案经历专业化、缩短和 CTA 调整三次迭代，用来测试版本保存、回看和继续调整。",
  ratio: "LinkedIn",
  duration: "860 字",
  phase: "v3 当前版本",
  version: "v3",
  body: [
    "Cross-border checkout is no longer only a payment step. It is becoming the place where buyers decide whether the final cost feels trustworthy.",
    "Recent platform policy changes point to a clear signal: duties, import taxes and landed cost need to be visible earlier, not explained after a support ticket appears.",
    "For independent brands, this is not just a compliance task. It affects buyer confidence, conversion friction and post-purchase expectations.",
    "A practical check for this week: review your top destination markets and compare what buyers see at checkout with what your sales and support teams explain manually."
  ],
  sections: [
    { label: "v1", title: "完整解释版", detail: "保留更多背景和来源说明，适合长帖。", status: "已保存" },
    { label: "v2", title: "专业克制版", detail: "降低营销感，增强顾问语气。", status: "已保存" },
    { label: "v3", title: "短版 CTA", detail: "缩短正文并强化本周检查动作。", status: "当前" },
    { label: "回滚", title: "可恢复 v1/v2", detail: "用于测试版本入口和保存状态。", status: "可操作" }
  ],
  timeline: [],
  actions: ["回到v2", "继续缩短", "换CTA", "保存新版本"],
  versions: [
    { id: "v1", label: "v1 完整解释版", savedAt: "18 分钟前", status: "已保存" },
    { id: "v2", label: "v2 专业克制版", savedAt: "12 分钟前", status: "已保存" },
    { id: "v3", label: "v3 短版 CTA", savedAt: "刚刚", status: "当前" }
  ],
  preview: {
    title: "LinkedIn 发帖文案 v3",
    subtitle: "多版本保存、回看和继续调整",
    eyebrow: "Versioned copy"
  }
};

const failedImageProduct: AssetProduct = {
  id: "failed-cover-image",
  mode: "image",
  title: "封面图生成失败",
  status: "生成失败 · 可重试",
  summary: "图片生成适配器返回失败，系统保留提示词、比例和失败原因，便于用户通过对话调整后重试。",
  ratio: "4:5",
  duration: "0 张",
  phase: "失败",
  version: "v0",
  sections: [
    { label: "失败原因", title: "画面主体过于抽象", detail: "模型未能稳定表达平台规则变化和 checkout 关系。", status: "需调整" },
    { label: "保留项", title: "标题 / 比例 / 风格", detail: "用户已确认的参数不丢失。", status: "已保留" },
    { label: "建议", title: "减少抽象隐喻", detail: "改用费用标签、结账路径和顾问解释画面。", status: "可重试" }
  ],
  timeline: [],
  actions: ["重试生成", "减少抽象感", "换成信息图", "精细调整"],
  preview: {
    title: "封面图生成失败",
    subtitle: "保留提示词，等待重试",
    eyebrow: "Failed image generation",
    frames: [
      { title: "失败", subtitle: "主体不清晰", tone: "dark" },
      { title: "可保留", subtitle: "4:5 白色商务", tone: "neutral" },
      { title: "建议", subtitle: "改信息图", tone: "blue" }
    ]
  }
};

const failedCopyProduct: AssetProduct = {
  id: "failed-copy",
  mode: "copy",
  title: "LinkedIn 文案生成失败",
  status: "生成失败 · 可重试",
  summary: "模型服务超时，未能写完正文。你的素材、方案和已确认的设定都已保留。",
  ratio: "LinkedIn",
  duration: "0 段",
  phase: "失败",
  version: "v0",
  sections: [
    { label: "失败原因", title: "模型服务超时", detail: "写正文这一步在后台执行时超时，未产出完整内容。", status: "需重试" },
    { label: "保留项", title: "平台 / 风格 / 结构", detail: "已确认的方案参数不丢失。", status: "已保留" },
    { label: "建议", title: "回对话重试", detail: "重试只会重新执行写正文这一步，不会从头再来。", status: "可重试" }
  ],
  timeline: [],
  actions: ["重试生成", "回对话调整", "缩短篇幅", "精细调整"],
  preview: {
    title: "LinkedIn 文案生成失败",
    subtitle: "模型服务超时，等待重试",
    eyebrow: "Failed copy generation"
  }
};

const processingVideoProduct: AssetProduct = {
  id: "processing-video-render",
  mode: "video",
  title: "短视频渲染中",
  status: "处理中 · 42%",
  summary: "视频渲染任务已创建，当前展示处理中状态、预计步骤和可取消/继续等待的下一步建议。",
  ratio: "9:16",
  duration: "00:45",
  phase: "渲染中",
  version: "job-042",
  sections: [
    { label: "队列", title: "视频适配器已接收", detail: "任务已提交，等待生成首帧预览。", status: "进行中" },
    { label: "素材", title: "脚本 / 封面 / 字幕", detail: "三个输入均已上传到渲染上下文。", status: "已就绪" },
    { label: "风险", title: "数字人模型未确认", detail: "如选择数字人路线，需要确认人设。", status: "待确认" }
  ],
  timeline: [
    { time: "00:00", title: "创建任务", status: "已完成" },
    { time: "00:12", title: "生成首帧", status: "处理中" },
    { time: "00:28", title: "合成字幕", status: "等待" },
    { time: "00:45", title: "导出预览", status: "等待" }
  ],
  actions: ["继续等待", "取消任务", "改成人工剪辑", "查看详情"],
  preview: {
    title: "短视频渲染中",
    subtitle: "42% · 等待首帧预览",
    eyebrow: "Rendering",
    frames: [
      { title: "任务创建", subtitle: "完成", tone: "green" },
      { title: "首帧生成", subtitle: "处理中", tone: "blue" },
      { title: "字幕合成", subtitle: "等待", tone: "neutral" }
    ]
  }
};

const conflictBriefProduct: AssetProduct = {
  id: "source-conflict-brief",
  mode: "copy",
  title: "素材冲突确认卡",
  status: "待确认 · 来源冲突",
  summary: "两个来源对税费展示适用范围的描述不一致，系统不自动决定，要求用户确认采用范围或同时保留。",
  ratio: "冲突处理",
  duration: "2 个来源",
  phase: "待用户确认",
  version: "v1",
  body: [
    "冲突点：来源 A 表示 duties 展示适用于主要目的国；来源 B 只提到部分市场灰度开放。",
    "可选处理：采用来源 A 作为营销表达、采用来源 B 作为谨慎表达，或同时保留并标注适用范围。",
    "建议：对外内容使用谨慎表达，写成“部分平台和市场正在把税费展示前置到 checkout 体验”。"
  ],
  sections: [
    { label: "来源 A", title: "平台公告摘要", detail: "表述更强，适合内容角度。", status: "待确认" },
    { label: "来源 B", title: "政策帮助页", detail: "范围更窄，适合合规表述。", status: "待确认" },
    { label: "处理", title: "不自动覆盖", detail: "需要用户选择采用新版本、旧版本或同时存在。", status: "需决策" }
  ],
  timeline: [],
  actions: ["采用谨慎表达", "同时保留", "只采用来源B", "查看详情"],
  preview: {
    title: "素材冲突确认卡",
    subtitle: "来源 A 与来源 B 对适用范围不一致",
    eyebrow: "Conflict"
  }
};

const multiSourceVideoProduct: AssetProduct = {
  id: "multi-source-video",
  mode: "video",
  title: "多素材组合视频",
  status: "已生成 · 多素材",
  summary: "一个视频同时引用文案、封面图、政策摘录和音频时间轴，用来测试多素材组合和详情抽屉的信息承载。",
  ratio: "9:16",
  duration: "00:60",
  phase: "素材已分配",
  version: "v1",
  sections: [
    { label: "文案", title: "LinkedIn 发帖文案 v3", detail: "提供开场判断和 CTA。", status: "已使用" },
    { label: "图片", title: "4:5 封面图", detail: "裁切为 9:16 首帧参考。", status: "已使用" },
    { label: "音频", title: "口播音频时间轴", detail: "提供逐句字幕和停顿。", status: "已使用" },
    { label: "来源", title: "6月平台政策摘录", detail: "作为详情内的证据链。", status: "已关联" }
  ],
  timeline: [
    { time: "00:00", title: "封面图开场", status: "图片素材" },
    { time: "00:10", title: "文案判断", status: "口播素材" },
    { time: "00:28", title: "政策摘录", status: "来源素材" },
    { time: "00:46", title: "行动建议", status: "字幕素材" }
  ],
  actions: ["替换封面", "换音频", "移除来源图", "精细调整"],
  preview: {
    title: "多素材组合视频",
    subtitle: "文案 + 图片 + 音频 + 来源证据",
    eyebrow: "Multi-source video",
    frames: [
      { title: "封面", subtitle: "图片", tone: "green" },
      { title: "口播", subtitle: "音频", tone: "blue" },
      { title: "证据", subtitle: "政策摘录", tone: "dark" }
    ]
  }
};

const brandGuidelineProduct: AssetProduct = {
  id: "brand-guideline-copy",
  mode: "copy",
  title: "客户品牌约束文案",
  status: "已生成 · 品牌约束",
  summary: "在指定客户行业、品牌语气、禁用词和目标市场后生成内容，用来测试品牌上下文对产物的影响。",
  ratio: "客户 A / LinkedIn",
  duration: "720 字",
  phase: "可直接编辑",
  version: "v1",
  body: [
    "For export manufacturers serving EU buyers, landed-cost clarity is becoming part of the trust conversation before a purchase order is even discussed.",
    "Instead of treating duties and import taxes as an after-sales explanation, sales teams can use this change to start a more concrete conversation about buyer-side cost predictability.",
    "Suggested angle: help customers review where cost uncertainty appears in their current inquiry, quotation and checkout flows."
  ],
  sections: [
    { label: "客户", title: "B2B 出口制造商", detail: "目标市场：欧盟采购商。", status: "已应用" },
    { label: "语气", title: "顾问型、克制", detail: "避免夸张增长承诺。", status: "已应用" },
    { label: "禁用词", title: "颠覆 / 爆单 / 秒杀", detail: "不使用强营销词。", status: "已过滤" },
    { label: "渠道", title: "LinkedIn", detail: "面向海外采购和外贸服务客户。", status: "已匹配" }
  ],
  timeline: [],
  actions: ["换行业", "改成邮件", "更像CEO语气", "查看详情"],
  preview: {
    title: "客户品牌约束文案",
    subtitle: "客户 A · 欧盟采购商 · 顾问型语气",
    eyebrow: "Brand context"
  }
};

const adapterHandoffProduct: AssetProduct = {
  id: "adapter-handoff",
  mode: "digital-human",
  title: "渲染适配器交接",
  status: "待配置 · 外部工具",
  summary: "数字人、文生视频或 MG 动画需要外部适配器时，展示输入已准备好但渲染未启动的状态。",
  ratio: "9:16",
  duration: "00:45",
  phase: "等待适配器",
  version: "handoff",
  body: [
    "输入已准备：口播稿、字幕时间轴、数字人人设、背景风格和输出比例。",
    "未启动原因：当前环境未配置数字人渲染适配器。"
  ],
  sections: [
    { label: "输入", title: "脚本 / 字幕 / 人设", detail: "所有本地可编辑资产已生成。", status: "已就绪" },
    { label: "适配器", title: "数字人渲染服务", detail: "需要配置外部工具或本地工作流。", status: "待配置" },
    { label: "回退", title: "保留为视频方案", detail: "未配置时不创建假渲染结果。", status: "已保留" }
  ],
  timeline: [
    { time: "00:00", title: "准备输入", status: "已完成" },
    { time: "00:10", title: "连接适配器", status: "待配置" },
    { time: "00:20", title: "启动渲染", status: "未开始" }
  ],
  actions: ["配置适配器", "导出参数", "改成人工剪辑", "查看详情"],
  preview: {
    title: "渲染适配器交接",
    subtitle: "输入已就绪，等待外部工具",
    eyebrow: "Adapter handoff"
  }
};

const noSourceDraftProduct: AssetProduct = {
  id: "no-source-draft",
  mode: "copy",
  title: "无素材直创草稿",
  status: "草稿 · 未关联来源",
  summary: "用户没有选择素材时也能先创作，但产物明确标记未关联来源，不能被当作证据支持内容。",
  ratio: "LinkedIn",
  duration: "520 字",
  phase: "未关联素材",
  version: "draft",
  body: [
    "This is a draft created from the user's direct instruction without linked source evidence.",
    "It can be edited and saved as a copy product, but it should not be marked as evidence-supported until a source asset is attached."
  ],
  sections: [
    { label: "来源", title: "未关联素材", detail: "当前内容没有来源证据支撑。", status: "需关联" },
    { label: "用途", title: "先写草稿", detail: "适合快速试方向，不适合直接作为证据型内容。", status: "可编辑" },
    { label: "下一步", title: "关联素材包", detail: "关联后可补充证据和判断链。", status: "推荐" }
  ],
  timeline: [],
  actions: ["关联素材", "继续写", "改成视频脚本", "保存草稿"],
  preview: {
    title: "无素材直创草稿",
    subtitle: "未关联来源，不能标记为证据支持",
    eyebrow: "No-source draft"
  }
};

const longCopyProduct: AssetProduct = {
  id: "long-copy-pressure",
  mode: "copy",
  title: "长文案压力测试",
  status: "已生成 · 长内容",
  summary: "用于测试右侧展示区在长文案、长章节和大量段落下是否完整显示、可编辑且不遮挡。",
  ratio: "长文 / Blog outline",
  duration: "2,800 字",
  phase: "可编辑",
  version: "v1",
  body: [
    "标题：为什么税费透明正在成为跨境独立站的买家体验问题",
    "第一部分：过去很多团队把 duties、import taxes 和 landed cost 当作后台合规或财务测算问题。这个视角没有错，但它忽略了买家在付款前如何理解最终成本。",
    "第二部分：当平台规则逐渐把费用展示前置到 checkout，用户看到的不是政策术语，而是自己要不要继续付款的判断依据。",
    "第三部分：对服务商来说，这类变化可以转化为一个更高质量的客户沟通话题：不是提醒客户追热点，而是帮助客户检查转化摩擦和售后风险。",
    "第四部分：建议从三个位置检查：商品页的价格预期、checkout 的费用解释、销售和客服对目的国税费的统一口径。",
    "第五部分：如果客户面向多个市场销售，还需要区分不同目的国、原产国和物流路线下的 landed cost 表达，不要用一个通用口径覆盖全部情况。",
    "第六部分：内容产物可以拆成 LinkedIn 观点帖、销售邮件开场、60 秒短视频、客户诊断清单和封面图标题。",
    "结尾：真正有价值的内容不是复述平台公告，而是把公告转成客户可以执行的一步检查。"
  ],
  sections: [
    { label: "结构", title: "6 段长文", detail: "用于测试长内容编辑和滚动。", status: "已生成" },
    { label: "来源", title: "市场规则变化内容包", detail: "证据链保留在详情中。", status: "已关联" },
    { label: "派生", title: "帖子 / 邮件 / 视频", detail: "长文可继续拆成多产物。", status: "可拆分" }
  ],
  timeline: [],
  actions: ["拆成3条帖文", "压缩到800字", "生成目录", "保存长文"],
  preview: {
    title: "长文案压力测试",
    subtitle: "长段落、长章节、长编辑区",
    eyebrow: "Long content"
  }
};

const emptyProduct: AssetProduct = {
  id: "empty-product",
  mode: "video",
  title: "等待生成的产物",
  status: "未生成",
  summary: "在对话中输入目标、渠道、比例、时长或表现形式后，这里会直接展示当前产物工作区。",
  ratio: "待确认",
  duration: "待确认",
  phase: "等待指令",
  sections: [
    { label: "类型", title: "由对话确认", detail: "可以说生成图片、短视频、数字人口播、音频或文案。", status: "待确认" },
    { label: "素材", title: "未选择素材", detail: "可从资产库、文案库、图片库或视频库关联。", status: "待关联" },
    { label: "参数", title: "比例 / 时长 / 风格", detail: "建议用自然语言描述，不需要先配置。", status: "待确认" }
  ],
  timeline: [],
  actions: ["生成短视频", "生成配图", "写一版文案", "精细调整"]
};

const mgAnimationSingleProduct: AssetProduct = {
  id: "mg-animation-single",
  mode: "mg_animation_video",
  title: "MG 动效视频",
  status: "待渲染 · MG动画",
  summary: "用 MG 动效解释税费透明流程，包含标题、动效入场和品牌色。",
  ratio: "16:9",
  duration: "30s",
  phase: "待渲染",
  version: "v1",
  sections: [
    { label: "模板", title: "现代商务", detail: "简约白底 + 品牌色强调", status: "已选择" },
    { label: "标题", title: "税费透明流程", detail: "MG 动画主标题", status: "已确认" },
    { label: "动效", title: "fadeSlideUp", detail: "标题从下往上淡入", status: "已配置" },
    { label: "渲染", title: "Modal 适配器", detail: "部署后可渲染为视频文件", status: "待适配" }
  ],
  timeline: [],
  actions: ["配置渲染", "改入场动效", "换成红色", "精细调整"],
  metadata: {
    mg_scene: {
      template: "现代商务",
      durationInSeconds: 30,
      layout: "16:9",
      params: {
        title: "税费透明帮你减少弃单和售后摩擦",
        accentColor: "#2563eb",
        entrance: "fadeSlideUp"
      }
    }
  }
};

const mgAnimationBatchProduct: AssetProduct = {
  id: "mg-animation-batch",
  mode: "mg_animation_video",
  title: "MG 动效方案集",
  status: "已生成 · 3 个方案",
  summary: "一次性生成 3 套 MG 动效方案，分别针对不同客户场景。",
  ratio: "16:9",
  duration: "30s × 3",
  phase: "可选择方案",
  version: "v1",
  sections: [
    { label: "方案一", title: "现代商务", detail: "蓝色商务风格", status: "已生成" },
    { label: "方案二", title: "创意活力", detail: "橙色动感风格", status: "已生成" },
    { label: "方案三", title: "极简白", detail: "黑白极简风格", status: "已生成" }
  ],
  timeline: [],
  actions: ["选择方案一", "选择方案二", "选择方案三", "全部渲染"],
  metadata: {
    mg_scenes: [
      {
        template: "现代商务",
        durationInSeconds: 30,
        layout: "16:9",
        params: {
          title: "税费透明帮你减少弃单和售后摩擦",
          accentColor: "#2563eb",
          entrance: "fadeSlideUp"
        }
      },
      {
        template: "创意活力",
        durationInSeconds: 25,
        layout: "16:9",
        params: {
          title: "让买家在付款前看清每一笔费用",
          accentColor: "#f97316",
          entrance: "scaleIn"
        }
      },
      {
        template: "极简白",
        durationInSeconds: 35,
        layout: "9:16",
        params: {
          title: "Duties & Import Taxes — 你需要知道的变化",
          accentColor: "#1f2937",
          entrance: "slideRight"
        }
      }
    ]
  }
};

const conversationRows: AssetConversation[] = [
  {
    id: "market-rule",
    title: "市场规则变化内容包",
    type: "LinkedIn 发帖文案",
    updatedAt: "今天",
    assetLabel: "市场规则变化素材包",
    status: "知识素材 · 成功",
    prompt: "把这份政策素材转成面向独立站客户的 LinkedIn 内容。",
    response: "我会保留来源证据，输出判断、卖点角度和一版可直接编辑的英文帖文。",
    canvasTitle: "市场规则变化素材包",
    canvasMeta: "知识素材 · 成功 · v3",
    raw: `# 市场规则变化素材包

- 来源：平台公告与公开政策页面
- 判断：税费展示从后台合规问题变成买家体验问题
- 可复用：LinkedIn 发帖、销售话术、短视频口播

## 证据
官方页面新增 checkout duties 展示说明，影响跨境独立站落地成本...`,
    judgment: "税费展示从后台合规问题变成 checkout 和 landed cost 体验问题。跨境独立站可以更早展示税费，减少签收和退货摩擦。",
    action: "检查 Shopify 店铺是否启用 Duties and Import Taxes，并按目的国、原产国验证毛利测算。",
    delivery: "已生成一版 LinkedIn 发帖文案，并保留来源证据和判断链路。你可以继续说：改得更专业一点、拆成 60 秒短视频、生成一张 4:5 配图，或把 CTA 改成销售咨询口吻。",
    suggestions: ["改得更专业一点", "拆成60秒视频", "生成4:5配图"],
    messages: [
      { role: "user", text: "把这份政策素材转成面向独立站客户的 LinkedIn 内容。" },
      { role: "assistant", text: "我会先把来源素材沉淀成内容包，再生成一版可以直接编辑的 LinkedIn 帖文，并保留证据、判断和 CTA。" },
      { role: "user", text: "语气专业一点，面向跨境服务商客户，不要像泛泛的新闻总结。" },
      {
        role: "assistant",
        text: "好的。我看了这份素材，给你拆了一个方案，确认后开始生成：",
        plan: {
          title: "文案生成方案",
          status: "confirmed",
          subtitle: "都可以改——点「调整方向」或直接在下面输入框里说",
          fields: [
            { key: "platform", label: "平台", value: "LinkedIn" },
            { key: "style", label: "风格", value: "专业克制 · 面向跨境服务商" },
            { key: "structure", label: "结构", value: "证据 → 判断 → 可执行建议" },
            { key: "source", label: "来源", value: "市场规则变化素材包" }
          ],
          summaryFields: [
            { key: "platform", label: "平台", value: "LinkedIn · 专业克制" },
            { key: "structure", label: "结构", value: "证据 → 判断 → 可执行建议" }
          ],
          confirmUtterance: "确认，按这个方案生成 LinkedIn 文案。"
        }
      },
      { role: "assistant", text: "已生成两个产物：一个是市场规则变化内容包，另一个是 LinkedIn 发帖文案。内容包负责承接证据和判断，帖文负责面向客户表达。" },
      { role: "assistant", text: "你可以继续说：改得更专业一点、拆成 60 秒短视频、生成一张 4:5 配图，或把 CTA 改成销售咨询口吻。", suggestions: ["改得更专业一点", "拆成60秒视频", "生成4:5配图"] }
    ],
    product: marketRuleProduct,
    products: [marketRulePackProduct, marketRuleProduct]
  },
  {
    id: "cover-image",
    title: "封面图生成测试",
    type: "图片",
    updatedAt: "今天",
    assetLabel: "市场规则变化素材包",
    status: "知识素材 · 成功",
    prompt: "基于当前素材生成 3 张 4:5 封面图，风格要白色商务、适合 LinkedIn。",
    response: "我会把来源证据转成画面参考，生成封面图方向，并保留标题、比例和主体风格的可调整入口。",
    canvasTitle: "4:5 封面图",
    canvasMeta: "图片 · 已生成",
    raw: "",
    judgment: "图片重点不是复述政策，而是让用户一眼看到规则变化和买家成本透明的关系。",
    action: "先确认标题和主体风格，再重绘或扩展成 9:16 竖版封面。",
    delivery: "已生成 3 张 4:5 封面图方向。你可以继续说：换成 9:16、标题更醒目、改成产品图风格，或减少画面文字。",
    suggestions: ["换成9:16", "标题更醒目", "减少画面文字"],
    messages: [
      { role: "user", text: "基于当前素材生成 3 张 4:5 封面图，风格要白色商务、适合 LinkedIn。" },
      { role: "assistant", text: "我会把市场规则变化内容包转成封面图方向，保留标题、主体、比例和可重绘参数，不直接伪造平台 UI。" },
      { role: "user", text: "画面要能表达税费透明影响转化，不要太像广告海报。" },
      { role: "assistant", text: "已生成 3 个封面方向：白色商务主标题、数据标签信息图、客户咨询场景。右侧展示当前 4:5 图片产物。" },
      { role: "assistant", text: "你可以继续说：换成 9:16、标题更醒目、改成产品图风格，或减少画面文字。", suggestions: ["换成9:16", "标题更醒目", "减少画面文字"] }
    ],
    product: imageCoverProduct,
    products: [marketRulePackProduct, imageCoverProduct]
  },
  {
    id: "mg-animation",
    title: "MG动画说明视频",
    type: "MG 动画",
    updatedAt: "今天",
    assetLabel: "市场规则变化素材包",
    status: "知识素材 · 成功",
    prompt: "把规则变化做成 45 秒 MG 动画说明视频，用图标和流程解释影响。",
    response: "我会把素材拆成问题、变化、影响和建议四段，并生成动效提示，不直接进入复杂参数配置。",
    canvasTitle: "MG 动画说明视频",
    canvasMeta: "视频 · 动效指令",
    raw: "",
    judgment: "MG 动画适合解释抽象规则变化，用流程图和标签比真人口播更容易让小白理解。",
    action: "确认比例和动效复杂度后，再生成分镜图或转成短视频脚本。",
    delivery: "已生成 45 秒 MG 动画脚本和动效指令。你可以继续说：改成 9:16、减少动效、生成分镜图，或把语气改得更轻松。",
    suggestions: ["改成9:16", "减少动效", "生成分镜图"],
    messages: [
      { role: "user", text: "把规则变化做成 45 秒 MG 动画说明视频，用图标和流程解释影响。" },
      { role: "assistant", text: "我会把内容拆成问题、变化、影响和建议四段，用费用标签、路径箭头和信息卡表达，不让你先配置复杂参数。" },
      { role: "user", text: "最好让小白也能看懂 checkout duties 和 landed cost 的关系。" },
      { role: "assistant", text: "已生成 MG 动画说明视频产物，包含四段分镜、动效提示和画面缩略预览。" },
      { role: "assistant", text: "你可以继续说：改成 9:16、减少动效、生成分镜图，或把语气改得更轻松。", suggestions: ["改成9:16", "减少动效", "生成分镜图"] }
    ],
    product: mgAnimationProduct,
    products: [marketRulePackProduct, mgAnimationProduct]
  },
  {
    id: "platform-policy",
    title: "6月平台政策摘录",
    type: "内容方案",
    updatedAt: "昨天",
    assetLabel: "6月平台政策摘录",
    status: "知识素材 · 成功",
    prompt: "整理成给外贸运营团队看的月度选题方向。",
    response: "已按变化、影响对象和可复用内容角度归纳成内容计划草稿。",
    canvasTitle: "6月平台政策摘录",
    canvasMeta: "内容方案 · 草稿 · v1",
    raw: `# 6月平台政策摘录

- 主题：平台规则、跨境支付、物流和售后体验
- 输出：选题方向、销售开场、短视频角度

## 内容方向
围绕买家信任、成本透明和交付确定性组织素材。`,
    judgment: "平台政策的变化可以转化为客户沟通话题，重点不是复述公告，而是解释它如何影响采购决策。",
    action: "优先生成一组英文 LinkedIn 选题，再扩展成销售邮件开场。",
    delivery: "已整理成月度内容方案草稿。你可以继续说：优先生成 LinkedIn 帖文、把第 3 个选题改成邮件开场、按客户行业重新排序，或挑 2 个选题做成短视频。",
    suggestions: ["生成3条帖文", "改成邮件开场", "挑2个做短视频"],
    messages: [
      { role: "user", text: "整理成给外贸运营团队看的月度选题方向。" },
      { role: "assistant", text: "我会把政策摘录整理成可复用选题，而不是简单摘要，重点保留变化、影响对象和可转化内容角度。" },
      { role: "user", text: "先不要生成完整文章，先给我可挑选的方向。" },
      { role: "assistant", text: "已生成月度内容方案草稿，包含买家信任、成本透明、支付体验和交付确定性等方向。" },
      { role: "assistant", text: "你可以继续说：生成 3 条帖文、改成邮件开场、按客户行业重新排序，或挑 2 个做短视频。", suggestions: ["生成3条帖文", "改成邮件开场", "挑2个做短视频"] }
    ],
    product: policyPlanProduct,
    products: [policyPlanProduct]
  },
  {
    id: "video-script",
    title: "短视频分镜脚本",
    type: "视频脚本",
    updatedAt: "07/06",
    assetLabel: "短视频分镜脚本",
    status: "视频脚本 · 成功",
    prompt: "把当前内容包拆成 60 秒口播和四段分镜。",
    response: "已生成开场、证据、判断和 CTA 四段结构，右侧可继续编辑脚本。",
    canvasTitle: "短视频分镜脚本",
    canvasMeta: "视频脚本 · 成功 · v2",
    raw: `# 短视频分镜脚本

01 开场：很多独立站把税费当成后台问题。
02 证据：平台正在强化 checkout 阶段的费用透明。
03 判断：这会影响转化率和退货摩擦。
04 CTA：检查你的 landed cost 展示链路。`,
    judgment: "视频内容应先提出运营误区，再用来源变化支撑判断，最后落到可执行检查项。",
    action: "确认分镜后再生成封面图和分镜图提示词。",
    delivery: "已生成 60 秒短视频分镜，并匹配口播节奏、素材位置和字幕检查项。你可以继续说：缩短到 30 秒、把第 2 段素材换成产品图、改成数字人口播，或字幕更大一点。",
    suggestions: ["缩短到30秒", "换成数字人", "字幕更大一点"],
    messages: [
      { role: "user", text: "把当前内容包拆成 60 秒口播和四段分镜。" },
      { role: "assistant", text: "我会沿用内容包里的证据和判断，把它拆成开场、来源证据、业务判断和行动建议四段。" },
      { role: "user", text: "要能直接给剪辑或数字人后续使用。" },
      {
        role: "assistant",
        text: "已生成 60 秒短视频分镜，包含脚本、素材位置、字幕检查项和时间轴。",
        runSteps: [
          { key: "understand", label: "理解 3 张素材的画面与可用场景", status: "done", elapsedLabel: "0.8s" },
          { key: "plan", label: "锁定开场 / 证据 / 判断 / CTA 四段结构", status: "done", elapsedLabel: "1.2s" },
          { key: "match", label: "为每段匹配素材，第 4 段用兜底画面", status: "done", elapsedLabel: "3.6s" },
          { key: "voice", label: "按分镜生成 60 秒口播节奏与字幕", status: "done", elapsedLabel: "5.4s" },
          { key: "assemble", label: "组装时间轴并检查移动端字幕", status: "done", elapsedLabel: "3.4s" }
        ]
      },
      { role: "assistant", text: "你可以继续说：缩短到 30 秒、把第 2 段素材换成产品图、改成数字人口播，或字幕更大一点。", suggestions: ["缩短到30秒", "换成数字人", "字幕更大一点"] }
    ],
    product: videoScriptProduct,
    products: [marketRuleProduct, videoScriptProduct]
  },
  {
    id: "finished-video",
    title: "短视频成片浏览",
    type: "视频成片",
    updatedAt: "07/06",
    assetLabel: "短视频分镜脚本",
    status: "成片 · 成功",
    prompt: "把分镜脚本渲染成可预览的成片。",
    response: "成片已生成，右侧可以直接播放、点分镜跳转，或进入编辑微调。",
    canvasTitle: "60 秒短视频成片",
    canvasMeta: "成片 · 成功 · v2",
    raw: "# 60 秒短视频成片\n\n成片已渲染完成，可在右侧播放器预览，点分镜卡跳转到对应片段，或点「编辑」进入剪辑器微调。",
    judgment: "成片浏览态用于快速确认节奏与素材，细调仍回到剪辑器。",
    action: "确认成片后可导出，或继续在对话里调整某一段。",
    delivery: "成片已生成。可以直接播放预览、点任意分镜跳转，或说：把第 4 段兜底画面换成产品实拍、导出成片。",
    suggestions: ["换掉第4段兜底画面", "导出成片", "改成数字人口播"],
    messages: [
      { role: "user", text: "把分镜脚本渲染成可预览的成片。" },
      {
        role: "assistant",
        text: "成片已渲染完成，右侧可以直接播放、点分镜卡跳转，或点「编辑」进剪辑器微调。",
        runSteps: [
          { key: "assemble", label: "按分镜组装素材与口播轨", status: "done", elapsedLabel: "4.1s" },
          { key: "render", label: "渲染 9:16 成片并压制字幕", status: "done", elapsedLabel: "12.7s" },
          { key: "check", label: "校验时长与移动端字幕安全区", status: "done", elapsedLabel: "1.5s" }
        ]
      },
      { role: "assistant", text: "可以直接播放预览、点任意分镜跳转，或说：把第 4 段兜底画面换成产品实拍、导出成片。", suggestions: ["换掉第4段兜底画面", "导出成片", "改成数字人口播"] }
    ],
    product: finishedVideoProduct,
    products: [finishedVideoProduct]
  },
  {
    id: "real-scene",
    title: "实景讲解视频",
    type: "实景视频",
    updatedAt: "07/05",
    assetLabel: "市场规则变化素材包",
    status: "知识素材 · 成功",
    prompt: "把这条内容做成一个真实拍摄的短视频方案，适合顾问出镜。",
    response: "我会把脚本转成实景拍摄方案，包含出镜口播、屏幕录制、B-roll 和素材插入点。",
    canvasTitle: "实景讲解视频",
    canvasMeta: "视频 · 拍摄清单",
    raw: "",
    judgment: "实景视频适合建立顾问可信度，重点是让用户看到人和证据，而不是抽象动画。",
    action: "确认是否真人出镜、是否需要屏幕录制，再继续生成拍摄清单或镜头脚本。",
    delivery: "已生成实景讲解视频方案。你可以继续说：改成横屏、减少出镜、补拍摄清单，或把第 2 段换成产品演示。",
    suggestions: ["改成横屏", "减少出镜", "补拍摄清单"],
    messages: [
      { role: "user", text: "把这条内容做成一个真实拍摄的短视频方案，适合顾问出镜。" },
      { role: "assistant", text: "我会沿用内容包和短视频脚本，把它转成出镜口播、屏幕录制、桌面 B-roll 和素材插入点。" },
      { role: "user", text: "要看起来像外贸服务商顾问在解释客户问题，不要像娱乐短视频。" },
      { role: "assistant", text: "已生成实景讲解视频方案，包含镜头、拍摄清单、素材分配和 50 秒时间轴。" },
      { role: "assistant", text: "你可以继续说：改成横屏、减少出镜、补拍摄清单，或把第 2 段换成产品演示。", suggestions: ["改成横屏", "减少出镜", "补拍摄清单"] }
    ],
    product: realSceneVideoProduct,
    products: [marketRulePackProduct, realSceneVideoProduct]
  },
  {
    id: "text-to-video",
    title: "文生视频概念预览",
    type: "文生视频",
    updatedAt: "07/05",
    assetLabel: "市场规则变化素材包",
    status: "知识素材 · 成功",
    prompt: "基于素材生成一个 12 秒文生视频提示词，画面表现 landed cost 从模糊到清晰。",
    response: "我会把文字判断转成视频模型可读的视觉提示词，同时约束不要伪造真实平台 UI 或品牌标识。",
    canvasTitle: "文生视频概念预览",
    canvasMeta: "提示词 · 待渲染",
    raw: "",
    judgment: "文生视频更适合做概念视觉，不适合承载来源证据本身；证据链应保留在详情中。",
    action: "确认比例、风格和是否需要真实产品元素后，再交给视频生成模型。",
    delivery: "已生成文生视频概念预览和提示词。你可以继续说：改成 9:16、更商务、减少抽象感，或加入产品图作为参考。",
    suggestions: ["改成9:16", "更商务", "减少抽象感"],
    messages: [
      { role: "user", text: "基于素材生成一个 12 秒文生视频提示词，画面表现 landed cost 从模糊到清晰。" },
      { role: "assistant", text: "我会把规则变化转成视觉隐喻，用费用标签、checkout 路径和清晰化过程表达，不直接生成虚假的平台页面。" },
      { role: "user", text: "先做概念预览，后面再看接哪个视频模型。" },
      { role: "assistant", text: "已生成文生视频概念预览，包含正向提示词、负向约束、三段时间轴和缩略帧。" },
      { role: "assistant", text: "你可以继续说：改成 9:16、更商务、减少抽象感，或加入产品图作为参考。", suggestions: ["改成9:16", "更商务", "减少抽象感"] }
    ],
    product: textToVideoProduct,
    products: [marketRulePackProduct, textToVideoProduct]
  },
  {
    id: "digital-human",
    title: "数字人口播视频",
    type: "数字人",
    updatedAt: "07/04",
    assetLabel: "短视频分镜脚本",
    status: "视频脚本 · 成功",
    prompt: "把这条脚本转成 9:16 数字人口播视频，并匹配字幕。",
    response: "我会把数字人当作视频的一种表现形式，使用已保存的口播文案生成预览、人设、背景和字幕时间轴。",
    canvasTitle: "数字人口播视频",
    canvasMeta: "数字人视频 · 待渲染",
    raw: "",
    judgment: "数字人适合稳定解释类内容；默认画面优先展示口播视频本身，来源链路和证据保留在详情中。",
    action: "确认人设、字幕语言和逐句口播后，再触发支持的渲染适配器。",
    delivery: "已生成数字人口播视频方案。右侧上方是采用的口播文案，下方音轨展示每句话的时间匹配。你可以继续说：换女性商务人设、改成英文字幕、调整某一句，或压缩到 30 秒。",
    suggestions: ["换女性商务人设", "改成英文字幕", "调整某一句"],
    messages: [
      { role: "user", text: "把这条脚本转成 9:16 数字人口播视频，并匹配字幕。" },
      { role: "assistant", text: "我会把数字人当作视频的一种表现形式，基于已保存的口播脚本生成预览、人设、背景和字幕时间轴。" },
      { role: "user", text: "文案直接显示在口播视频上方，具体每句话说什么放在下方音轨里。" },
      { role: "assistant", text: "已按这个结构生成数字人口播视频方案：上方是可展开的口播稿，中间是视频预览，下方是逐句音轨和字幕匹配。" },
      { role: "assistant", text: "你可以继续说：换女性商务人设、改成英文字幕、调整某一句，或压缩到 30 秒。", suggestions: ["换女性商务人设", "改成英文字幕", "调整某一句"] }
    ],
    product: digitalHumanProduct,
    products: [videoScriptProduct, digitalHumanProduct]
  },
  {
    id: "multi-version",
    title: "多版本文案测试",
    type: "版本管理",
    updatedAt: "07/03",
    assetLabel: "LinkedIn 发帖文案",
    status: "文案 · 多版本",
    prompt: "把这条 LinkedIn 文案继续改三轮，保留每一版。",
    response: "我会把每轮调整保存为版本，右侧展示当前版本，详情里保留版本和可回滚信息。",
    canvasTitle: "LinkedIn 发帖文案 v3",
    canvasMeta: "文案 · 已保存 · 多版本",
    raw: "",
    judgment: "多版本场景用于验证用户反复通过自然语言调整后，产物如何保存、回看和继续编辑。",
    action: "保留 v1/v2/v3，并支持继续生成 v4 或回滚到旧版。",
    delivery: "已保存 v1、v2、v3 三个版本，当前展示 v3。你可以继续说：回到 v2、继续缩短、换 CTA，或保存新版本。",
    suggestions: ["回到v2", "继续缩短", "换CTA"],
    messages: [
      { role: "user", text: "把这条 LinkedIn 文案继续改三轮，保留每一版。" },
      { role: "assistant", text: "我会把完整解释版保存为 v1，再根据你的要求生成专业克制版和短版 CTA。" },
      { role: "user", text: "第二版更专业一点，第三版缩短并强调本周检查动作。" },
      { role: "assistant", text: "已保存 v1、v2、v3。右侧当前展示 v3，详情中保留版本信息和可回滚状态。" },
      { role: "assistant", text: "你可以继续说：回到 v2、继续缩短、换 CTA，或保存新版本。", suggestions: ["回到v2", "继续缩短", "换CTA"] }
    ],
    product: multiVersionCopyProduct,
    products: [marketRuleProduct, multiVersionCopyProduct]
  },
  {
    id: "product-chain",
    title: "文案到视频链路",
    type: "多产物链路",
    updatedAt: "07/03",
    assetLabel: "市场规则变化内容包",
    status: "多产物 · 已生成",
    prompt: "在同一个对话里，先生成文案，再生成封面图，最后转成视频。",
    response: "我会把每次生成的产物都放到对话产物卡里，点击卡片切换右侧当前产物，不在右侧增加复杂 Tab。",
    canvasTitle: "文案到视频链路",
    canvasMeta: "多产物 · 可切换",
    raw: "",
    judgment: "多产物链路场景用于验证一个对话内的上下游产物切换，以及右侧只展示当前选中产物。",
    action: "用对话中的产物卡切换文案、图片、分镜和数字人方案。",
    delivery: "已在同一对话中生成内容包、文案、封面图、短视频分镜和数字人口播方案。你可以点击任一产物卡查看右侧结果。",
    suggestions: ["查看封面图", "切到视频分镜", "生成新版本"],
    messages: [
      { role: "user", text: "在同一个对话里，先生成文案，再生成封面图，最后转成视频。" },
      { role: "assistant", text: "我会保留每一步产物的上下游关系，但右侧只展示当前选中的产物。" },
      { role: "user", text: "不要在展示区放很多 Tab，就用对话里的产物卡切换。" },
      { role: "assistant", text: "已生成一条完整链路：内容包、LinkedIn 文案、封面图、短视频分镜、数字人口播方案。" },
      { role: "assistant", text: "你可以点击产物卡切换，也可以继续说：查看封面图、切到视频分镜、生成新版本。", suggestions: ["查看封面图", "切到视频分镜", "生成新版本"] }
    ],
    product: digitalHumanProduct,
    products: [marketRulePackProduct, marketRuleProduct, imageCoverProduct, videoScriptProduct, digitalHumanProduct]
  },
  {
    id: "failed-generation",
    title: "失败与重试测试",
    type: "失败状态",
    updatedAt: "07/02",
    assetLabel: "市场规则变化素材包",
    status: "图片 · 失败",
    prompt: "生成一张封面图，如果失败也要告诉我为什么以及怎么改。",
    response: "我会保留失败状态、提示词和已确认参数，不会把失败结果伪装成成功产物。",
    canvasTitle: "封面图生成失败",
    canvasMeta: "图片 · 可重试",
    raw: "",
    judgment: "失败状态需要清楚展示原因和下一步，而不是只显示空白或假成功。",
    action: "建议减少抽象隐喻，改成更明确的信息图或结账路径画面后重试。",
    delivery: "封面图生成失败，已保留标题、比例和风格参数。你可以继续说：重试生成、减少抽象感、换成信息图。",
    suggestions: ["重试生成", "减少抽象感", "换成信息图"],
    messages: [
      { role: "user", text: "生成一张封面图，如果失败也要告诉我为什么以及怎么改。" },
      { role: "assistant", text: "我会在失败时保留任务上下文，展示失败原因和可重试建议。" },
      { role: "assistant", text: "封面图生成失败：画面主体过于抽象，无法稳定表达税费透明和 checkout 关系。" },
      { role: "assistant", text: "建议减少抽象隐喻，改成费用标签、结账路径或信息图。", suggestions: ["重试生成", "减少抽象感", "换成信息图"] }
    ],
    product: failedImageProduct,
    products: [marketRulePackProduct, failedCopyProduct, failedImageProduct]
  },
  {
    id: "processing-render",
    title: "视频渲染处理中",
    type: "处理中",
    updatedAt: "07/02",
    assetLabel: "短视频分镜脚本",
    status: "视频 · 处理中",
    prompt: "触发视频渲染，但渲染可能需要等待。",
    response: "我会展示处理中状态和当前步骤，不把未完成任务展示成成片。",
    canvasTitle: "短视频渲染中",
    canvasMeta: "视频 · 42%",
    raw: "",
    judgment: "处理中状态应让用户知道任务还活着、现在在哪一步、能做什么操作。",
    action: "继续等待、取消任务，或回退到人工剪辑方案。",
    delivery: "视频渲染任务已创建，目前 42%。你可以继续说：继续等待、取消任务、改成人工剪辑。",
    suggestions: ["继续等待", "取消任务", "改成人工剪辑"],
    messages: [
      { role: "user", text: "触发视频渲染，但渲染可能需要等待。" },
      { role: "assistant", text: "我会把视频任务作为处理中产物展示，保留输入素材和当前步骤。" },
      { role: "assistant", text: "任务已创建，目前正在生成首帧预览，进度 42%。" },
      { role: "assistant", text: "你可以继续说：继续等待、取消任务、改成人工剪辑。", suggestions: ["继续等待", "取消任务", "改成人工剪辑"] }
    ],
    product: processingVideoProduct,
    products: [videoScriptProduct, processingVideoProduct]
  },
  {
    id: "source-conflict",
    title: "素材冲突确认",
    type: "冲突状态",
    updatedAt: "07/01",
    assetLabel: "平台公告 + 帮助页",
    status: "来源 · 冲突",
    prompt: "两个来源对适用范围说法不一致，不要自动决定。",
    response: "我会把冲突做成待确认产物，要求你选择采用哪种表达或同时保留适用范围。",
    canvasTitle: "素材冲突确认卡",
    canvasMeta: "文案 · 待确认",
    raw: "",
    judgment: "冲突素材不能被自动合并成单一事实，需要让用户决定适用范围。",
    action: "建议对外采用谨慎表达，同时在详情里保留两个来源的差异。",
    delivery: "发现来源冲突：公告和帮助页对适用范围描述不一致。你可以继续说：采用谨慎表达、同时保留、只采用来源 B。",
    suggestions: ["采用谨慎表达", "同时保留", "只采用来源B"],
    messages: [
      { role: "user", text: "两个来源对适用范围说法不一致，不要自动决定。" },
      { role: "assistant", text: "我会把冲突做成待确认产物，并把来源差异放进详情，不自动覆盖旧结论。" },
      { role: "assistant", text: "发现冲突：来源 A 表述更强，来源 B 范围更窄。建议对外采用谨慎表达。" },
      { role: "assistant", text: "你可以继续说：采用谨慎表达、同时保留、只采用来源 B。", suggestions: ["采用谨慎表达", "同时保留", "只采用来源B"] }
    ],
    product: conflictBriefProduct,
    products: [conflictBriefProduct]
  },
  {
    id: "multi-source",
    title: "多素材组合视频",
    type: "多素材",
    updatedAt: "07/01",
    assetLabel: "文案 + 图片 + 音频 + 来源",
    status: "视频 · 多素材",
    prompt: "把文案、封面图、音频和政策摘录组合成一个视频。",
    response: "我会把多素材分配到视频时间轴里，右侧展示当前组合视频，详情中列出素材映射。",
    canvasTitle: "多素材组合视频",
    canvasMeta: "视频 · 已生成",
    raw: "",
    judgment: "多素材组合需要展示每个素材在产物中的用途，而不是只显示最终视频。",
    action: "可替换封面、音频或来源图，并继续保持时间轴匹配。",
    delivery: "已生成多素材组合视频，引用文案、封面图、音频时间轴和政策摘录。你可以继续说：替换封面、换音频、移除来源图。",
    suggestions: ["替换封面", "换音频", "移除来源图"],
    messages: [
      { role: "user", text: "把文案、封面图、音频和政策摘录组合成一个视频。" },
      { role: "assistant", text: "我会把每类素材放到视频时间轴里，并在详情里保留素材映射。" },
      { role: "assistant", text: "已生成多素材组合视频，封面、口播、来源截图和字幕都已分配。" },
      { role: "assistant", text: "你可以继续说：替换封面、换音频、移除来源图。", suggestions: ["替换封面", "换音频", "移除来源图"] }
    ],
    product: multiSourceVideoProduct,
    products: [marketRuleProduct, imageCoverProduct, audioSyncProduct, multiSourceVideoProduct]
  },
  {
    id: "brand-context",
    title: "客户品牌约束",
    type: "品牌上下文",
    updatedAt: "06/30",
    assetLabel: "客户 A 品牌要求",
    status: "文案 · 品牌约束",
    prompt: "给 B2B 出口制造商客户写一版，目标市场是欧盟采购商，语气要克制。",
    response: "我会把客户行业、目标市场、语气和禁用词作为详情参数，同时右侧直接展示生成文案。",
    canvasTitle: "客户品牌约束文案",
    canvasMeta: "文案 · 已生成",
    raw: "",
    judgment: "品牌上下文会显著影响内容表达，应该作为产物详情而不是单独配置页。",
    action: "可切换行业、渠道、语气或禁用词后生成新版本。",
    delivery: "已按客户 A 的品牌约束生成文案。你可以继续说：换行业、改成邮件、更像 CEO 语气。",
    suggestions: ["换行业", "改成邮件", "更像CEO语气"],
    messages: [
      { role: "user", text: "给 B2B 出口制造商客户写一版，目标市场是欧盟采购商，语气要克制。" },
      { role: "assistant", text: "我会应用客户行业、目标市场、品牌语气和禁用词，不把这些配置放在主展示区占空间。" },
      { role: "assistant", text: "已生成客户品牌约束文案，详情中保留客户、语气、禁用词和渠道信息。" },
      { role: "assistant", text: "你可以继续说：换行业、改成邮件、更像 CEO 语气。", suggestions: ["换行业", "改成邮件", "更像CEO语气"] }
    ],
    product: brandGuidelineProduct,
    products: [brandGuidelineProduct]
  },
  {
    id: "adapter-handoff",
    title: "渲染适配器交接",
    type: "外部工具",
    updatedAt: "06/30",
    assetLabel: "数字人口播视频方案",
    status: "待配置 · 适配器",
    prompt: "把数字人视频交给外部工具渲染，如果没配置就说明状态。",
    response: "我会展示输入已准备好、适配器未配置的状态，不创建假的渲染结果。",
    canvasTitle: "渲染适配器交接",
    canvasMeta: "数字人 · 待配置",
    raw: "",
    judgment: "外部工具未配置时，应保留可导出的输入和清晰状态，而不是阻塞整个产物工作区。",
    action: "配置适配器、导出参数，或改成人工剪辑流程。",
    delivery: "数字人渲染输入已准备好，但当前未配置适配器。你可以继续说：配置适配器、导出参数、改成人工剪辑。",
    suggestions: ["配置适配器", "导出参数", "改成人工剪辑"],
    messages: [
      { role: "user", text: "把数字人视频交给外部工具渲染，如果没配置就说明状态。" },
      { role: "assistant", text: "我会检查脚本、字幕、人设和比例是否就绪，再展示适配器交接状态。" },
      { role: "assistant", text: "输入已准备好，但当前未配置数字人渲染适配器，因此不会创建假成片。" },
      { role: "assistant", text: "你可以继续说：配置适配器、导出参数、改成人工剪辑。", suggestions: ["配置适配器", "导出参数", "改成人工剪辑"] }
    ],
    product: adapterHandoffProduct,
    products: [digitalHumanProduct, adapterHandoffProduct]
  },
  {
    id: "no-source",
    title: "无素材直创",
    type: "无来源",
    updatedAt: "06/29",
    assetLabel: "未关联素材",
    status: "草稿 · 无来源",
    prompt: "不选素材，先帮我写一版 LinkedIn 草稿。",
    response: "可以先写，但我会明确标记为未关联来源，不能当作证据支持内容。",
    canvasTitle: "无素材直创草稿",
    canvasMeta: "文案 · 未关联来源",
    raw: "",
    judgment: "无素材直创可以用于试方向，但必须和证据型内容区分。",
    action: "建议后续关联素材包，再补证据和判断链。",
    delivery: "已生成无素材草稿。你可以继续说：关联素材、继续写、改成视频脚本。",
    suggestions: ["关联素材", "继续写", "改成视频脚本"],
    messages: [
      { role: "user", text: "不选素材，先帮我写一版 LinkedIn 草稿。" },
      { role: "assistant", text: "可以先写，但我会把产物标记为未关联来源，避免误认为有证据支撑。" },
      { role: "assistant", text: "已生成无素材直创草稿，右侧可编辑和保存，但建议后续关联素材包。" },
      { role: "assistant", text: "你可以继续说：关联素材、继续写、改成视频脚本。", suggestions: ["关联素材", "继续写", "改成视频脚本"] }
    ],
    product: noSourceDraftProduct,
    products: [noSourceDraftProduct]
  },
  {
    id: "long-content",
    title: "长内容压力测试",
    type: "长内容",
    updatedAt: "06/29",
    assetLabel: "市场规则变化素材包",
    status: "文案 · 长内容",
    prompt: "生成一篇很长的结构化文案，用来测试展示区不要遮挡。",
    response: "我会生成长段落和多章节内容，右侧展示完整可编辑结果，用于检查长内容滚动和保存体验。",
    canvasTitle: "长文案压力测试",
    canvasMeta: "文案 · 长内容",
    raw: "",
    judgment: "长内容压力测试用于验证右侧展示区在大量文本下仍可完整查看、编辑和保存。",
    action: "可拆成多条帖子、压缩到短文或生成目录。",
    delivery: "已生成长文案压力测试产物。你可以继续说：拆成 3 条帖文、压缩到 800 字、生成目录。",
    suggestions: ["拆成3条帖文", "压缩到800字", "生成目录"],
    messages: [
      { role: "user", text: "生成一篇很长的结构化文案，用来测试展示区不要遮挡。" },
      { role: "assistant", text: "我会生成长段落、多章节和较长编辑区，测试右侧是否能完整显示。" },
      { role: "assistant", text: "已生成长文案压力测试产物，右侧展示完整正文和可编辑内容。" },
      { role: "assistant", text: "你可以继续说：拆成 3 条帖文、压缩到 800 字、生成目录。", suggestions: ["拆成3条帖文", "压缩到800字", "生成目录"] }
    ],
    product: longCopyProduct,
    products: [longCopyProduct]
  },
  {
    id: "mg-animation-single",
    title: "MG动效视频生成",
    type: "MG 动效 · 单方案",
    updatedAt: "刚刚",
    assetLabel: "市场规则变化素材包",
    status: "知识素材 · 成功",
    prompt: "把税费透明流程做成一个 30 秒的 MG 动效视频。",
    response: "我会生成 MG 动效 spec，包含模板、标题、品牌色和入场动效，保留预览模式。",
    canvasTitle: "MG 动效视频",
    canvasMeta: "MG动画 · 待渲染",
    raw: "",
    judgment: "MG 动效适合用标准化模板快速生成品牌动态视频。",
    action: "确认模板、标题和品牌色后可触发渲染。",
    delivery: "已生成 MG 动效 spec。你可以继续说：配置渲染、改入场动效、换成红色。",
    suggestions: ["配置渲染", "改入场动效", "换成红色"],
    messages: [
      { role: "user", text: "把税费透明流程做成一个 30 秒的 MG 动效视频。" },
      { role: "assistant", text: "我会生成 MG 动效 spec，用现代商务模板，默认蓝色品牌色和淡入动效。" },
      { role: "assistant", text: "已生成 MG 动效视频 spec，右侧可预览模板、标题、品牌色块、时长和入场动效。" },
      { role: "assistant", text: "你可以继续说：配置渲染、改入场动效、换成红色。", suggestions: ["配置渲染", "改入场动效", "换成红色"] }
    ],
    product: mgAnimationSingleProduct,
    products: [marketRulePackProduct, mgAnimationSingleProduct]
  },
  {
    id: "mg-animation-batch",
    title: "MG动效批量生成",
    type: "MG 动效 · 多方案",
    updatedAt: "刚刚",
    assetLabel: "市场规则变化素材包",
    status: "知识素材 · 成功",
    prompt: "基于税费透明主题，给我生成 3 套不同风格的 MG 动效方案。",
    response: "我会生成 3 套 MG 动效 spec，分别用现代商务、创意活力和极简白模板。",
    canvasTitle: "MG 动效方案集",
    canvasMeta: "MG动画 · 3 个方案",
    raw: "",
    judgment: "多方案批量生成可以帮助用户比较不同风格后再决定渲染。",
    action: "选择其中一套方案或全部渲染。",
    delivery: "已生成 3 套 MG 动效方案。你可以继续说：选择方案一、选择方案二、全部渲染。",
    suggestions: ["选择方案一", "选择方案二", "全部渲染"],
    messages: [
      { role: "user", text: "基于税费透明主题，给我生成 3 套不同风格的 MG 动效方案。" },
      { role: "assistant", text: "我会一次性生成 3 套：现代商务（蓝）、创意活力（橙）、极简白（黑）。" },
      { role: "assistant", text: "已生成 3 套 MG 动效方案，右侧展示每个方案的模板、标题、品牌色、时长和入场动效。" },
      { role: "assistant", text: "你可以继续说：选择方案一、选择方案二、全部渲染。", suggestions: ["选择方案一", "选择方案二", "全部渲染"] }
    ],
    product: mgAnimationBatchProduct,
    products: [marketRulePackProduct, mgAnimationBatchProduct]
  }
];

const newAssetConversation: AssetConversation = {
  id: "new",
  title: "新建对话",
  type: "对话",
  updatedAt: "刚刚",
  assetLabel: "未选择素材",
  status: "可关联资产库、文案库、图片库或视频库",
  prompt: "输入创作需求，或整理资料内容。",
  response: "",
  canvasTitle: "新建对话",
  canvasMeta: "草稿 · 未关联素材",
  raw: `# 新建对话

输入创作需求或资料整理内容后，系统会判断是生成产物、沉淀资料，还是需要先确认方向。`,
  judgment: "当前还没有选定素材。生成结果可以继续编辑，但不会被标记为来源证据支持。",
  action: "输入创作需求或资料整理内容。",
  delivery: "",
  suggestions: ["写一条小红书文案", "生成 9:16 短视频脚本", "做一张封面图", "把好评截图变成种草帖"],
  messages: [
    { role: "assistant", text: "", suggestions: ["写一条小红书文案", "生成 9:16 短视频脚本", "做一张封面图", "把好评截图变成种草帖"] }
  ],
  product: emptyProduct
};


export const mockAssetWorkspaceData: AssetWorkspaceData = {
  conversations: conversationRows,
  newConversation: newAssetConversation,
  workshops: assetWorkshops
};
