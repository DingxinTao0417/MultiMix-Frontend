# AGENTS.md

本文件指导各类代码代理在此仓库中工作。响应使用简体中文，代码注释保持英文且精简。

## 项目概述

MultiMix 是一个内容生成工作台（content generation workspace）原型，用对话驱动生成文案、图片、视频、音频、数字人口播等产物。当前为**前端优先 + 本地 mock 数据**阶段，真实后端通过 adapter 层在未来接入，不应为后端实现重写 UI。

完整产品定位、交互规则、资源库分类和数据边界见 `docs/MULTIMIX_WORKSPACE_DESIGN.md`。改动资产库、文案库、图片库、视频库、新建创作、对话流、产物卡、详情抽屉或检索相关能力前，必须先对照该文档，不要重新发明分类体系。

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
      library-workshop.tsx          # 资产库/文案库/图片库/视频库视图
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

资源库分类以设计文档为准：

- 资产库按来源分类：`上传资料`、`采集资料`、`对话沉淀`。不显示用途标签；内容类型、检索关键词、解析和索引状态放在详情层或检索层。
- 文案库分类固定为：`选题方案`、`文案稿`、`配音稿`、`编导稿`。
- 图片库分类固定为：`封面图`、`素材图`、`分镜图`。
- 视频库分类固定为：`混剪视频`、`数字人视频`、`MG动画视频`、`实景拍摄视频`、`生成视频素材`。
- 文案库、图片库和视频库列表只显示一个正式分类，不显示额外版本、状态或关键词标签。点击条目从右侧抽屉打开详情；数字人视频详情只展示口播文稿，不展示分镜部分。

## 数据边界（严格遵守）

- 提交：UI 代码、mock 数据、`db/schema.sql`、seed 脚本、文档
- **不提交**：运行时 `*.sqlite`/`*.db`、`.env.local`、生产密钥、构建产物、日志
- `LLM_API` 等服务端密钥**禁止**加 `NEXT_PUBLIC_` 前缀（会暴露到客户端）
- mock 数据是「源数据」，提交在 `app/assets/`；SQLite 运行库通过 seed 复现，不入库

## 提交与同步流程

当用户要求“提交代码”、“拉最新代码”、“合并代码”、“处理冲突”、“推送远程”或类似发布动作时，默认按下面流程自动执行，不需要再停下来只给计划。当前工作区通常包含两个独立仓库：

- 前端：`C:\Users\24566\Desktop\multimix\MultiMix-Frontend`
- 后端：`C:\Users\24566\Desktop\multimix\MultiMix-Backend`

### 提交前

1. 分别在前端和后端运行 `git status --short --branch`，确认当前分支、未提交改动和是否领先/落后远程。
2. 不要提交 `.env*`、密钥、本地数据库、构建产物、日志或用户未要求纳入的临时文件。
3. 如果发现不属于当前任务的大量陌生改动，先说明风险；不要擅自回滚。

### 自动检查

提交前必须按仓库实际改动运行检查：

- 前端有代码或文档改动时，至少运行：
  - `npm run typecheck`
  - `npm run lint`
  - 影响构建、路由、依赖、Next 配置、数据 adapter 或关键 UI 时，再运行 `npm run build`
- 后端有代码改动时，运行对应测试。当前优先运行：
  - `python -m pytest app/tests/test_asset_conversation.py`
  - 如果测试环境命令不同，先用仓库现有说明或可用测试命令判断，不要跳过不说明。

检查失败时停止提交或推送，先修复问题；如果无法修复，向用户报告失败命令和原因。

### 提交

1. 每个仓库独立提交，不把前端和后端混成一个 git 操作。
2. 使用 `git add -A` 暂存当前仓库需要提交的改动。
3. 提交信息要概括实际变更，例如：
   - `Update MultiMix workspace libraries and conversation flow`
   - `Update asset upload validation and conversation assets`
4. 提交后再次运行 `git status --short --branch`，确认工作区干净。

### 拉取与合并

1. 先运行 `git fetch origin`。
2. 优先使用 `git pull --rebase` 或 `git rebase origin/main` 把本地提交放到远程最新提交之后，保持历史线性。
3. 如果只是确认是否有更新，可以先用 `git pull --ff-only`；出现分叉时再改用 rebase。
4. 遇到冲突时不要强行覆盖：
   - 停止自动流程。
   - 用 `git status --short` 和冲突文件列表说明具体冲突。
   - 只在理解双方改动后编辑冲突文件。
   - 冲突解决后运行必要检查，再 `git rebase --continue`。
5. 禁止使用 `git reset --hard`、`git checkout -- .` 等破坏性命令，除非用户明确要求。

### 推送

1. 只有在工作区干净、检查通过、rebase/合并完成后，才运行 `git push origin main`。
2. 推送后再次运行 `git status --short --branch`，确认本地 `main` 和 `origin/main` 同步。
3. 最终回复需要说明：
   - 哪些仓库已提交和推送。
   - 最新提交哈希和提交信息。
   - 是否发生冲突以及如何处理。
   - 哪些检查已经通过，哪些检查未能运行及原因。

## 已知问题 / 注意事项

- `app/globals.css` 约 25000 行，**约 92% 是从 ChangeIn 原项目继承的死样式**（`admin-*`、`ai-judgment-*`、`app-gate-*` 等）。当前 UI 只用 `shadcn-prototype-*` 和 `multimix-auth-*` 前缀。新增样式请用这些前缀；勿盲目复用陌生类名。
- 多个 mock 字段已定义但 UI 未渲染：`versions`、`actions`、`preview.prompt/eyebrow/posterText`、conversation 的 `raw/judgment/action/canvasTitle/canvasMeta`。属「数据已备、UI 待接入」，非 bug。
- 搜索、上传资产、发送等按钮目前是静态占位，无 `onClick`。
- `@supabase/supabase-js` 当前未被任何代码 import（为未来 Auth 预留）。

## 文件写入

单文件超 200 行时分多次 Edit 追加，避免一次性大写入失败。
