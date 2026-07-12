# MultiMix 接口文档

本文档描述 MultiMix 内容生成工作台原型阶段的全部「接口」：数据访问层（adapter）、数据类型契约、共享 helper、Mock 数据契约、数据库 schema、seed 脚本、组件 props 契约、路由 / URL 接口、本地认证、环境变量、CSS 类名约定，以及未来接入真实后端的指引。

> 产品定位、交互规则与数据边界见 `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`../CLAUDE.md` 与工作区根目录 `../docs/README.md`。本文聚焦「代码契约」，是开发与后端接入的参考手册。

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
| `app/assets/components/product-workspace.tsx` | UI | 展示区容器：标题、详情抽屉、操作按钮、时间轴 |
| `app/assets/components/product-preview.tsx` | UI | 按 `product.mode` 分发的预览 |
| `app/assets/components/library-workshop.tsx` | UI | 资产库 / 文案库 / 视频库视图 |
| `app/assets/lib/asset-workspace-types.ts` | 数据 | 所有数据类型定义 |
| `app/assets/lib/asset-workspace-empty-data.ts` | 数据 | 未配置或加载前使用的空结构，不含演示内容 |
| `app/assets/lib/asset-workspace-adapter.ts` | 数据 | 数据访问接口（后端接入点） |
| `app/assets/lib/asset-workspace-shared.ts` | 数据 | 跨组件类型别名 + 纯 helper |

---

## 2. 数据访问层接口：`AssetWorkspaceAdapter`

定义在 `app/assets/lib/asset-workspace-adapter.ts`。这是 UI 与数据之间唯一的接口边界。导出单例 `assetWorkspaceAdapter`，生产运行时只请求真实后端。

```ts
export type AssetWorkspaceAdapter = {
  getSnapshot(): AssetWorkspaceData;
  listConversations(): AssetConversation[];
  getConversation(conversationId: string): AssetConversation | undefined;
  getNewConversation(): AssetConversation;
  listConversationProducts(conversation: AssetConversation): AssetProduct[];
  getConversationProduct(conversation: AssetConversation, productId?: string): AssetProduct;
  getWorkshop(view: Exclude<AssetWorkspaceView, "conversation">): AssetWorkshop;
  getProductText(product: AssetProduct): string;
  saveProduct(product: AssetProduct): Promise<{ version: string; savedAt: string }>;
};

export const assetWorkspaceAdapter: AssetWorkspaceAdapter;
```

> 上面是原型阶段的核心读接口。真实后端版 adapter 还包含对话（`sendMessage`/`reviseProduct`/`loadConversations`）、库（`listLibrary`/`uploadAsset` 等）与视频任务方法：`generateVideo`（POST /video/generate）、`getVideoJob`（GET /video/jobs/{id}，工作台用它轮询 `render_stage` 显示分阶段进度）、`retryVideoJob`（POST /video/jobs/{id}/retry，失败任务原地重试）。完整签名以 `asset-workspace-adapter.ts` 的 `AssetWorkspaceAdapter` 类型为准。

### 2.1 对话确认一致性

真实 adapter 的 `sendMessage` 可接收可选 `clientRequestId`，并在
`POST /v1/assets/conversations/messages` 请求体中映射为 UUID
`client_request_id`。确认视频工程时，`ConversationStudio` 为本次点击生成一次
request ID；同一乐观轮次和重试必须复用它。

网络层返回连接错误后，`reconcileMessage({ token, clientRequestId })` 拉取已持久化
会话并按消息 metadata 的同名字段对账：找到则用服务端消息和工程替换乐观消息；找不到
才显示“未提交”，不得额外写入一条正式助手错误消息。这个 request ID 只用于传输对账；
服务端仍以确认语义幂等键保证不会重复创建视频工程。

### 2.2 方法详解

#### `getSnapshot(): AssetWorkspaceData`
返回结构合法的空工作台快照（空 conversations、`newConversation` 壳和空 workshops），供异步真实数据加载前渲染。

#### `listConversations(): AssetConversation[]`
同步读取只返回空数组；真实历史对话由 `loadConversations` 异步加载。加载前显示骨架，不显示样例。

#### `getConversation(conversationId): AssetConversation | undefined`
按 `id` 精确查找单条对话，找不到返回 `undefined`。

#### `getNewConversation(): AssetConversation`
返回固定的「新建创作」对话（`id: "new"`）。点击「新建创作」或选中对话不存在时回退到它。

#### `listConversationProducts(conversation): AssetProduct[]`
取一条对话下的产物列表。**规则**：`conversation.products` 非空则返回它，否则回退为 `[conversation.product]`。即 `products` 是可选的多产物数组，`product` 是必有的单产物兜底。

#### `getConversationProduct(conversation, productId?): AssetProduct`
取对话下当前选中的产物。**解析优先级**：
1. `products` 中 `id === productId` 的产物；
2. 否则取列表最后一个产物（`products[products.length - 1]`）；
3. 再否则回退 `conversation.product`。

> 注意：`productId` 不带对话前缀，是产物原始 `id`（如 `"market-rule-linkedin-copy"`），与 SQLite 中的 `${conversationId}:${product.id}` 复合主键不同。

#### `getWorkshop(view): AssetWorkshop`
按视图键（`"assets" | "copy" | "video"`）取对应库视图数据。`view` 不能是 `"conversation"`（类型层已 `Exclude`）。

#### `getProductText(product): string`
把产物转为可复制 / 可保存的纯文本。**规则**：`body` 非空则用 `body`，否则用 `[summary]`，再 `join("\n\n")`。供「复制」按钮使用。

#### `saveProduct(product): Promise<{ version: string; savedAt: string }>`
保存产物（异步）。只有真实 token、API 和后端资产 ID 齐全时才请求后端；否则抛出“未连接后端”，不伪造成功。

### 2.3 真实后端边界

- `loadConversations`、`listLibrary` 和所有写操作只访问真实后端。
- 同步方法只提供空结构和纯展示 helper；不能提供演示内容。
- 失败由调用组件显示可重试状态；不能回退 fixture。
- 服务端密钥（如 `LLM_API`）只能在 adapter 的服务端代码路径使用，**禁止加 `NEXT_PUBLIC_` 前缀**。

---

## 3. 数据类型契约

定义在 `app/assets/lib/asset-workspace-types.ts`。以下为全部导出类型及字段语义。

### 3.1 枚举 / 联合类型

```ts
type AssetWorkspaceView = "conversation" | "assets" | "copy" | "image" | "video";
type AssetProductMode  = "copy" | "image" | "video" | "audio" | "digital-human";
```

- `AssetWorkspaceView`：主区域视图。`conversation` = 对话创作模式；其余四个 = 库模式（资产库 / 文案库 / 图片库 / 视频库）。
- `AssetProductMode`：产物类型。决定 `ProductPreview` 的渲染分支。`digital-human` 是视频的一种表现形式，不是一级产物类型。

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
  actions: string[];           // 操作建议标签；★ 当前 UI 未渲染（数据已备）
  sourceIds?: string[];        // 关联来源 id；★ 当前 UI 未渲染
  versions?: AssetProductVersion[];  // 版本历史；★ 当前 UI 未渲染
  preview?: AssetProductPreview;     // 预览补充数据
};
```

★ 标记的字段为「数据已定义、UI 未渲染」，属设计预留，非 bug。

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

### 3.5 `AssetProductVersion`（版本，★ UI 未渲染）

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
  product: AssetProduct;          // 必有的单产物（兜底）
  products?: AssetProduct[];      // 可选多产物；非空优先
  sourceIds?: string[];           // 关联来源 id；★ UI 未渲染
};
```

> `messages` 与 `prompt/response/delivery/suggestions` 是两套表达同一对话的方式。`ConversationStudio` 优先用 `messages`，缺省时由后三者合成（见 §6.1）。

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
与 adapter 的 `listConversationProducts` 同逻辑：`products` 非空返回它，否则 `[conversation.product]`。供组件直接调用（无需经 adapter）。

#### `resolveConversationProduct(conversation, selectedProductId): AssetProduct`
与 adapter 的 `getConversationProduct` 同逻辑：按 `selectedProductId` 命中 → 否则最后一个 → 否则 `conversation.product`。`AssetsWorkspaceClient` 用它确定当前展示产物。

#### `getProductModeLabel(mode): string`
mode → 中文标签映射：

| mode | 标签 |
| --- | --- |
| `copy` | 文案 |
| `image` | 图片 |
| `audio` | 音频 |
| `digital-human` | 数字人视频 |
| `video`（默认） | 视频 |

#### `getProductRatioClass(ratio): string`
比例字符串 → CSS class（用于预览容器布局）：

| ratio 包含 | 返回 class |
| --- | --- |
| `"16:9"` | `ratio-landscape` |
| `"9:16"` | `ratio-portrait` |
| `"4:5"` | `ratio-cover` |
| 其他 | `""` |

> adapter 与 shared 中存在两组同义函数（`listConversationProducts`/`getConversationProducts`、`getConversationProduct`/`resolveConversationProduct`）。组件层用 shared 版本，adapter 版本供未来后端对接。逻辑须保持一致。

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
  selectedConversation: Conversation;
  selectedProduct: ProductArtifact;
  onSelectProduct: (conversationId: string, productId: string) => void;
}): JSX.Element
```

行为契约：
- **消息流来源**：`selectedConversation.messages` 非空时直接用；否则合成 `[{user, prompt}, {assistant, response}, {assistant, delivery, suggestions}]`。
- **布局**：前 2 条消息 → 产物卡列表 → 第 3 条起消息（带 `suggestions` 的加 `delivery` class）。
- **产物卡**：用 `getConversationProducts` 取列表，每张卡按 `mode` 显示图标（image→ImageIcon / audio→Play / video|digital-human→Video / 其他→FileText），点击同时 `<Link>` 跳转（带 `conversation` + `product` 查询参数）并调 `onSelectProduct`。当前产物加 `active` class。有 `version` 显示在右下。
- **suggestions 按钮**：点击把该建议填入输入框并聚焦、自适应高度。
- **输入框**：`new` 对话默认空，其他默认 `"基于当前素材生成 LinkedIn 发帖文案"`。发送按钮为静态占位，无 onClick。

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
| `copy` | 可编辑文档（`contentEditable`），标题 + 逐段正文 | `title`，`body ?? [summary]` 逐段 |
| `image` | 主图卡（固定标注 `4:5`）+ 变体缩略帧 | `preview.title/subtitle ?? title/summary`；`preview.frames` 缺省给 3 帧兜底 |
| `audio` | 时长 + 标题副标 + 34 根波形条 | `duration`；`preview.title/subtitle`（副标缺省「口播 / 字幕 / 时间轴已匹配」） |
| `digital-human` | 数字人舞台（头像 + caption + 播放按钮） | `preview.title ?? title`；`ratio · duration` |
| `video`（默认分支） | 视频工程卡（取 `timeline` 前 3 项）+ 可选视觉缩略帧条 | `preview.title ?? title`；`timeline.slice(0,3)`；`preview.frames`（仅有值时渲染） |

### 7.2 `preview.frames` 兜底差异

- **image**：`frames` 缺省时用兜底 3 帧（主封面 / 信息图 / 客户场景），保证总有变体展示。
- **video**：`frames` 缺省为 `[]`，**不渲染**缩略帧条。
- `frame.tone`（`neutral`/`blue`/`green`/`dark`）作为 className 直接输出，缺省空串。

### 7.3 未被预览消费的 preview 字段

`eyebrow`、`posterText`、`prompt` 在所有 mode 分支中均**未渲染**（数据已备）。

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

## 9. 本地认证接口（`multimix-app.tsx`）

当前为**纯前端本地认证**，用户仅存在浏览器 `localStorage`，无后端校验。

- **存储键**：`multimix_local_user`
- **存储结构**：`type LocalUser = { email: string }`
- **默认用户**：`{ email: "demo@multimix.local" }`

行为：
1. 挂载时读 `localStorage`：
   - 无值 → 写入默认用户并登录。
   - 有值但 `email` 为空或等于历史值 `"pilot@multimix.local"` → 重置为默认用户。
   - 解析失败 → 清除并重置为默认用户。
2. `ready` 前显示 `MultiMixLoading`。
3. `user` 为空时显示 `MultiMixLocalAuth`（登录 / 注册表单，注册密码 `minLength=8`），提交即以填写邮箱登录（不校验密码）。
4. 已登录渲染 `AssetsWorkspaceClient`，`accountEmail = user.email`。

> `@supabase/supabase-js` 已装但**未被任何代码 import**，为未来 Auth 预留。

---

## 10. 环境变量接口（`.env.example`）

| 变量 | 客户端可见 | 用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_MULTIMIX_AUTH_MODE` | 是 | 认证模式，当前 `local` |
| `NEXT_PUBLIC_SUPABASE_URL` | 是 | Supabase 项目 URL（预留） |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 是 | Supabase 公钥（预留） |
| `NEXT_PUBLIC_API_BASE_URL` | 是 | 后端 API 基址（预留） |
| `LLM_API` | **否** | LLM 服务端密钥；**禁止加 `NEXT_PUBLIC_` 前缀**（会暴露到客户端） |

数据边界（严格遵守）：
- **提交**：UI 代码、测试专用最小 fixtures、文档。
- **不提交**：运行时 `*.sqlite`/`*.db`、`.env.local`、生产密钥、构建产物、日志。

---

## 11. CSS 类名约定与已知边界

### 11.1 类名前缀

- 当前 UI 仅用 `shadcn-prototype-*`（工作台）和 `multimix-auth-*`（认证壳）两组前缀。
- `app/globals.css` 是单一全局样式表。历史 ChangeIn 样式已清理过，新增样式请沿用上述两组现役前缀，勿盲目复用陌生类名或引入新的顶层前缀。

### 11.2 已知占位 / 未接入项（非 bug）

- 静态占位按钮（无 onClick）：侧边栏搜索、顶栏「上传资产」、对话「发送」。
- 已定义但 UI 未渲染的数据：产物 `versions`/`actions`/`sourceIds`、`preview.eyebrow/posterText/prompt`；对话 `raw/judgment/action/canvasTitle/canvasMeta/sourceIds`；`workshop.kicker`；整个 `AssetSource`（`listSources` 无人调用）。
- 重命名 / 删除对话通过真实后端持久化；失败时恢复前端状态。

### 11.3 接入真实后端的最小改动面

1. 重写 `asset-workspace-adapter.ts`，导出符合 `AssetWorkspaceAdapter` 的新单例。
2. 若后端异步，需在 adapter 内缓存预取或将组件改为异步加载（当前同步读取假设是主要改造点）。
3. 服务端密钥走服务端代码路径，遵守 §10 数据边界。
4. **不要因为后端形态改 UI**——类型契约与组件 props 保持稳定。

---

## 12. 阶段 4 后端接口契约（V3 智能体工作台）

真实后端（MultiMix-Backend）为 V3 重设计新增/扩展的接口。前端一律经 `lib/api.ts` + `lib/asset-mappers.ts` 消费，且按规范 §12「数据不在就不渲染」降级——字段缺位时组件自身不渲染，禁止假数据。

### 12.1 生成步骤事件 `steps[]`（Agent 执行时间线）

视频任务状态接口（`VideoJobRead`，轮询与 retry 均透传）新增：

```jsonc
"steps": [
  { "key": "understand", "label": "理解素材与要求", "status": "done",    "elapsed_seconds": 8 },
  { "key": "plan",       "label": "规划分镜结构",   "status": "running", "elapsed_seconds": 3 },
  { "key": "generate",   "label": "生成与合成",     "status": "pending", "elapsed_seconds": null }
]
```

- ≥ 3 个语义步（理解/规划/生成），由 `render_stage` + 真实阶段时间戳（`result_payload.step_marks`）派生，禁止假进度。
- 旧后端缺字段 → adapter 解析为空数组 → 时间线回退 `render_stage` 映射（`videoJobTimelineSteps`）。

### 12.2 结构化确认卡 `metadata.plan`

编导稿草稿（`video_workflow_stage == "director_script_draft"`）的 assistant 消息 `metadata` 挂载 `plan` 对象：

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
- 确认按钮把 `confirm_utterance` 作为普通消息提交并附带一次性 `client_request_id`，命中后端确认门。
- 已持久化的确认结果可能是 `processing / video_project_queued`，此时展示排队状态，不能因有占位 metadata 就显示编辑器。

### 12.3 素材推荐端点（素材选择器 AI 推荐区）

`GET /v1/video/projects/{asset_id}/segments/{segment_id}/asset-suggestions`

- 返回 `{ segment_id, role, suggestions: [{ asset_id, title, media_type, preview_url, match_reason, matched_terms, match_confidence }] }`（按匹配度排序，只读）。
- `suggestions: []` → 选择器推荐区隐藏，仅显示图片库网格。
- 前端字段映射：`asset_id→id`、`preview_url→thumbnailUrl`、`match_reason→reason`。

### 12.4 局部重合成端点（分镜属性卡）

`POST /v1/video/projects/{asset_id}/segments/{segment_id}/recompose`

```jsonc
{ "operation": "replace_material" | "revoice" | "toggle_mg",
  "asset_id": 123,            // replace_material 必填
  "voiceover": "...",         // revoice 必填
  "mg_enabled": true,          // toggle_mg 必填
  "confirm_overwrite": false } // 见 12.5
```

- 只 patch 目标分镜的权威字段（`asset_reference`+`materials` / `narration` / `mg_decision`），随后复用整条编排重建工程（规范 §12 允许的降级，loading 文案按分钟级书写）。
- 返回 `VideoJobRead`（202）；错误：404 工程/分镜不存在、422 参数或素材不可用。

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

`test:display-components` 验证真实 React 组件；`test:display-e2e` 启动隔离前后端并运行八个浏览器案例；`test:display-coverage` 依次执行两层覆盖。
