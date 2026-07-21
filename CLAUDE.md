# CLAUDE.md

本文件指导各类代码代理（含 Claude Code、Codex 等）在此仓库中工作。响应使用简体中文，代码注释保持英文且精简。

> 本文件与 `AGENTS.md` 内容一致（仅标题不同）。**只手改 `CLAUDE.md`**，然后运行 `npm run sync:agents` 重新生成 `AGENTS.md`；`npm run check:agents` 校验一致性并运行工作区文档准入检查。

## 项目概述

MultiMix 是一个内容生成工作台（content generation workspace），用对话驱动生成文案、图片、视频、音频、数字人口播、MG 动画等产物，并内嵌浏览器端视频剪辑器。

本仓库是 **前端仓库**（`MultiMix-Frontend`）。后端是独立仓库 `MultiMix-Backend`。本机两仓库并排放置：

- 前端：`C:\Users\24566\Desktop\multimix\MultiMix-Frontend`（Next.js 15，部署 Vercel）
- 后端：`C:\Users\24566\Desktop\multimix\MultiMix-Backend`（FastAPI，ChangeIn 基座 + 视频编排 + MG 动效，部署 Railway，详见其 `README.md`）

剪辑器是 video-studio 的 OpenCut 引擎（`editor-engine/vendor/`），作为 `/editor` 路由嵌入，也能以 `?embed=1` 模式内嵌进对话工作台。

前端保留 adapter 层 + mock：未配 `NEXT_PUBLIC_API_BASE_URL` 时离线跑 mock，配了则走后端。不应为后端实现重写工作台 UI。

完整产品定位、交互规则、资源库分类和数据边界见 `docs/MULTIMIX_WORKSPACE_DESIGN.md`；代码契约（adapter、类型、路由、环境变量、CSS 约定）见 `docs/API.md`；部署见 `docs/DEPLOYMENT.md`；功能缺口与待完善清单见 `docs/GAPS.md`。工作区文档地图见 `../docs/README.md`。Agent 编排、对话循环、能力边界、状态/记忆、工具执行和 eval 的权威规范见后端 `../MultiMix-Backend/docs/MULTIMIX_AGENT_ARCHITECTURE.md`。素材理解、素材库理解状态、`video_plan`、`video_segments`、素材匹配、分镜级素材引用相关规范，统一以工作区根目录 `../docs/authority/asset-understanding-and-segment-referencing.md` 与根级 `../AGENTS.md` 为准。改动资产库、文案库、图片库、视频库、新建创作、对话流、产物卡、详情、检索或 Agent 对话相关能力前，必须先对照这些设计文档，不要重新发明分类体系或对话编排规则。

## 技术栈

- 前端：Next.js 15 (App Router) + React 19 + TypeScript strict、lucide-react、react-markdown、Supabase Auth（可选）、ESLint flat config（`next/core-web-vitals` + `next/typescript`）、vitest
- 剪辑器：Tailwind v4 + Radix/shadcn + mediabunny(WebCodecs) + zustand（`editor-engine/vendor/`，从 video-studio 复制；tsc/eslint 均排除该目录）
- 后端：FastAPI 0.115 + SQLAlchemy 2.0（SQLite 本地 / Postgres+Supabase 生产）+ Redis/RQ worker + Modal（MG 渲染），Python ≥ 3.11

## 常用命令

前端（本仓库）：

```bash
npm run dev -- --hostname 127.0.0.1 --port 3200   # 前端开发
npm run typecheck     # tsc --noEmit（排除 editor-engine/vendor）
npm run lint          # eslint .
npm run test          # vitest run（app/assets/__tests__ + editor-engine/vendor/buildProject.test.ts）
npm run build         # next build（含 /editor，glsl/worker/Tailwind v4 已配）
npm run sync:agents   # 由 CLAUDE.md 重新生成 AGENTS.md
npm run docs:check    # 检查根 docs 分类、状态头、旧路径和 UI 原型归档规则
npm run test:docs-check # 单测 docs:check 的守门逻辑
npm run check:backend # 跨仓库快捷方式：跑后端 ruff + pytest 回归集
```

后端（`../MultiMix-Backend`）：

```bash
.venv\Scripts\python -m uvicorn app.main:app --port 8199
.venv\Scripts\python -m pytest app/tests/test_asset_conversation.py app/tests/test_video_orchestration.py app/tests/test_config.py -q
.venv\Scripts\python -m ruff check --line-length 100 app/
```

改完前端至少跑 `typecheck` + `lint` + `test` + `build`；改完后端跑相关 pytest + ruff。两个仓库都配了 GitHub Actions CI（`.github/workflows/ci.yml`），push/PR 会自动跑同样的检查。

> 本地反复重启 `next start` 易留僵尸进程占旧端口、供过期构建。换端口或 `pkill -f next` + 清 `.next` 再起。

入口 URL：`/`、`/app/assets?conversation=<id>&product=<id>`、`/editor?asset=<id>`（或 `?job=<id>`；`&embed=1` 为工作台内嵌模式）、`/admin/public-sources`（公开素材源管理，需真实后端）。

认证两种模式：`NEXT_PUBLIC_MULTIMIX_AUTH_MODE=local` 或未配 Supabase 时，自动以 `demo@multimix.local` 登录（仅存浏览器 `localStorage`）；配置 `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 后走 Supabase Auth（PKCE、自动刷新 token），后端对应 `CHANGEIN_AUTH_PROVIDER`。`lib/supabase.ts` 在未配置时导出 `null`，代码不得假设其非空。

## 架构

前端数据流：真实后端 → `app/assets/lib/asset-workspace-adapter.ts`（adapter 层，唯一后端边界）→ `components/` 组件。API 未配置、加载中、真实空列表和加载失败必须显示明确状态，禁止回退演示数据。`lib/api.ts` 是 API 客户端（唯一 base-URL 解析与 Bearer 注入点，401 时广播 `multimix:auth-expired` 事件），`lib/asset-mappers.ts` 把后端 ContentAsset 映射成前端 AssetProduct，`lib/supabase.ts` 是可选 Supabase Auth 客户端。

后端模块（feature flag 控制，开关表见后端 `README.md`，路径均为后端仓库内路径）：

- 资产/知识库 + Agent 对话编排：`app/api/assets.py` + `services/asset_conversation.py`、`services/conversation_orchestrator.py`；Agent 运行时必须以后端 `docs/MULTIMIX_AGENT_ARCHITECTURE.md` 为准：LLM 只做结构化理解和规划，后端负责能力校验、工具执行、持久化、来源约束和确认门；启用 Agent 时，新 Agent 是产品对话唯一编排层，旧 `_should_*`/直接生成逻辑只能作为已验证动作的执行器或显式关闭 Agent 后的回滚路径，不能在 Agent 未处理时继续作为第二套意图判断入口
- 知识检索：`services/knowledge_retrieval.py`、`saved_context_retriever.py`（把已保存资产和网页知识块喂给生成，不自动全网搜索）
- 视频编排：`app/api/video_orchestration.py` + `services/video_studio/`（topic→脚本→素材→TTS→timeline JSON；RQ worker 异步，或 `CHANGEIN_VIDEO_ORCHESTRATION_INLINE=true` 同步）
- MG 动效：后端 `remotion/`（Remotion 工程，渲染带 alpha 的 WebM overlay）+ `services/remotion_modal/`（Modal 远程渲染），spec 由 `services/mg_scene_spec.py` 校验，详见后端 `remotion/README.md`
- 监控/采集（ChangeIn 原功能）：`CHANGEIN_MODULES_MONITORING_ENABLED=false` 可整体关闭

### 文件结构与职责（前端）

```
app/
  page.tsx                          # 路由 "/"，渲染 <MultiMixApp basePath="/">
  app/assets/page.tsx               # 路由 "/app/assets"，同上但 basePath 不同
  layout.tsx                        # 根布局（html lang=zh-CN）
  multimix-app.tsx                  # 认证壳：Supabase / local 自动登录，注入 searchParams
  globals.css                       # 单一全局样式表（前缀约定见「已知问题」）
  editor/                           # /editor 剪辑器路由（dynamic ssr:false + Tailwind v4 CSS scope）
  admin/public-sources/page.tsx     # 公开素材源管理页（需真实后端）
  assets/
    __tests__/                      # vitest 单测（agent 文案、asset-mappers）
    components/                     # UI 组件层（新增组件放这里）
      assets-workspace-client.tsx   # 主壳：全局状态、侧边栏、顶栏、拖拽分栏、布局编排
      conversation-start.tsx        # 新对话空白起始页（建议 + 首条消息输入框）
      conversation-studio.tsx       # 对话区：消息流、产物卡列表、输入框
      product-workspace.tsx         # 展示区容器：标题、详情浮层、操作按钮、时间轴
      product-preview.tsx           # 按 product.mode 分发的预览（copy/image/audio/digital-human/video）
      library-workshop.tsx          # 资产库/文案库/图片库/视频库视图
    lib/                            # 数据 + 逻辑层（新增数据/adapter/helper 放这里）
      asset-workspace-types.ts      # 所有数据类型定义（AssetProduct/AssetConversation/...）
      asset-workspace-empty-data.ts # 未配置/加载前使用的空结构，不含演示内容
      asset-workspace-adapter.ts    # 数据访问接口，接真实后端时只改这里
      asset-workspace-shared.ts     # 跨组件共享：类型别名 + 纯 helper（无 JSX/状态）
lib/
  api.ts                            # 后端 API 客户端
  asset-mappers.ts                  # 后端 ContentAsset → 前端 AssetProduct 映射
  supabase.ts                       # 可选 Supabase Auth 客户端（未配置时为 null）
editor-engine/vendor/               # OpenCut 剪辑器引擎 + buildProject 等接入层（@editor/* 别名）
scripts/
  sync-agents-md.mjs                # CLAUDE.md → AGENTS.md 同步/校验
```

约定：UI 组件进 `app/assets/components/`，数据/adapter/共享 helper 进 `app/assets/lib/`。组件内互相引用用 `./xxx`，引用 lib 用 `../lib/xxx`。等 `components/` 长大可再分子目录（如 `workspace/`、`preview/`）。

### 组件关系

- `AssetsWorkspaceClient`（默认导出）是唯一持有状态的容器：选中对话/产物、侧边栏开合、分栏宽度、重命名/删除/复制/保存。所有子组件都是受控的纯展示组件，通过 props 接收数据和回调。
- 对话模式渲染 `ConversationStudio`（左）+ 拖拽手柄 + `ProductWorkspace`（右）；新对话未发首条消息时渲染 `ConversationStart`；库模式渲染 `LibraryWorkshop`。
- `ProductWorkspace` 内嵌 `ProductPreview`；预览逻辑按 mode 提前 return，新增产物类型只需加一个 `if` 分支。视频工程的「内嵌剪辑器」由 `product-workspace.tsx` 里的 iframe（`/editor?…&embed=1`）实现；`VideoProjectWorkspace` 组件目前无调用方。
- `ProductWorkspace`/`EmptyProductWorkspace`/`LibraryWorkshop` 在主壳中经 `next/dynamic` 懒加载（按 activeView 分包），`ConversationStudio` 保持静态引入。
- `asset-workspace-shared.ts` 存放被多个组件复用的东西：类型别名（`ActiveView`/`ProductMode`/`ProductArtifact`/`Conversation`）和纯函数（`getConversationProducts`/`resolveConversationProduct`/`getProductModeLabel`/`getProductRatioClass`）。新增跨组件 helper 放这里，不要在组件文件里重复定义。

### 改动指引

- 改某个区域的 UI/交互，直接定位到对应组件文件，不必动主壳。
- 加全局状态或跨区域联动，改 `assets-workspace-client.tsx` 并通过 props 下传。
- 接真实后端能力，扩展 `asset-workspace-adapter.ts` 的实现，**不要因为后端形态改 UI**。

### UI 关键约定（来自设计文档）

对话决定产物类型；展示区只显示当前选中的单个产物，**不加一级产物类型 Tab**；产物切换靠对话流里的产物卡；库详情用居中模态弹窗，工作台产物详情用顶部「详情」浮层；下一步建议放在助手回复里。数字人是视频的一种表现形式，不是一级产物类型。面向普通用户的文案只出现「文案、图片、视频、确认生成」等表达，内部能力名/模型名/调试状态留在后端 metadata 或管理员诊断入口。

#### 视频预览壳不可回退门禁

- `docs/MULTIMIX_WORKSPACE_DESIGN.md` 的 `video-preview-shell-contract:v1` 与工作区原型 `../docs/specs/ui/prototypes/current/screens/workspace-video.html` 是权威。播放器外壳固定为白底、`1px solid #eae7e1`、`20px` 圆角、`7px` 内边距和双层柔和阴影；媒体画布内部可以黑底无边框，但不得把“画布无边框”解释为“播放器无外壳”。
- 横竖比例只应用到媒体画布，不能应用到包含底部控制条的整个播放器；浏览态不得增加固定高度容器或独立纵向拖拽条，播放器后应直接衔接分镜摘要。
- 播放控件必须保持原型数值：`44px` 圆形按钮、`16px` 图标、悬停 `scale(1.07)`、控制区 `8px 6px 4px`、`3px` 渐变进度轨，禁止恢复浏览器原生 range 滑块。
- 成片播放器和无成片分镜预览必须共用白色细边框、圆角与阴影外壳；待补素材、首帧未加载和失败提示画布默认为白色，禁止退回无提示黑块。
- `.shadcn-prototype-preview-player*`、`video-preview-player.tsx`、播放器契约测试、展示区 E2E 和截图基线是受保护链路。除非用户在当次任务中明确批准新的视觉方向，否则禁止改成 frameless、黑底外壳、零内边距或无阴影。
- 禁止只修改实现和测试期望来证明新样式正确。契约变化必须同步更新设计依据、当前原型、独立契约检查和浏览器截图基线，并记录当次用户批准。
- 改动受保护链路后必须运行 `npm run check:video-preview-contract`、`npm run test:product-stage-style` 和隔离的 `npm run test:display-coverage`。

### 资源库分类（以设计文档为准）

- 资产库按来源分类：`上传资料`、`采集资料`、`对话沉淀`。不显示用途标签；内容类型、检索关键词、解析和索引状态放在详情层或检索层。
- 文案库分类固定为：`选题方案`、`文案稿`、`配音稿`、`编导稿`。
- 图片库分类固定为：`封面图`、`素材图`、`分镜图`。
- 视频库分类固定为：`混剪视频`、`数字人视频`、`MG动画视频`、`实景拍摄视频`、`生成视频素材`。
- 文案库、图片库和视频库列表只显示一个正式分类，不显示额外版本、状态或关键词标签。点击库条目用居中模态弹窗打开详情；数字人视频详情只展示口播文稿，不展示分镜部分。

## 沟通与回复格式

- 默认使用简洁的项目符号（bullets）组织回复，先给结论，再列关键结果、影响和下一步。
- 除非用户明确要求代码、命令、文件行号、实现原理或调试过程，否则不要展开过于具体的代码细节；优先说明产品行为和用户影响。
- 需要报告技术证据时，只保留支撑结论所必需的信息，避免粘贴大段代码、日志或内部实现。

## 数据边界（严格遵守）

- 提交：UI 代码、测试专用最小 fixtures、文档
- **不提交**：运行时 `*.sqlite`/`*.db`、`.env.local`、生产密钥、构建产物、日志
- `LLM_API` 等服务端密钥**禁止**加 `NEXT_PUBLIC_` 前缀（会暴露到客户端）
- 生产运行时只消费真实后端；测试 fixture 只能位于测试目录且不得被生产模块 import

## 提交与同步流程

当用户说“提交代码”时，默认只完成本地 `main`：确认范围并检查 -> 创建本地提交 -> 报告本地提交结果。不得自动 fetch、合并远端或推送。“合并代码”也只在本地 `main` 完成用户明确指定的合并。只有用户在当次请求中明确要求“推送到远端”或等效表述时，才执行 fetch、远端分叉检查、远端合并、推送和最终远端同步校验。当前工作区包含两个独立仓库：

- 前端：`C:\Users\24566\Desktop\multimix\MultiMix-Frontend`
- 后端：`C:\Users\24566\Desktop\multimix\MultiMix-Backend`

### 提交前

1. 先运行 `node scripts/workspace-submit-guard.mjs begin` 获取工作区单写入锁并保存输出令牌；没有令牌时禁止 commit、merge 或 push。分别在前端和后端运行 `git status --short --branch`，确认当前分支、未提交改动和本次实际提交范围。
2. 不要提交 `.env*`、密钥、本地数据库（含后端根目录 `changein.sqlite3`）、构建产物、日志或用户未要求纳入的临时文件。
3. 如果发现不属于当前任务的陌生改动，明确列出并保留在工作区；不要擅自回滚，也不要静默带入提交。

### 自动检查

提交前必须按仓库实际改动运行检查：

- 前端有代码或文档改动时，至少运行：
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run check:agents`（校验 `CLAUDE.md` 与 `AGENTS.md` 一致，并运行 `docs:check`；只改了其一时会失败，跑 `npm run sync:agents` 修复）
  - 改动 `scripts/check-docs.mjs` 或文档准入规则时，加跑 `npm run test:docs-check`
  - 影响构建、路由、依赖、Next 配置、数据 adapter 或关键 UI 时，再运行 `npm run build`
- 后端有代码改动时，运行对应测试。当前优先运行：
  - `.venv\Scripts\python -m pytest app/tests/test_asset_conversation.py app/tests/test_video_orchestration.py app/tests/test_config.py -q`
  - `.venv\Scripts\python -m ruff check --line-length 100 app/`
  - 改动涉及其他模块（MG、编排器、采集等）时，加跑 `app/tests/` 下对应的 `test_*.py`。

检查失败时停止提交或推送，先修复问题；如果无法修复，向用户报告失败命令和原因。

自动检查完成后运行 `node scripts/workspace-submit-guard.mjs verify --token <token>`；如果 HEAD、暂存区、文件集合或内容与开始检查时不同，说明有并发或晚到修改，必须停止。

### 提交

1. 每个仓库独立提交，不把前端和后端混成一个 git 操作。
2. 使用窄路径 `git add -- <path>...` 暂存本次任务文件；同一文件混有无关改动时按 hunk 拆分暂存。禁止用 `git add -A` 静默扫入陌生改动。
3. 提交信息要概括实际变更，例如：
   - `Update MultiMix workspace libraries and conversation flow`
   - `Update asset upload validation and conversation assets`
4. 创建本地提交后再次运行 `git status --short --branch`，确认目标改动已经提交；允许保留已明确排除的无关脏文件，但必须报告。
5. 用户未明确要求远端推送时，在此结束并运行 `node scripts/workspace-submit-guard.mjs end --token <token>` 释放锁；只有进入明确授权的远端流程时才运行 checkpoint。

### 远端拉取与合并（仅用户明确要求推送到远端时）

1. 本地提交完成后，在前端和后端分别运行 `git fetch origin --prune`。
2. 运行 `git rev-list --left-right --count HEAD...origin/main` 检查 ahead/behind；落后为 0 时，用 `git merge --ff-only origin/main` 确认远端是当前提交的祖先或已经同步。
3. 本地落后或双方分叉时，先运行 `git log --oneline --left-right --cherry-pick --graph HEAD...origin/main` 理解双方提交，再运行 `git merge --no-edit origin/main` 合并远端最新代码。
4. 遇到冲突时不要强行覆盖，也不要继续推送：
   - 停止自动流程。
   - 用 `git status --short` 和冲突文件列表说明具体冲突。
   - 只在理解双方改动后编辑冲突文件。
   - 冲突解决后重新运行必要检查，再完成 merge commit。
5. 禁止使用 `git reset --hard`、`git checkout -- .` 等破坏性命令，除非用户明确要求。

### 推送（仅用户明确要求推送到远端时）

1. 只有用户在当次请求中明确要求推送到远端，且目标提交检查通过、远端合并完成且没有冲突后，才运行 `git push origin main`；已明确排除的无关脏文件可以继续留在工作区。
2. push 前必须运行 `node scripts/workspace-submit-guard.mjs verify --token <token>`；检测到任何晚到变化时立即停止。
3. 推送后再次运行 `git fetch origin --prune`、`git status --short --branch` 和 `git rev-list --left-right --count HEAD...origin/main`。
4. 比较 `git rev-parse HEAD`、`git rev-parse origin/main` 与 `git ls-remote origin refs/heads/main`，确认本地、远端跟踪分支和真实远端分支一致。
5. 最终远端核对完成后运行 `node scripts/workspace-submit-guard.mjs end --token <token>` 释放工作区锁。
6. 最终回复需要说明：
   - 哪些仓库已提交和推送。
   - 最新提交哈希和提交信息。
   - 是否发生冲突以及如何处理。
   - 哪些检查已经通过，哪些检查未能运行及原因。
   - 哪些无关文件仍未提交。

## 已知问题 / 注意事项

- `app/globals.css` 是单一全局样式表，ChangeIn 时代的死样式已清理。现役前缀是 `shadcn-prototype-*`（工作台）和 `multimix-auth-*`（登录壳）。新增样式沿用这些前缀，不要引入新的顶层前缀。主题为 V3 智能体工作台（规范：`../docs/specs/ui/agentic-workbench-design.md`）：`:root` 与 `--sp-*` 双层 token，暖亮底（`--bg`/`--surface`/`--ink` 系）+ 品牌渐变族 `--ai-a`/`--ai-b`/`--ai-grad`/`--ai-soft`。**渐变纪律**：`--ai-grad` 只用于「AI 正在参与」的时刻（确认卡描边、时间线运行步、生成极光、发送按钮、理解徽章圆点、输入坞描边等）；普通交互一律中性色或 `--accent` 单色。动画必须带 `prefers-reduced-motion` 降级（文件末尾统一处理）。
- `editor-engine/vendor/editor/` 内部的 `__tests__` 用 bun:test，已在 `vitest.config.ts` 里排除；`npm run test` 只跑 `app/assets/__tests__/` 和 vendor 根下的 `buildProject.test.ts`。
- 前端不创建或读取本地 SQLite；浏览器工作台只消费真实后端数据。
- Supabase Auth 是可选路径：未配置时一切走 local 模式，`lib/supabase.ts` 导出 `null`，不要写死非空假设。
- 后端根目录的 `changein.sqlite3` 是本地开发数据库，不入库、不删除。
- 跑浏览器 E2E / UI 冒烟需要独立后端时：用一次性本地 SQLite（`CHANGEIN_DATABASE_URL=sqlite:///./<临时名>.sqlite3`），禁止连 Supabase 主库或 `changein.sqlite3`；测试结束必须杀掉自己启动的 uvicorn 并删除临时库（脚本用 try/finally 兜底）。启动 8199 后端前先 `netstat -ano | findstr :8199` 确认端口干净——Windows 上 uvicorn 的 SO_REUSEADDR 允许多进程静默共占同一端口，不报错但请求会被残留进程截走，前端表现为"连到了另一个数据库"（对话列表只剩测试数据）。测试专用的前端实例同样必须用独立端口：禁止占用开发者正在使用的 3117/3200，禁止杀掉或替换开发者的 next dev，禁止用 OS 环境变量 `NEXT_PUBLIC_API_BASE_URL` 把开发者的前端指向测试后端。

## 文件写入

单文件超 200 行时分多次 Edit 追加，避免一次性大写入失败。
