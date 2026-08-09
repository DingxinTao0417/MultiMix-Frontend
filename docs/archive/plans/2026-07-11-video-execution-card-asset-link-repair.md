# 视频执行卡产物关联修复计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-11

**Goal:** 视频工程生成完成后，执行过程仍保留在对话中并自动收起，顺序稳定为“已确认方案 → 执行记录 → 视频工程产物卡”。

**Architecture:** 保留现有 `AgentRunTimeline` 和真实 job 轮询。仅修复持久化执行锚点的资产关联：消息顶层 `asset_id` 缺失时，从确认事务写入的 `metadata.product_id` 恢复视频工程 ID，使执行锚点能够消费同一工程的实时步骤；不伪造执行步骤，不改变后端状态机。

**Tech Stack:** Next.js、React、TypeScript、Vitest。

## Global Constraints

- 不新增第二套执行卡或视频任务。
- 执行进度只来自真实后端 job；缺少真实步骤时不得模拟进度。
- 视频工程 ready 后立即开放编辑器；MG overlay 可继续执行。
- 全部执行结束后自动收起，点击后可重新展开。

### Task 1: 修复执行锚点的资产 ID 恢复

**Files:**

- Modify: `MultiMix-Frontend/lib/asset-mappers.ts`
- Test: `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`

- [x] **Step 1: 写失败复现案例**

  构造 `video_project_queued` 助手消息：顶层 `asset_id=null`，但 metadata 含 `product_id=451`，断言映射后的执行锚点 `assetId===451`。

- [x] **Step 2: 运行定向测试并确认 RED**

  Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts`

  Expected: 新用例因 `assetId` 为 `null` 而失败。

- [x] **Step 3: 实现最小修复**

  仅对持久化消息资产 ID 做安全数值兜底：优先使用顶层 `asset_id`，缺失时使用 metadata 中的正整数 `product_id`；其他消息保持原行为。

- [x] **Step 4: 运行定向测试并确认 GREEN**

  Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts`

  Expected: 全部通过。

### Task 2: 验证执行卡与文档门禁

**Files:**

- Verify: `MultiMix-Frontend/app/assets/__tests__/agent-run-timeline.test.ts`
- Verify: `MultiMix-Frontend/app/assets/__tests__/conversation-execution-presentation.test.ts`

- [x] **Step 1: 验证执行卡收起与消息展示契约**

  Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/agent-run-timeline.test.ts app/assets/__tests__/conversation-execution-presentation.test.ts app/assets/__tests__/asset-mappers.test.ts`

  Expected: 执行锚点可见、完成态自动收起、用户重新展开行为全部通过。

- [x] **Step 2: 运行类型与 agent/docs 检查**

  Run: `npm --prefix MultiMix-Frontend run typecheck`

  Run: `npm --prefix MultiMix-Frontend run check:agents`

  Expected: 均通过，且 `check:agents` 包含 `docs:check`。

## 验证案例

- [x] 顶层 `asset_id` 存在：执行锚点继续关联原视频工程。
- [x] 顶层 `asset_id` 缺失、metadata 有 `product_id`：执行锚点恢复关联并显示执行卡。
- [x] 视频工程完成：执行卡保留在对话中并默认收起，而不是消失。
- [x] 用户点击完成摘要：可重新展开真实步骤历史。
- [x] 视频工程产物卡仍位于执行记录之后，并可打开右侧预览/编辑器。
