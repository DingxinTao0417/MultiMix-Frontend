# AGENTS.md

本文件指导各类代码代理在此仓库中工作。响应使用简体中文，代码注释保持英文且精简。

## 项目概述

MultiMix 是一个内容生成工作台（content generation workspace）原型，用对话驱动生成文案、图片、视频、音频、数字人口播等产物。当前为**前端优先 + 本地 mock 数据**阶段，真实后端通过 adapter 层在未来接入，不应为后端实现重写 UI。

完整产品定位、交互规则和数据边界见 `docs/MULTIMIX_WORKSPACE_DESIGN.md`，改动前应先对照该文档。

## 技术栈

- Next.js 15 (App Router) + React 19 + TypeScript (strict)
- lucide-react 图标
- 本地数据：`node:sqlite`（实验性 API，**要求 Node ≥ 22**）
- ESLint flat config（`next/core-web-vitals` + `next/typescript`）

## 常用命令

```bash
npm run dev -- --hostname 127.0.0.1 --port 3200   # 本地开发
npm run setup:demo    # 从 schema + mock 数据重建 db/local/multimix.sqlite（可重复运行重置）
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm run build         # next build
```

改完代码后至少跑 `typecheck` + `lint` + `build` 验证。

入口 URL：`/` 和 `/app/assets?conversation=<id>&product=<id>`。本地自动以 `demo@multimix.local` 登录，用户仅存在浏览器 `localStorage`。

## 架构

数据流：`app/assets/lib/asset-workspace-mock-data.ts` → `app/assets/lib/asset-workspace-adapter.ts`（adapter 层）→ `app/assets/components/` 下的 React 组件。组件树都挂在 `app/assets/` 下，UI 与数据/逻辑分两层目录。

### 文件结构与职责

```text
app/
  page.tsx                          # 路由 "/"，渲染 <MultiMixApp basePath="/">
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
- 对话模式渲染 `ConversationStudio`（左）+ 拖拽手柄 + `ProductWorkspace`（右）；库模式渲染 `LibraryWorkshop`。
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
- 搜索、上传资产、发送等按钮目前是静态占位，无 `onClick`。
- `@supabase/supabase-js` 当前未被任何代码 import（为未来 Auth 预留）。

## 文件写入

单文件超 200 行时分多次 Edit 追加，避免一次性大写入失败。
