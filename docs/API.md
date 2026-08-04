# MultiMix 接口文档

> Status: current
> Owner: frontend
> Last verified: 2026-07-30

本文档描述 MultiMix 内容生成工作台当前前端契约：数据访问层（adapter）、数据类型、共享 helper、组件 props、路由 / URL、认证、环境变量和主要后端接口。生产运行时已经接入真实后端；测试 fixture 只用于自动化测试。

> 产品定位、交互规则与数据边界见 `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`../CLAUDE.md` 与工作区根目录 `../../docs/README.md`。本文聚焦「代码契约」，是开发与后端接入的参考手册。

适用版本：`multimix-web@0.1.0`（Next.js 15 App Router + React 19 + TypeScript strict）。

---

## 1. 架构与数据流

### 1.1 分层

```
真实后端 API         数据访问层（唯一接口边界）        UI 组件层
─────────────        ──────────────────────────       ──────────────
lib/api.ts       →   asset-workspace-adapter.ts   →   components/*.tsx
                           │
                           └── asset-workspace-shared.ts（跨组件 helper / 类型别名）
```

关键约束：

- **生产代码不 import 测试 fixture**。所有运行时数据通过 `assetWorkspaceAdapter` 从真实后端读取。
- API 未配置、加载中、真实空列表和加载失败是明确状态，禁止回退演示数据。
- 目录约定：UI 组件进 `app/assets/components/`，数据 / adapter / 共享 helper 进 `app/assets/lib/`。组件间引用用 `./xxx`，引用 lib 用 `../lib/xxx`。

### 1.2 运行时数据走向

1. `app/page.tsx`（`/`）和 `app/app/assets/page.tsx`（`/app/assets`）都渲染 `<MultiMixApp basePath="..." />`。
2. `multimix-app.tsx` 做 localStorage 自动登录，读取 `searchParams` 中的 `conversation` / `product`，注入 `AssetsWorkspaceClient`。
3. `AssetsWorkspaceClient` 是唯一持状态容器，调用 `assetWorkspaceAdapter` 取数据，向子组件下传 props + 回调。
4. 前端不读取或创建本地 SQLite；测试使用测试目录内的最小 fixture，生产运行时不依赖它们。

### 1.3 文件清单与职责

| 文件 | 层 | 职责 |
| --- | --- | --- |
| `app/page.tsx` | 路由 | `/` → `<MultiMixApp basePath="/">` |
| `app/app/assets/page.tsx` | 路由 | `/app/assets` → `<MultiMixApp basePath="/app/assets">` |
| `app/layout.tsx` | 布局 | 根布局，`<html lang="zh-CN">`，引入 `globals.css`，metadata |
| `app/multimix-app.tsx` | 壳 | 本地认证 + searchParams 注入 |
| `app/assets/components/assets-workspace-client.tsx` | UI | 主壳：全局状态、侧边栏、顶栏、拖拽分栏、布局编排 |
| `app/assets/components/conversation-studio.tsx` | UI | 对话区：消息流、产物卡列表、输入框 |
| `app/assets/components/agent-task-strip.tsx` | UI | 当前 Agent 任务、暂停任务数和返回入口 |
| `app/assets/components/product-workspace.tsx` | UI | 展示区容器：标题、详情抽屉、操作按钮、时间轴 |
| `app/assets/components/product-preview.tsx` | UI | 按 `product.mode` 分发的预览 |
| `app/assets/components/library-workshop.tsx` | UI | 资产库 / 文案库 / 视频库视图 |
| `app/assets/lib/asset-workspace-types.ts` | 数据 | 所有数据类型定义 |
| `app/assets/lib/asset-workspace-empty-data.ts` | 数据 | 未配置或加载前使用的空结构，不含演示内容 |
| `app/assets/lib/asset-workspace-adapter.ts` | 数据 | 数据访问接口（后端接入点） |
| `app/assets/lib/agent-action-poller.ts` | 数据 | 按 conversation/action 隔离的动作轮询与终态对账 |
| `app/assets/lib/asset-workspace-shared.ts` | 数据 | 跨组件类型别名 + 纯 helper |

---

## 2. 数据访问层接口：`AssetWorkspaceAdapter`

定义在 `app/assets/lib/asset-workspace-adapter.ts`。这是 UI 与数据之间唯一的接口边界。导出单例 `assetWorkspaceAdapter`，生产运行时只请求真实后端。

当前 adapter 按职责分为四组：

| 分组 | 当前主要接口 |
| --- | --- |
| 工作台展示 | `listConversations`、`getNewConversation`、`getWorkshop`、`getProductText` |
| 对话与产物 | `loadConversationSummaries`、`loadConversationDetail`、`sendMessage`、`reconcileMessage`、生成任务查询/重试、Agent 动作查询/重试、产物保存和版本恢复 |
| 资源库 | `listLibrary`、`uploadAsset`、网页采集、解析重试、导出/下载/删除、公共素材搜索与导入 |
| 视频工程 | 视频任务查询/重试、质量报告、分镜候选加载与单镜素材替换 |

精确参数和返回类型以 `asset-workspace-adapter.ts` 中的 `AssetWorkspaceAdapter` 为准。产品路径是“编导稿确认 → 对话确认接口创建视频工程 → 查询任务状态”。

### 2.1 对话确认一致性

真实 adapter 的 `sendMessage` 可接收可选 `clientRequestId`，并在
`POST /v1/assets/conversations/messages` 请求体中映射为 UUID
`client_request_id`。确认视频工程时，`ConversationStudio` 为本次点击生成一次
request ID；同一乐观轮次和重试必须复用它。

网络层返回连接错误后，`reconcileMessage({ token, clientRequestId })` 拉取已持久化
会话并按消息 metadata 的同名字段对账：找到则用服务端消息和工程替换乐观消息；找不到
才显示“未提交”，不得额外写入一条正式助手错误消息。这个 request ID 只用于传输对账；
服务端仍以确认语义幂等键保证不会重复创建视频工程。

确认请求同时发送 `X-Request-ID: <clientRequestId>`。后端数据库暂时不可用时返回
HTTP `503`、`code=database_temporarily_unavailable`、`request_id`，以及
`Retry-After` / `X-Request-ID` 响应头；adapter 必须把该契约映射为可对账的连接错误，
继续执行上述 reconciliation，而不是直接显示正式失败消息。

Agent 原子修改确认使用同一消息接口的可选 `agent_confirmation_id`。该 ID 必须来自当前
assistant 确认卡，前端不能自行生成或复用旧 ID；普通输入不发送此字段。

### 2.2 方法详解

#### 对话摘要缓存与按需详情

- `GET /v1/assets/conversations/summaries` 只返回 `id/title/status/metadata/created_at/updated_at`，不返回消息和产物。
- 摘要按账号缓存在浏览器本地，页面先显示最近一次真实摘要，再后台刷新；缓存不保存 token、消息正文或产物正文。
- `GET /v1/assets/conversations/{conversation_id}` 在用户选中对话后加载完整消息、产物和版本。
- `loadConversations` 保留给任务完成刷新与幂等 reconciliation，不再作为首屏列表请求。

#### `listConversations(): AssetConversation[]`
同步快照仍不包含演示对话；首屏历史由真实摘要缓存和 `loadConversationSummaries` 提供，不回退样例。

#### `getNewConversation(): AssetConversation`
返回固定的「新建创作」对话（`id: "new"`）。点击「新建创作」或选中对话不存在时回退到它。

#### `getWorkshop(view): AssetWorkshop`
按视图键（`"assets" | "copy" | "video"`）取对应库视图数据。`view` 不能是 `"conversation"`（类型层已 `Exclude`）。

#### `getProductText(product): string`
把产物转为可复制 / 可保存的纯文本。**规则**：`body` 非空则用 `body`，否则用 `[summary]`，再 `join("\n\n")`。供「复制」按钮使用。

#### `saveProduct(product, token?): Promise<{ version: string; savedAt: string }>`
保存产物（异步）。只有真实 token、API 和后端资产 ID 齐全时才请求后端；否则抛出“未连接后端”，不伪造成功。

### 2.3 真实后端边界

- `loadConversations`、`listLibrary` 和所有写操作只访问真实后端。
- 同步方法只提供空结构和纯展示 helper；不能提供演示内容。
- 失败由调用组件显示可重试状态；不能回退 fixture。
- 服务端密钥（如 `LLM_API`）只能在 adapter 的服务端代码路径使用，**禁止加 `NEXT_PUBLIC_` 前缀**。

---

## 3. 数据类型契约

定义在 `app/assets/lib/asset-workspace-types.ts`。下列内容说明 UI 最常用的核心类型；完整字段和新增结构以该 TypeScript 文件为编译期权威。

### 3.1 枚举 / 联合类型

```ts
type AssetWorkspaceView = "conversation" | "assets" | "copy" | "image" | "video";
type AssetProductMode  = "copy" | "image" | "video" | "audio" | "digital-human" | "mg_animation_video";
```

- `AssetWorkspaceView`：主区域视图。`conversation` = 对话创作模式；其余四个 = 库模式（资产库 / 文案库 / 图片库 / 视频库）。
- `AssetProductMode`：产物类型。决定 `ProductPreview` 的渲染分支。`digital-human` 和 `mg_animation_video` 都是视频表现形式，不是一级资源库。

### 3.2 `AssetProduct`（产物，核心实体）

```ts
type AssetProduct = {
  id: string;                  // 产物唯一 id（对话内唯一）
  mode: AssetProductMode;      // 产物类型，决定预览渲染
  title: string;               // 标题
  status: string;              // 状态文案，如 "已生成 · 有来源" / "生成失败 · 可重试"
  summary: string;             // 摘要；copy 模式无 body 时作为正文兜底
  ratio: string;               // 比例 / 规格，如 "9:16" / "LinkedIn" / "素材包"
  duration: string;            // 时长 / 体量，如 "00:60" / "1,180 字" / "3 张"
  phase: string;               // 阶段文案，如 "脚本 + 分镜" / "渲染中"，显示在详情抽屉
  version?: string;            // 版本号，如 "v1" / "job-042" / "draft"；产物卡右下角展示
  body?: string[];             // 正文段落数组；copy 预览逐段渲染，video/digital-human 部分用
  sections: AssetProductSection[];   // 「内容与可调整项」列表（详情抽屉）
  timeline: AssetProductTimelineItem[]; // 时间轴；空数组则不渲染时间轴
  actions: string[];           // 操作建议标签；部分视图不直接渲染
  sourceIds?: string[];        // 兼容用来源 id
  sourceSummary?: AssetProductSourceSummary; // 当前来源摘要和引用
  segments?: AssetProductSegment[]; // 视频分镜摘要
  versions?: AssetProductVersion[];  // 版本历史；详情区可查看和恢复
  preview?: AssetProductPreview;     // 预览补充数据
  backendAssetId?: number;     // 真实后端资产 id
  videoProjectReady?: boolean; // 共享契约判定的视频工程可编辑状态
  metadata?: Record<string, unknown>;
};
```

字段是否显示取决于产物模式和真实数据是否存在；UI 不得为了填满区域伪造缺失字段。

### 3.3 `AssetProductSection`（可调整项）

```ts
type AssetProductSection = {
  label: string;   // 维度标签，如 "来源" / "文案" / "失败原因"
  title: string;   // 该维度的标题
  detail: string;  // 详细说明
  status: string;  // 状态，如 "已生成" / "待确认" / "可调整"
};
```
在 `ProductWorkspace` 详情抽屉的「内容与可调整项」中逐条渲染。

### 3.4 `AssetProductTimelineItem`（时间轴项）

```ts
type AssetProductTimelineItem = {
  time: string;    // 时间点，如 "00:00"
  title: string;   // 该段标题
  status: string;  // 状态 / 说明
  line?: string;   // 口播台词；digital-human 模式且任一项有 line 时触发 speech 时间轴样式
};
```
渲染规则见 §6.3。`digital-human` 且 `timeline` 中存在 `line` 时，时间轴切换为「音轨和字幕」样式，每项额外显示 `status` 作为 `<em>`。

### 3.5 `AssetProductVersion`（版本）

```ts
type AssetProductVersion = {
  id: string;       // 版本 id，如 "v1"
  label: string;    // 版本标签，如 "v1 完整解释版"
  savedAt: string;  // 保存时间文案，如 "18 分钟前" / "刚刚"
  status: string;   // 状态，如 "已保存" / "当前"
};
```

### 3.6 `AssetProductPreview` / `AssetProductPreviewFrame`（预览）

```ts
type AssetProductPreviewFrame = {
  title: string;
  subtitle: string;
  tone?: "neutral" | "blue" | "green" | "dark";  // 缩略帧配色；映射为 CSS class
};

type AssetProductPreview = {
  title: string;          // 预览主标题
  subtitle: string;       // 预览副标题
  eyebrow?: string;       // 眉标；★ UI 未渲染
  posterText?: string;    // 海报文字；★ UI 未渲染
  prompt?: string;        // 生成提示词；★ UI 未渲染
  frames?: AssetProductPreviewFrame[];  // 缩略帧；image 缺省给 3 帧兜底，video 仅在有值时渲染
};
```

`frame.tone` 直接作为 className 输出（缺省为空串）。预览各 mode 的使用差异见 §7.2。

### 3.7 `AssetConversationMessage`（对话消息）

```ts
type AssetConversationMessage = {
  role: "user" | "assistant";
  text: string;
  suggestions?: string[];  // 推荐调整指令；有值则渲染为可点击按钮，点击填入输入框
  plan?: AssetMessagePlan;  // 视频参数、编导稿或 Agent 动作确认卡
  runSteps?: AgentRunStep[];
  agentAction?: AgentActionRunResponse;
};
```

### 3.8 `AssetConversation`（对话，聚合根）

```ts
type AssetConversation = {
  id: string;            // 对话 id，"new" 为新建创作
  title: string;         // 标题；侧边栏可被本地重命名覆盖
  type: string;          // 类型文案，如 "LinkedIn 发帖文案" / "图片"
  updatedAt: string;     // 更新时间文案，如 "12 分钟前" / "昨天"
  assetLabel: string;    // 来源依据标签；详情抽屉「来源依据」展示
  status: string;        // 状态文案，如 "知识素材 · 成功"
  prompt: string;        // 用户初始指令；无 messages 时作为首条 user 消息
  response: string;      // 助手回应；无 messages 时作为第二条 assistant 消息
  canvasTitle: string;   // 画布标题；★ UI 未渲染
  canvasMeta: string;    // 画布元信息；★ UI 未渲染
  raw: string;           // 原始 Markdown；★ UI 未渲染
  judgment: string;      // 内容判断；★ UI 未渲染
  action: string;        // 行动建议；★ UI 未渲染
  delivery: string;      // 交付说明；无 messages 时作为第三条 assistant 消息
  suggestions: string[]; // 对话级推荐指令；无 messages 时挂在 delivery 消息上
  messages?: AssetConversationMessage[];  // 完整消息流；有值优先用它
  agentTasks?: AgentTaskCollection;        // 当前任务 + 暂停任务，仅映射 agent_v2
  activeAgentAction?: AgentActionRunResponse;
  product: AssetProduct;          // 必有的单产物（兜底）
  products?: AssetProduct[];      // 可选多产物；非空优先
  sourceIds?: string[];           // 关联来源 id；★ UI 未渲染
};
```

> `messages` 与 `prompt/response/delivery/suggestions` 是两套表达同一对话的方式。`ConversationStudio` 优先用 `messages`，缺省时由后三者合成（见 §6.1）。

#### 3.8.1 Agent 任务与动作

```ts
type AgentTaskCollection = {
  active?: { id: string; goal: string; status: string; assetId?: number;
            versionId?: number; sceneId?: string };
  paused: Array<{ id: string; goal: string; status: string }>;
};

type AgentActionRunResponse = {
  id: string;
  taskId: string;
  actionId: string;
  status: "planned" | "waiting_confirmation" | "queued" | "running"
        | "succeeded" | "failed" | "blocked" | "canceled";
  target: Record<string, unknown>;
  requiresConfirmation: boolean;
  confirmationId: string | null;
  jobId: string | null;
  assetId: number | null;
  versionId: number | null;
  message: string;
  errorCode: string | null;
  retryable: boolean;
};
```

- mapper 只读取 `metadata.agent_mission.version === "agent_v2"`；损坏或历史结构不渲染任务条。
- 动作状态来自服务端持久化 mission/assistant metadata，不根据消息文案猜测。

### 3.9 `AssetWorkshop`（库视图）

```ts
type AssetWorkshop = {
  kicker: string;       // 小标题；★ UI 未渲染
  title: string;        // 标题；顶栏 breadcrumb 与库容器 aria-label
  description: string;  // 描述；顶栏 breadcrumb 副标题
  metrics: Array<{ value: string; label: string; detail: string }>;  // 指标卡
  rows: Array<{ title: string; meta: string; note: string;
                kind: "file" | "copy" | "video" | "image" }>;        // 列表行；kind 决定图标
};
```

### 3.10 `AssetWorkspaceData`（顶层快照）

```ts
type AssetWorkspaceData = {
  conversations: AssetConversation[];
  newConversation: AssetConversation;
  workshops: Record<Exclude<AssetWorkspaceView, "conversation">, AssetWorkshop>;
};
```

---

## 4. 共享 helper 接口：`asset-workspace-shared.ts`

跨组件复用的类型别名与纯函数（无 JSX、无状态）。新增跨组件 helper 放这里，不要在组件文件里重复定义。

### 4.1 类型别名

```ts
type ActiveView      = AssetWorkspaceView;
type ProductMode     = AssetProductMode;
type ProductArtifact = AssetProduct;
type Conversation    = AssetConversation;
```
仅为缩短组件签名、稳定跨文件引用，等价于 types 中的原类型。

### 4.2 函数

#### `getConversationProducts(conversation): AssetProduct[]`
`products` 非空返回它，否则 `[conversation.product]`。这是组件读取一条对话下产物列表的唯一共享实现。

#### `resolveConversationProduct(conversation, selectedProductId): AssetProduct`
按 `selectedProductId` 命中 → 否则最后一个 → 否则 `conversation.product`。`AssetsWorkspaceClient` 用它确定当前展示产物。

#### `getProductModeLabel(mode): string`
mode → 中文标签映射：

| mode | 标签 |
| --- | --- |
| `copy` | 文案 |
| `image` | 图片 |
| `audio` | 音频 |
| `digital-human` | 数字人视频 |
| `mg_animation_video` | MG 动效 |
| `video`（默认） | 视频 |

#### `getProductRatioClass(ratio): string`
比例字符串 → CSS class（用于预览容器布局）：

| ratio 包含 | 返回 class |
| --- | --- |
| `"16:9"` | `ratio-landscape` |
| `"9:16"` | `ratio-portrait` |
| `"4:5"` | `ratio-cover` |
| 其他 | `""` |

> 产物列表和当前产物解析属于纯前端展示逻辑，统一放在 shared helper；adapter 不再保留一套同义方法。

---

## 6. 组件 Props 契约

所有子组件均为受控纯展示组件，状态集中在 `AssetsWorkspaceClient`。以下为各组件的 props 接口。

### 6.1 `MultiMixApp`（`app/multimix-app.tsx`，默认导出）

```ts
function MultiMixApp({ basePath }: { basePath: string }): JSX.Element
```
- `basePath`：当前路由基础路径（`"/"` 或 `"/app/assets"`），用于生成对话 / 产物链接。
- 内部用 `<Suspense>` 包裹（因 `useSearchParams`），读取 `conversation` / `product` 查询参数注入下层。

### 6.2 `AssetsWorkspaceClient`（默认导出，唯一状态容器）

```ts
type AssetsWorkspaceClientProps = {
  initialConversationId?: string;  // 初始选中对话；无效则回退首条对话
  initialProductId?: string;       // 初始选中产物
  basePath?: string;               // 默认 "/app/assets"
  accountEmail?: string;           // 默认 "pilot@changein"，侧边栏底部展示
};
```

持有的内部状态（不对外暴露，仅说明数据契约）：

| 状态 | 类型 | 说明 |
| --- | --- | --- |
| `activeView` | `ActiveView` | 当前视图，默认 `"conversation"` |
| `selectedConversationId` | `string` | 选中对话 id |
| `selectedProductIds` | `Record<string, string>` | 每对话各自记忆的选中产物 id |
| `sidebarState` | `"auto" \| "collapsed" \| "expanded"` | 侧边栏状态 |
| `isNarrowViewport` | `boolean` | `max-width:1180px` 媒体查询结果 |
| `chatPanelWidth` | `number` | 对话面板宽度 px，默认 426 |
| `conversationMenuId` | `string \| null` | 当前展开的「更多」菜单对话 id |
| `renamedConversations` | `Record<string,string>` | 本地重命名覆盖（仅前端） |
| `hiddenConversationIds` | `string[]` | 本地删除（仅隐藏，不动数据） |
| `copiedProductId` | `string \| null` | 复制反馈态，1400ms 自动清除 |
| `savedProductIds` | `Record<string,string>` | 已保存产物 → version |

分栏拖拽约束：`minChatWidth=320`，`minArtifactWidth=360`，`handleWidth=10`；键盘 `←/→` 调整 ±32（Shift ±80）。

回调（下传给子组件）：
- `onSelectProduct(conversationId, productId)`：记忆该对话选中产物。
- `onCopyProduct(product)`：经 `getProductText` 取文本，写剪贴板（`navigator.clipboard`，失败回退 `execCommand`）。
- `onSaveProduct(product)`：调 `adapter.saveProduct`，用返回 version 更新状态。

### 6.2.1 资源库条目管理接口

`LibraryWorkshop` 中的资产库、文案库、图片库和视频库共用同一套 adapter 动作：

```ts
downloadAsset(token: string, assetId: number): Promise<Blob>
deleteAsset(token: string, assetId: number): Promise<void>
```

后端接口契约：

- `GET /v1/assets/{asset_id}/download`：优先返回 `AssetFile.original` 原文件；不存在原文件时返回 Markdown 导出。响应使用 `Content-Disposition: attachment`。
- `DELETE /v1/assets/{asset_id}`：软删除/归档资产，返回 `204`。归档后资产不应出现在 `/v1/assets`、`/v1/assets/search` 和 `/v1/assets/semantic-search` 的默认结果里。
- 删除不是物理删除文件；这是为了保留历史对话、来源引用和已有产物链路的可追溯性。
- 前端删除成功后关闭详情抽屉并刷新当前库；真实后端返回空列表时保持空态，不回退到 mock 行。

### 6.3 `ConversationStudio`（`conversation-studio.tsx`，默认导出）

```ts
function ConversationStudio({
  basePath: string;
  contextAssets?: Array<{ id: number; title: string }>;
  selectedConversation: Conversation;
  selectedProduct: ProductArtifact | null;
  onSelectProduct: (conversationId: string, productId: string) => void;
  imageAttachments?: ChatImageAttachment[];
  onUploadImages?: (files: File[]) => void;
  onRemoveImageAttachment?: (attachmentId: string) => void;
  onRetryImageAttachment?: (attachmentId: string) => void;
  pendingExchange?: OptimisticExchange | null;
  onPendingExchangeChange?: (
    conversationId: string,
    exchange: OptimisticExchange | null,
  ) => void;
  onSendMessage?: (
    conversation: Conversation,
    instruction: string,
    signal?: AbortSignal,
    linkedAssets?: Array<{ id: number; title: string }>,
    clientRequestId?: string,
    videoParameterConfirmation?: AssetVideoParameterConfirmation,
    agentConfirmationId?: string,
  ) => Promise<void>;
  generationJob?: AssetGenerationJobResponse | null;
  onRetryGeneration?: (jobId: string) => void;
  liveRunStateByAssetId?: Record<number, AgentRunState>;
  onRetryExecution?: (retryJobId: string, executionJobId: string) => void;
  liveAgentActionsById?: Record<string, AgentActionRunResponse>;
  onRetryAgentAction?: (actionRunId: string) => void;
  diagnosticsSlot?: ReactNode;
  detailLoadError?: boolean;
  onRetryDetail?: () => void;
  readonly?: boolean;
}): JSX.Element
```

完整字段和具体嵌套类型以组件中的 TypeScript 签名为编译期权威；上面列出当前对外行为面，避免文档复制内部实现细节后再次漂移。

行为契约：
- **消息流来源**：`selectedConversation.messages` 非空时直接用；否则合成 `[{user, prompt}, {assistant, response}, {assistant, delivery, suggestions}]`。
- **产物卡**：用 `getConversationProducts` 取列表，再按消息与产物关联关系插入消息流；点击时更新带 `conversation`、`product` 查询参数的路由并调用 `onSelectProduct`。
- **suggestions 按钮**：点击把该建议填入输入框并聚焦、自适应高度。
- **输入框与发送**：输入框初始为空；Enter 或发送按钮通过 `onSendMessage` 提交。生成中按钮用于停止当前浏览器请求；附件未就绪、只读或正在发送时，发送门会阻止重复提交。
- **附件**：图片和文档上传、删除、失败重试及上传进度已接入。视频属于产品上传范围，但两个选择器当前存在“可选择、随后被处理器过滤”的已知回归，修复与浏览器验证记录在 `../../docs/plans/active/2026-07-21-chat-attachment-upload-progress.md`。
- **任务与动作**：有效 `agentTasks` 在消息头下显示轻量任务条；Agent 动作确认复用
  `ConfirmCard`，执行状态复用唯一的 `AgentRunTimeline`。只有服务端
  `status === "succeeded"` 才显示完成，只有 `retryable === true` 才显示动作重试。

### 6.4 `ProductWorkspace`（`product-workspace.tsx`，默认导出）

```ts
function ProductWorkspace({
  copied: boolean;             // 是否处于「已复制」反馈态
  onCopyProduct: (product: ProductArtifact) => Promise<void>;
  onSaveProduct: (product: ProductArtifact) => Promise<void>;
  product: ProductArtifact;    // 当前展示产物
  savedVersion?: string;       // 已保存版本号，有值则按钮显示「已保存 vX」
  selectedConversation: Conversation;  // 供详情抽屉展示来源依据 / 状态
}): JSX.Element
```

行为契约：
- 标题区显示 `title` 和 `{modeLabel} · {status} · {ratio} / {duration}`。
- 预览容器 class：`shadcn-prototype-product-preview {mode} {ratioClass}`，内嵌 `ProductPreview`。
- 详情抽屉（`<details>` popover）：状态卡（当前状态 / 来源依据 / 规格）+ 「内容与可调整项」（遍历 `sections`）。
- 「复制」按钮**仅 `mode === "copy"` 显示**；`copied` 为真显示「已复制」。
- 「保存」按钮始终显示。
- 时间轴：`timeline.length > 0` 才渲染。`digital-human` 且任一项有 `line` → speech 样式（显示 `line` + `status` 双行），否则普通样式（显示 `status`）。

### 6.5 `ProductPreview`（`product-preview.tsx`，默认导出）

```ts
function ProductPreview({ product }: { product: ProductArtifact }): JSX.Element
```
按 `product.mode` 提前 return 不同预览。新增产物类型只需加一个分支。详见 §7。

### 6.6 `LibraryWorkshop`（`library-workshop.tsx`，默认导出）

```ts
function LibraryWorkshop({ view }: { view: Exclude<ActiveView, "conversation"> }): JSX.Element
```
- 内部调 `adapter.getWorkshop(view)` 取数据。
- 渲染指标卡（`metrics`：value/label/detail）+ 列表（`rows`：按 `kind` 显示图标 video/image/copy/file，展示 title/meta/note）。

---

## 7. 产物预览渲染契约（按 mode 分发）

`ProductPreview` 依 `product.mode` 走不同分支。各 mode 对字段的消费方式：

### 7.1 各 mode 分支

| mode | 渲染内容 | 关键字段消费 |
| --- | --- | --- |
| `copy` | Markdown 文档 + 可选来源引用 | `markdownBody`，缺失时用 `body/summary` |
| `image` | 真实图片或明确比例占位 + 可选变体 + 来源引用 | `metadata.preview_url/thumbnail_url`、`preview`、`sourceSummary` |
| `audio` | 时长 + 标题副标 + 34 根波形条 | `duration`；`preview.title/subtitle`（副标缺省「口播 / 字幕 / 时间轴已匹配」） |
| `digital-human` | 有媒体时播放真实视频；否则显示明确的待渲染状态 | 媒体 URL、`preview`、`ratio`、`duration` |
| `mg_animation_video` | MG scene 规格卡与明确的预览/待渲染状态 | `metadata.mg_scene/mg_scenes` |
| `video`（默认分支） | 编导稿摘要，或白色播放器外壳中的成片/分镜预览、分镜卡和来源信息 | `videoProjectReady`、媒体 URL、`segments`、`metadata.video_project/video_plan` |

### 7.2 `preview.frames` 兜底差异

- **image**：只渲染后端实际返回的变体；缺失时不伪造三张示例图。
- **video**：`frames` 仅作已返回的辅助视觉信息；工程浏览态主要使用真实媒体、分镜和工程状态。
- `frame.tone`（`neutral`/`blue`/`green`/`dark`）作为 className 直接输出，缺省空串。

### 7.3 `preview` 字段边界

`posterText` 可用于视频工程没有可播放媒体时的明确预览文案；其余字段只有组件实际读取时才构成用户可见能力。不得仅因类型中存在字段就声称功能已上线。

---

## 8. 路由与 URL 接口

| 路由 | 文件 | basePath | 说明 |
| --- | --- | --- | --- |
| `/` | `app/page.tsx` | `/` | 主页入口 |
| `/app/assets` | `app/app/assets/page.tsx` | `/app/assets` | 工作台入口（同一应用，不同 basePath） |

### 8.1 查询参数

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `conversation` | string | 初始选中对话 id；无效时回退首条对话 |
| `product` | string | 初始选中产物 id（对话内原始 id，不含前缀） |

示例：`/app/assets?conversation=market-rule&product=market-rule-linkedin-copy`

- 链接由组件用 `encodeURIComponent` 编码生成。
- `searchParams` 变化时 `AssetsWorkspaceClient` 的 effect 会重新解析选中态并切回对话视图。
- 客户端导航点击产物卡 / 对话行时 `event.preventDefault()` + 状态更新，不触发整页刷新。

---

## 9. 认证接口（`multimix-app.tsx`）

认证不是单一的“纯前端假登录”，而是按配置选择：

- 配置 Supabase 且认证模式不是 `local`：恢复 Supabase session，使用 Supabase 登录、注册、刷新 token、登出和密码重置。
- 配置后端但未启用 Supabase：使用后端登录/注册接口；本地开发可按认证模式尝试获取 local-dev admin token。
- 后端和 Supabase 都未配置：进入离线展示模式，才使用浏览器本地用户；这不会让生产 adapter 回退演示数据。

浏览器存储键是 `multimix_local_user`，结构为 `{ email, token? }`。API 返回 401 时会触发统一登出并清除失效会话；认证初始化有 4 秒超时，失败会显示可重试的登录状态错误。

---

## 10. 环境变量接口（`.env.example`）

| 变量 | 客户端可见 | 用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_MULTIMIX_AUTH_MODE` | 是 | 认证模式；`local` 使用后端本地认证，其他值允许启用已配置的 Supabase |
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | Supabase Auth 项目 URL；与 publishable key 同时配置才启用 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 是 | Supabase 浏览器公钥；不是 service-role key |
| `NEXT_PUBLIC_API_BASE_URL` | 是 | 真实后端 API 基址；未配置时工作台显示未连接/空态 |
| `LLM_API` | **否** | LLM 服务端密钥；**禁止加 `NEXT_PUBLIC_` 前缀**（会暴露到客户端） |

数据边界（严格遵守）：
- **提交**：UI 代码、测试专用最小 fixtures、文档。
- **不提交**：运行时 `*.sqlite`/`*.db`、`.env.local`、生产密钥、构建产物、日志。

---

## 11. CSS 类名约定与已知边界

### 11.1 类名前缀

- 当前 UI 仅用 `shadcn-prototype-*`（工作台）和 `multimix-auth-*`（认证壳）两组前缀。
- `app/globals.css` 是单一全局样式表。历史 ChangeIn 样式已清理过，新增样式请沿用上述两组现役前缀，勿盲目复用陌生类名或引入新的顶层前缀。

### 11.2 当前边界

- 对话、资源库、生成任务、视频工程和产物版本已经通过真实 adapter 接入后端；重命名/删除失败时恢复前端状态。
- 部分兼容字段仍保留在类型中，但只有组件实际读取的数据才应视为当前 UI 契约；不能把“类型存在”等同于“用户已能看到”。
- 未配置 API、真实空数据和请求失败必须分别显示，不得用测试 fixture 冒充成功。

### 11.3 扩展后端能力时的边界

1. 新接口先进入 `asset-workspace-adapter.ts`，组件不直接拼后端 URL。
2. 后端异步任务通过明确的任务状态和重试接口呈现，不能在前端伪造完成。
3. 服务端密钥走服务端代码路径，遵守 §10 数据边界。
4. 后端实现变化不应无理由改变工作台交互；类型契约、错误态和组件 props 要同步验证。

---

## 12. 阶段 4 后端接口契约（V3 智能体工作台）

真实后端（MultiMix-Backend）为 V3 重设计新增/扩展的接口。前端一律经 `lib/api.ts` + `lib/asset-mappers.ts` 消费，且按规范 §12「数据不在就不渲染」展示——字段缺位时组件自身不渲染，禁止假数据。

### 12.1 生成步骤事件 `steps[]`（Agent 执行时间线）

视频任务状态接口（`VideoJobRead`，轮询与 retry 均透传）新增：

```jsonc
"steps": [
  { "key": "understand", "label": "理解素材与要求", "status": "done",    "elapsed_seconds": 8 },
  { "key": "plan",       "label": "规划分镜结构",   "status": "running", "elapsed_seconds": 3 },
  { "key": "generate",   "label": "生成与合成",     "status": "pending", "elapsed_seconds": null }
]
```

完成判断不能只依赖页面元素：`VideoJobRead.project_ready === true` 且
`workflow_stage === "video_project_ready"` 表示服务端工程已就绪。工作台随后刷新当前会话/工程
并展示分镜；若后端已就绪但展示未收敛，应呈现可恢复的同步状态和 job ID，而不是继续把素材列表轮询
当作生成进度。

排障可读取 `GET /v1/video/projects/{asset_id}/decision-events?limit=100`。该接口只返回当前用户工程的
脱敏、append-only 事件（事件类型、原因码、关联 ID、hash、有限详情和时间），不供普通产品文案展示，
也不返回原始用户输入、素材内容或模型提示词。

- ≥ 3 个语义步（理解/规划/生成），由 `render_stage` + 真实阶段时间戳（`result_payload.step_marks`）派生，禁止假进度。
- 旧后端缺字段 → adapter 解析为空数组 → 时间线回退 `render_stage` 映射（`videoJobTimelineSteps`）。

两阶段素材驱动流水线只能投影为现有用户语义步骤，不得直接显示内部 stage：

| 内部 `render_stage` | 用户步骤 key | 用户文案 |
| --- | --- | --- |
| `script`、`asset_driven_planning`、`planning_assets`、`asset_manifest_ready` | `plan` | `正在准备分镜画面` |
| `composing`、`voice`、`project`、`rendering` | `generate` | `正在生成视频` |
| `reviewing`、`quality` | `review` | `正在完成质量检查` |
| `needs_script_revision` | `review` | `需要先调整编导稿` |

- API 可以在受保护的 metadata 中保留 pipeline、manifest、Provider 和内部 stage 供诊断，但普通
  `steps[]`、产物卡、编导稿和展示区不得出现 `animated_explainer`、`hybrid`、`asset_manifest`、
  Provider、Skill、模型名或原始 `render_stage`。
- adapter 必须使用穷举映射；遇到未知内部 stage 时显示通用“正在生成视频”，不得把原始字符串
  直接透传给用户。
- `needs_script_revision` 不是视频工程 ready 状态。前端重新聚焦原编导稿，并使用现有调整与确认入口。

视频工程质量报告中的 MG 问题使用非阻断 warning 契约：

- `mg_failed`、`mg_not_ready`、`mg_stale`：overlay 未成功，保留原主画面并展示对应分镜警告。
- `mg_primary_blank`：full-frame `mg_scene` 失败，后端已用持久化、无文字的空白主画面保留该镜时长。
- 上述 warning 不取消 `ready`、不隐藏编辑或导出入口；前端必须显示警告和可用的手动重试入口。
- 空白占位未持久化、归属不正确或主轨不连续时，后端返回 blocker，前端按主工程失败处理。

### 12.2 结构化确认卡 `metadata.plan`

视频链路有两道不同的结构化确认门。

第一道位于生成编导稿前。视频请求的 assistant 消息使用：

```json
{
  "kind": "video_parameter_confirmation",
  "title": "确认视频参数",
  "status": "pending",
  "fields": [
    { "key": "ratio", "label": "视频比例", "value": "横屏 16:9（默认）" },
    { "key": "duration", "label": "目标时长", "value": "30 秒（默认）" }
  ],
  "confirm_label": "确认参数并生成编导稿",
  "adjust_label": "调整参数",
  "ratio_options": [
    { "value": "16:9", "label": "横屏 16:9" },
    { "value": "9:16", "label": "竖屏 9:16" },
    { "value": "1:1", "label": "方形 1:1" }
  ],
  "ratio_default": "16:9",
  "duration_seconds": 30,
  "duration_min": 5,
  "duration_max": 120,
  "pending_intent_id": "pending-...",
  "pending_intent_version": 1
}
```

确认请求在普通消息字段之外提交：

```json
{
  "instruction": "确认参数并生成编导稿",
  "conversation_id": "asset-conversation-...",
  "video_parameter_confirmation": {
    "pending_intent_id": "pending-...",
    "version": 1,
    "ratio": "16:9",
    "target_seconds": 30
  }
}
```

后端只接受当前 pending intent 的 ID 和版本。普通自然语言“确认”不会生成编导稿；缺省比例与时长分别为横屏 `16:9` 和 `30 秒`。

第二道位于编导稿生成后。编导稿草稿（`video_workflow_stage == "director_script_draft"`）的 assistant 消息 `metadata` 挂载原有 `plan` 对象：

```jsonc
{
  "title": "...", "status": "pending" | "confirmed", "subtitle": "...",
  "fields": [{ "key": "format", "label": "视频形式", "value": "竖屏 9:16 · ...", "refs": [{ "assetId": 1, "title": "...", "thumbnailUrl": "..." }] }],
  "summary_fields": ["..."],
  "confirm_label": "确认，生成视频工程", "adjust_label": "调整方向",
  "confirm_utterance": "确认，生成视频工程"
}
```

- `refs` 只列 `asset_reference.status == "matched"` 的已保存素材（stock 兜底不当「你的素材」）。
- 无 scenes → 后端不挂 `plan` → 前端退回建议芯片（现状行为）。
- 第二道确认按钮把 `confirm_utterance` 作为普通消息提交并附带一次性 `client_request_id`，命中“生成视频工程”确认门。
- 已持久化的确认结果可能是 `processing / video_project_queued`，此时展示排队状态，不能因有占位 metadata 就显示编辑器。

### 12.3 统一分镜素材候选端点（三入口共用）

`GET /v1/video/projects/{asset_id}/segments/{segment_id}/material-candidates?scope=local|public&cursor=&limit=`

- 这是唯一素材候选接口，不受版本 flag 控制；404 表示工程或分镜不存在，前端展示真实错误，不调用旧接口。
- `scope=local`：返回 `groups.current / recommended / library`（无外部网络依赖，首屏即可展示），`public` 为空。
- `scope=public`：返回 `groups.public`、`next_cursor`（游标翻页「换一批」）和逐 provider `provider_statuses`；公共 provider 失败只影响公共分组，不影响本地候选。
- 候选契约（每项）：`candidate_id`（服务端签发的不透明 ID，公共素材不返回 `download_url`）、`source_type`、`source_asset_id`、`provider`、`media_type`、`title`、`preview_url`、`width/height/duration`、`license/author/attribution_url`、`verification_status`、`relevance_status/relevance_reason`、`requires_trim`、`already_persisted`、`selectable`。
- `current` 项 `selectable=false`，仅作为「当前使用」展示，不可重复选择，也不签发可提交的 candidate ID。
- 前端：工作台分镜卡、嵌入式 FilmStrip、全屏 OpenCut `ReplacePanel` 共用同一 adapter（`loadSegmentMaterialCandidates`）与同一候选组件（`AssetPicker`）；本地先出、公共异步补充。

### 12.4 局部重合成端点（分镜属性卡 / 三入口统一替换）

`POST /v1/video/projects/{asset_id}/segments/{segment_id}/recompose`

```jsonc
{ "operation": "replace_material" | "revoice" | "toggle_mg",
  "candidate_id": "segment-candidate-…", // replace_material 必填（服务端签发）
  "voiceover": "...",         // revoice 可修改文案，也可只修改声音设置
  "voice_name": "female_warm",
  "voice_speed": 1.0,
  "voice_direction": {
    "pace": "natural",
    "energy": "warm_clear",
    "pause_after_ms": 120,
    "emphasis": ["MultiMix"]
  },
  "pronunciations": [
    { "text": "MultiMix", "spoken_as": "猫提米克斯" }
  ],
  "preview_only": false,
  "preview_job_id": "video-job-…",
  "mg_enabled": true,          // toggle_mg 必填
  "confirm_overwrite": false } // 见 12.5
```

- `replace_material` 只接受服务端签发且绑定用户/工程/分镜的 `candidate_id`；已保存素材也先由 local 候选接口签发。公共候选只有经服务端资产化（下载 + 校验 + 持久化）后才进入 pending plan，**前端不得提交任意素材 ID 或公共 URL**。
- 只 patch 目标分镜的权威字段（`asset_reference`+`materials` / `narration` / `mg_decision`），随后复用整条编排重建工程（adapter=`segment_recompose`）。排队/运行/失败期间保留替换前 ready 工程；仅在质量检查通过后原子发布新版本，并追加版本快照（可通过 `POST /assets/{id}/versions/{version_id}/restore` 恢复）。
- 全屏 `ReplacePanel` 不再直接下载 URL 改浏览器内存时间线；替换走本端点后调用 `reloadProject()` 重新加载权威工程。
- 返回 `VideoJobRead`（202）；错误：404 工程/分镜不存在、410 候选过期、422 参数或素材不可用。
- 兼容旧客户端：只发送 `voiceover`、`voice_name`、`voice_speed` 的 `revoice` 请求仍然有效；
  `voice_direction`、`pronunciations`、试听字段均为可选扩展。

#### 12.4.1 配音试听与应用

试听请求使用同一端点，并设置 `preview_only=true`：

```json
{
  "operation": "revoice",
  "voiceover": "修改后的口播",
  "voice_name": "male_steady",
  "voice_speed": 1.1,
  "voice_direction": { "energy": "steady_authoritative" },
  "pronunciations": [
    { "text": "MultiMix", "spoken_as": "猫提米克斯" }
  ],
  "preview_only": true
}
```

试听 job 允许保存临时音频，但不修改稳定 `video_plan`、`video_segments` 或
`video_project`。轮询完成后读取：

```json
{
  "id": "video-job-123",
  "asset_id": 7,
  "status": "completed",
  "render_stage": "done",
  "result": {
    "voice_preview": {
      "segment_id": "scene-2",
      "audio_ref": "local://video-orchestration/7/audio-preview/...",
      "duration_seconds": 3.4,
      "request_fingerprint": "..."
    }
  }
}
```

前端必须使用 `VideoJobRead.id` 轮询，不能读取不存在的 `public_id`。试听音频通过
`GET /v1/video/media?ref={encodeURIComponent(audio_ref)}` 播放。

应用当前分镜时，把完成的 `id` 作为 `preview_job_id` 发回同一端点，并设置
`preview_only=false`。服务端只接受仍对应当前工程版本、目标分镜和规范化配音请求的试听；
过期结果返回 `voice_preview_stale`。

成功应用的 job 同时返回：

- `result.undo_version`：供界面展示的版本序号；
- `result.undo_version_id`：数据库版本 ID，撤销接口必须使用这个值。

撤销调用：

```text
POST /v1/assets/{asset_id}/versions/{undo_version_id}/restore
```

#### 12.4.2 全片统一换声

`POST /v1/video/projects/{asset_id}/revoice`

```json
{
  "voice_name": "male_steady",
  "voice_speed": 1.0,
  "voice_direction": { "energy": "steady_authoritative" },
  "pronunciations": [],
  "preview_job_id": "video-job-123",
  "confirm_overwrite": false
}
```

- adapter 为 `project_revoice`；同一工程的全片换声和分镜重合成互斥。
- 每个通过质量门的分镜先保存到 job 的 `narration_checkpoints`，重试时只补失败或失效结果。
- 全部必需分镜成功后才一次性发布；中途失败不会暴露半完成工程。
- voice-only 修改保留当前 `bgm_choice.catalog_id`，按新对白窗口重新生成 ducking。

#### 12.4.3 配音审计与冲突

- 工程 `metadata.narration_profile` 记录实际 provider、默认声音和对齐模式；普通用户界面不显示
  provider/model ID。
- 音频元素 `narrationArtifact.timestampSource` 和 job
  `result.orchestration.tts_outcomes[*].timestamp_source` 记录
  `provider / whisper / proportional` 等实际时间戳来源。
- `409 detail.code=timeline_dirty`：重建会覆盖手工裁剪/分割，需要用户显式确认。
- `409 detail.code=voice_provider_changed`：当前 TTS provider 与工程锁定值不一致，禁止静默切换。
- `409 detail.code=voice_preview_stale`：试听不再对应当前工程或配音设置，需要重新试听。
- 失败 job 可在 `result.narration_failure.segment_id` 指出失败分镜；稳定工程继续保持 ready。

### 12.5 timeline 脏标记（两层数据边界，规范 §5.5）

- 全屏编辑器保存（`PUT /v1/video/projects/{asset_id}`）会置 `metadata.timeline_dirty = true`——手工裁剪/分割属于渲染层。
- `timeline_dirty` 为真时调 recompose 且未带 `confirm_overwrite: true` → `409 { "detail": { "code": "timeline_dirty", "message": "…会覆盖…手工剪辑…" } }`。前端捕获 `code == "timeline_dirty"` 弹「会覆盖你的手工剪辑」确认框，确认后带 `confirm_overwrite: true` 重发。
- 编排成功重建 `video_project` 后，后端清除该标记；失败不清（手工时间轴仍在）。
- 分镜属性卡的语义层修改（素材/配音/字卡）本身不受覆盖提示影响——提示语必须区分两层。

### 12.6 成片媒体缓存（成片浏览态播放器）

成片浏览态（`product-preview.tsx` 的 9:16 播放器）与素材代理都经 `GET /v1/video/media?ref=…`。后端 `_build_media_response` 已返回：

- `Cache-Control: private, max-age=3600` —— 同一成片 1 小时内切回来走浏览器缓存，不重新下载。
- `Accept-Ranges: bytes` + `206 Partial Content` —— 支持范围请求，分镜卡跳转 seek 只拉目标片段。

前端配合：播放器 `key={url}`（同 URL 不重建，换 URL 才重挂）+ 模块级 `videoPlaybackPositions` 记录每个 URL 的播放位置，重开产物时 `onLoadedMetadata` 恢复进度而非从 0 重播。**结论：无需为播放器缓存新增后端工作，现有响应头已覆盖。**

### 12.7 Conversation Agent 原子动作

消息请求扩展：

```json
{
  "instruction": "确认修改",
  "conversation_id": "asset-conversation-...",
  "selected_product_id": 42,
  "linked_asset_ids": [],
  "client_request_id": "uuid",
  "agent_confirmation_id": "agent-confirm-..."
}
```

消息响应可带：

```json
{
  "agent_action": {
    "id": "agent-action-...",
    "task_id": "task-...",
    "action_id": "video.scene.replace_material",
    "status": "queued",
    "target": {"scope": "scene", "asset_id": 42, "scene_id": "scene-2"},
    "requires_confirmation": false,
    "confirmation_id": null,
    "job_id": "video-job-...",
    "asset_id": 42,
    "version_id": 7,
    "message": "视频修改任务已提交。",
    "error_code": null,
    "retryable": false
  }
}
```

动作状态接口：

```text
GET  /v1/assets/conversations/{conversation_id}/agent-actions/{action_run_id}
POST /v1/assets/conversations/{conversation_id}/agent-actions/{action_run_id}/retry
```

- GET 同时执行一次服务端观察，并返回最新持久化状态。
- POST 只接受 `failed + retryable`、manifest 允许安全重试且免费的一次原动作；否则返回 409。
- 前端以 `conversationId + actionRunId` 为轮询键，queued/running 每 4 秒观察一次；切换对话不取消
  服务端动作，终态后重新加载同一 conversation 和同一 backend asset。
- assistant 消息 metadata 中的 `agent_action_run_id`、`agent_action`、`run_steps` 和
  `plan.confirmation_id` 用于刷新/断线恢复；实时 mission 观察覆盖旧消息里的 queued 快照。
- 图片库已保存图片的详情提供“加入对话”，其资产 ID 随下一条消息进入 `linked_asset_ids`，供
  服务端绑定分镜素材；前端不把任意 URL 当作素材引用。

---

## 附：验证命令

```bash
npm run dev -- --hostname 127.0.0.1 --port 3200   # 本地开发
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run build         # next build
```

改完代码后至少跑 `typecheck` + `lint` + `build` 验证。

## 展示区自动化覆盖

展示区案例只在测试时创建，不写入开发数据库或 Supabase。完整 E2E 需要前端仓库同级存在 `MultiMix-Backend`，默认使用独立端口 3219/8299 和随机临时 SQLite；成功或失败都会清理进程、数据库和媒体副本。

```powershell
npm run test:display-components
npm run test:display-e2e
npm run test:display-coverage
```

`test:display-components` 验证真实 React 组件；`test:display-e2e` 启动隔离前后端并运行九个浏览器案例；`test:display-coverage` 依次执行两层覆盖。
