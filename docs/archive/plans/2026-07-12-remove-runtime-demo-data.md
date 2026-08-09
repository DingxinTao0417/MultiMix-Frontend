# 移除前端运行时演示数据实施计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-12

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` inline. Subagent execution is prohibited unless the user separately approves it. Steps use checkbox syntax for tracking.

**Goal:** 前端生产运行时只展示真实后端数据，未配置、加载中、真实空列表和加载失败均显示明确状态，mock 仅作为测试 fixture。

**Architecture:** 保留 `AssetWorkspaceAdapter` 接口，但把生产单例改为真实后端 adapter，并用空的结构性默认值满足同步 UI 契约。`AssetsWorkspaceClient` 和资源库组件显式维护加载状态，任何错误都不再回退 mock。完整演示源文件直接删除；测试只重建覆盖具体契约所需的最小 fixture。旧 SQLite demo seed 命令和生产文档入口删除。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest、Testing Library。

## Global Constraints

- 生产入口、生产 adapter 和生产组件不得 import mock fixture。
- 后端成功返回空数组时保持真实空态。
- 请求失败不得显示演示对话或演示资产。
- API 未配置时不得伪造创建、保存、修订或生成成功。
- 不创建、重建或保留任何本地 SQLite 文件。

---

### Task 1: 建立真实运行时 adapter 与空结构默认值

**Files:**

- Modify: `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`
- Delete: `MultiMix-Frontend/app/assets/lib/asset-workspace-mock-data.ts`
- Reuse: 现有聚焦测试数据；不新增完整 workspace fixture
- Test: `MultiMix-Frontend/app/assets/__tests__/asset-workspace-adapter.test.ts`

**Interfaces:**

- Produces: `assetWorkspaceAdapter`，生产运行时不依赖 fixture；同步读取返回空对话、空 workshop 和结构合法的新对话壳。

- [x] **Step 1: 写失败测试**
  - 断言生产 adapter 源码不包含 `asset-workspace-mock-data` 或 `mockAssetWorkspaceData`。
  - 断言 API 未配置时写操作拒绝执行，而不是返回本地成功。
- [x] **Step 2: 运行测试确认 RED**
  - Run: `npm test -- app/assets/__tests__/asset-workspace-adapter.test.ts`
  - Expected: 因生产 adapter 仍 import mock 并返回本地成功而失败。
- [x] **Step 3: 最小实现**
  - 删除完整 mock 源文件。
  - 仅在测试确有需要时新增最小 fixture；现有聚焦测试已覆盖本次契约，因此不复制演示 workspace 数据。
  - 创建空 snapshot 常量和真实 adapter 工厂；生产单例使用空 snapshot。
  - 无 API 或无 token 的写操作抛出“未连接后端”。
- [x] **Step 4: 运行测试确认 GREEN**
  - Run: `npm test -- app/assets/__tests__/asset-workspace-adapter.test.ts`
  - Expected: PASS。

### Task 2: 对话列表显式加载状态

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`
- Modify: `MultiMix-Frontend/app/globals.css`
- Test: `MultiMix-Frontend/app/assets/__tests__/agent-ui-copy.test.ts`

**Interfaces:**

- Produces: `ConversationLoadState = "unconfigured" | "loading" | "ready" | "error"`；对话列表按状态渲染骨架、真实列表、空态或错误重试。

- [x] **Step 1: 写失败测试**
  - 断言客户端初始对话为 `[]`，不调用 `listConversations()` 初始化。
  - 断言存在“正在加载你的对话”“还没有对话”“对话加载失败”“未连接后端”和“重新加载”。
  - 断言失败分支不再出现“显示本地样例数据”。
- [x] **Step 2: 运行测试确认 RED**
  - Run: `npm test -- app/assets/__tests__/agent-ui-copy.test.ts`
  - Expected: 新契约缺失而失败。
- [x] **Step 3: 最小实现**
  - 对话 state 从空数组开始；后端模式进入 `loading` 后请求真实列表。
  - 成功进入 `ready`，空数组显示 0 和空状态；失败进入 `error`。
  - 未配置进入 `unconfigured`，创建、上传和发送入口禁用。
  - “重新加载”只增加请求 revision 并重试真实接口。
- [x] **Step 4: 运行测试确认 GREEN**
  - Run: `npm test -- app/assets/__tests__/agent-ui-copy.test.ts`
  - Expected: PASS。

### Task 3: 资源库停止回退 mock

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/library-workshop.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/materials-ready-strip.tsx`
- Test: `MultiMix-Frontend/app/assets/__tests__/library-workspace-state.test.tsx`

**Interfaces:**

- Produces: 资源库 `loading | ready | error | unconfigured` 状态；列表数据只取后端成功响应。

- [x] **Step 1: 写失败测试**
  - 断言 token 缺失/API 未配置时不读取 `getWorkshop(...).rows` 作为展示数据。
  - 断言请求失败显示错误，不回退 fixture；真实空数组保持空态。
- [x] **Step 2: 运行测试确认 RED**
  - Run: `npm test -- app/assets/__tests__/library-workspace-state.test.tsx`
  - Expected: 当前 `backendRows ?? workshop.rows` 回退导致失败。
- [x] **Step 3: 最小实现**
  - `LibraryWorkshop` 的 rows 初始为空；错误与未配置显示专用空状态。
  - `MaterialsReadyStrip` 在未成功取得真实数据时直接隐藏。
- [x] **Step 4: 运行测试确认 GREEN**
  - Run: `npm test -- app/assets/__tests__/library-workspace-state.test.tsx`
  - Expected: PASS。

### Task 4: 清理 demo seed 与更新文档

**Files:**

- Delete: `MultiMix-Frontend/scripts/db-init.ts`
- Delete: `MultiMix-Frontend/db/schema.sql`
- Delete: `MultiMix-Frontend/db/README.md`
- Modify: `MultiMix-Frontend/package.json`
- Modify: `MultiMix-Frontend/README.md`
- Modify: `MultiMix-Frontend/docs/API.md`
- Modify: `MultiMix-Frontend/docs/MULTIMIX_WORKSPACE_DESIGN.md`
- Modify: `MultiMix-Frontend/CLAUDE.md`
- Generated: `MultiMix-Frontend/AGENTS.md`

**Interfaces:**

- Produces: 不再暴露 `setup:demo`/`db:init`；文档描述真实运行时与测试 fixture 边界。

- [x] **Step 1: 写失败契约**
  - 在现有文档/agent 检查中断言生产路径不再引用 `setup:demo`、`db-init.ts` 或运行时 mock 真源。
- [x] **Step 2: 删除 demo seed 链路并更新文档**
  - 删除脚本与数据库 schema 文档；移除 package scripts。
  - 更新 `CLAUDE.md` 后运行 `npm run sync:agents`。
- [x] **Step 3: 运行完整验证**
  - Run: `npm test`
  - Run: `npm run typecheck`
  - Run: `npm run lint`
  - Run: `npm run check:agents`
  - Run: `npm run build`
  - Expected: 全部命令退出码为 0；lint 允许既存 warning，但不得新增 error。

## 最终验证案例

- [x] API 已配置、后端返回 4 条：首次骨架后稳定显示 4 条，不出现 22 条演示数据。
- [x] API 已配置、后端返回空数组：显示数量 0 和“还没有对话”。
- [x] API 已配置、请求失败：显示“对话加载失败”和“重新加载”。
- [x] API 未配置：显示“未连接后端”，创作、上传和保存不可用。
- [x] 四个资源库不会在加载前、空结果或错误后显示 mock 卡片。
- [x] 生产依赖图没有 mock fixture import；fixture 只服务测试。
