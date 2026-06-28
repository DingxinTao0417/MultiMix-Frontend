# CLAUDE.md

本文件指导 Claude Code 在此仓库中工作。响应使用简体中文，代码注释保持英文且精简。

## 项目概述

MultiMix 是一个内容生成工作台（content generation workspace），用对话驱动生成文案、图片、视频、音频、数字人口播等产物，并内嵌浏览器端视频剪辑器。

本仓库是 **前端仓库**（`multimix_frontend`）。后端是独立仓库 `multimix_backend`（FastAPI，部署 Railway）。

- 前端：Next.js 15（本仓库根），部署 Vercel。
- 剪辑器：video-studio 的 OpenCut 引擎（`editor-engine/vendor/`），作为 `/editor` 路由嵌入。
- 后端（独立仓库）：FastAPI（ChangeIn 基座 + 视频编排模块），部署 Railway。

前端保留 adapter 层 + mock：未配 `NEXT_PUBLIC_API_BASE_URL` 时离线跑 mock，配了则走后端。不应为后端实现重写工作台 UI。

完整产品定位/交互规则见 `docs/MULTIMIX_WORKSPACE_DESIGN.md`；部署见 `docs/DEPLOYMENT.md`；改动前应先对照。

## 技术栈

- 前端：Next.js 15 (App Router) + React 19 + TypeScript strict、lucide-react、本地 `node:sqlite`（Node ≥ 22）、ESLint flat config
- 剪辑器：Tailwind v4 + Radix/shadcn + mediabunny(WebCodecs) + zustand（`editor-engine/vendor/`，从 video-studio 复制；tsc/eslint 已排除）

## 常用命令

```bash
npm run dev -- --hostname 127.0.0.1 --port 3200   # 前端开发
npm run setup:demo    # 从 schema + mock 数据重建 db/local/multimix.sqlite
npm run typecheck     # tsc --noEmit（排除 editor-engine/vendor）
npm run lint          # eslint .
npm run build         # next build（含 /editor，glsl/worker/Tailwind v4 已配）
```

改完前端至少跑 `typecheck` + `lint` + `build`；改完后端跑相关 pytest + ruff。

> 本地反复重启 `next start` 易留僵尸进程占旧端口、供过期构建。换端口或 `pkill -f next` + 清 `.next` 再起。

入口 URL：`/`、`/app/assets?conversation=<id>&product=<id>`、`/editor?asset=<id>`（或 `?job=<id>`）。未配后端时本地自动以 `demo@multimix.local` 登录；配了后端走真实登录拿 token。

## 架构

前端数据流：mock 数据 / 真实后端 → `app/assets/lib/asset-workspace-adapter.ts`（adapter 层，唯一后端边界）→ `components/` 组件。`lib/api.ts` 是 API 客户端，`lib/asset-mappers.ts` 把后端 ContentAsset 映射成前端 AssetProduct。

后端模块（feature flag 控制）：
- 知识库/资产 + 对话编排（`backend/app/api/assets.py` + `services/asset_conversation.py`，已有）
- 知识检索（`services/knowledge_retrieval.py`，把 Web 采集知识块喂给生成）
- 视频编排（`backend/app/api/video_orchestration.py` + `services/video_studio/`，topic→脚本→素材→timeline JSON，无 cmm 依赖）
- 监控/采集（ChangeIn 原功能，`CHANGEIN_MODULES_MONITORING_ENABLED=false` 可关）

### 文件结构与职责

```
app/
  page.tsx                          # 路由 "/"，渲染 <MultiMixApp basePath="/">
  editor/                           # /editor 剪辑器路由（dynamic ssr:false + Tailwind v4 CSS scope）
backend/                            # FastAPI 统一后端（ChangeIn 基座 + 视频编排）
editor-engine/vendor/               # OpenCut 剪辑器引擎（从 video-studio 复制，@editor/* 别名）
lib/                                # 前端 API 客户端 + mappers
  app/assets/page.tsx               # 路由 "/app/assets"，同上但 basePath 不同
  layout.tsx                        # 根布局（html lang=zh-CN）
  multimix-app.tsx                  # 本地认证壳：localStorage 自动登录，注入 searchParams
  globals.css                       # 单一全局样式表（见下方注意事项）
  assets/
    components/                     # UI 组件层（新增组件放这里）
      assets-workspace-client.tsx   # 主壳：全局状态、侧边栏、顶栏、拖拽分栏、布局编排
      conversation-studio.tsx       # 对话区：消息流、产物卡列表、输入框
      product-workspace.tsx         # 展示区容器：标题、详情抽屉、操作按钮、时间轴
      product-preview.tsx           # 按 product.mode 分发的预览（copy/image/audio/digital-human/video）
      library-workshop.tsx          # 资产库/文案库/视频库视图
    lib/                            # 数据 + 逻辑层（新增数据/adapter/helper 放这里）
      asset-workspace-types.ts      # 所有数据类型定义（AssetProduct/AssetConversation/...）
      asset-workspace-mock-data.ts  # mock 源数据（对话、产物、来源、workshop）
      asset-workspace-adapter.ts    # 数据访问接口，接真实后端时只改这里
      asset-workspace-shared.ts     # 跨组件共享：类型别名 + 纯 helper（无 JSX/状态）
db/
  schema.sql                        # 本地 SQLite 表结构
  README.md                         # 本地数据说明
scripts/
  db-init.ts                        # 读 schema + mock 数据，可复现地 seed db/local/multimix.sqlite
```

约定：UI 组件进 `app/assets/components/`，数据/adapter/共享 helper 进 `app/assets/lib/`。组件内互相引用用 `./xxx`，引用 lib 用 `../lib/xxx`。等 `components/` 长大可再分子目录（如 `workspace/`、`preview/`）。

### 组件关系

- `AssetsWorkspaceClient`（默认导出）是唯一持有状态的容器：选中对话/产物、侧边栏开合、分栏宽度、重命名/删除/复制/保存。所有子组件都是受控的纯展示组件，通过 props 接收数据和回调。
- 对话模式渲染 `ConversationStudio`（左）+ 拖拽手柄 +  `ProductWorkspace`（右）；库模式渲染 `LibraryWorkshop`。
- `ProductWorkspace` 内嵌 `ProductPreview`；预览逻辑按 mode 提前 return，新增产物类型只需加一个 `if` 分支。
- `asset-workspace-shared.ts` 存放被多个组件复用的东西：类型别名（`ActiveView`/`ProductMode`/`ProductArtifact`/`Conversation`）和纯函数（`getConversationProducts`/`resolveConversationProduct`/`getProductModeLabel`/`getProductRatioClass`）。新增跨组件 helper 放这里，不要在组件文件里重复定义。

### 改动指引

- 改某个区域的 UI/交互，直接定位到对应组件文件，不必动主壳。
- 加全局状态或跨区域联动，改 `assets-workspace-client.tsx` 并通过 props 下传。
- 接真实后端，替换 `asset-workspace-adapter.ts` 的实现，**不要因为后端形态改 UI**。

### UI 关键约定（来自设计文档）

对话决定产物类型；展示区只显示当前选中的单个产物，**不加一级产物类型 Tab**；产物切换靠对话流里的产物卡；详情走右侧抽屉；下一步建议放在助手回复里。数字人是视频的一种表现形式，不是一级产物类型。

## 数据边界（严格遵守）

- 提交：UI 代码、mock 数据、`db/schema.sql`、seed 脚本、文档
- **不提交**：运行时 `*.sqlite`/`*.db`、`.env.local`、生产密钥、构建产物、日志
- `LLM_API` 等服务端密钥**禁止**加 `NEXT_PUBLIC_` 前缀（会暴露到客户端）
- mock 数据是「源数据」，提交在 `app/assets/`；SQLite 运行库通过 seed 复现，不入库

## 已知问题 / 注意事项

- `app/globals.css` 约 25000 行，**约 92% 是从 ChangeIn 原项目继承的死样式**（`admin-*`、`ai-judgment-*`、`app-gate-*` 等）。当前 UI 只用 `shadcn-prototype-*` 和 `multimix-auth-*` 前缀。新增样式请用这些前缀；勿盲目复用陌生类名。
- 多个 mock 字段已定义但 UI 未渲染：`versions`、`actions`、`preview.prompt/eyebrow/posterText`、conversation 的 `raw/judgment/action/canvasTitle/canvasMeta`。属「数据已备、UI 待接入」，非 bug。
- 搜索、上传资产、发送等按钮目前是静态占位，无 onClick。
- `@supabase/supabase-js` 当前未被任何代码 import（为未来 Auth 预留）。

## 文件写入

单文件超 200 行时分多次 Edit 追加，避免一次性大写入失败。
