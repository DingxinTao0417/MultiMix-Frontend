# MultiMix 素材生成任务 Hook 拆分执行计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-30

## 背景与根因

用户已确认将 `assets-workspace-client.tsx` 中“素材生成任务的状态、轮询和重试”拆成独立模块。
本次是行为不变的模块化重构，目标是降低多人或多任务同时修改工作台大组件时的冲突概率。

当前 `assets-workspace-client.tsx` 约 2,281 行，最近 200 次提交中被修改 39 次。素材生成任务的
协调逻辑目前横跨状态、恢复、轮询、重试、提交回写和 UI 接线：

- 104–108 行：`AssetGenerationJobLive` 运行态类型；
- 531–534、598–653 行：任务 state/ref，以及从持久化对话恢复任务；
- 776–860 行：定时轮询、并发去重、旧 run 丢弃、完成后刷新对话；
- 1164–1182 行：失败任务重试；
- 1836–1846 行：新生成任务登记；
- 575、2328 行：选中任务和 UI 接线。

根因不是单个函数过长，而是异步任务生命周期由页面外壳直接持有，导致修改对话、上传、工作台布局
或生成链路时都容易碰到同一文件和同一组 ref。

## 权威依据

- `docs/authority/conversation-orchestration-rules.md`
- `docs/authority/asset-understanding-and-segment-referencing.md`
- `docs/archive/plans/2026-07-30-active-plan-reconciliation-and-hotspot-selection.md`

本次不修改对话路由、确认门、素材理解、素材引用、生成接口或用户可见文案。

## 涉及文件与关键位置

### 新增

- `MultiMix-Frontend/app/assets/lib/use-asset-generation-jobs.ts`
  - 持有任务 map、同步 ref、并发集合和已刷新集合；
  - 从对话 metadata 恢复未完成任务；
  - 执行 200ms 首轮、2.5s 正常轮询、4s 异常重试；
  - 完成时只刷新一次对话；
  - 登记新任务、失败重试并通过 run 隔离旧响应；
  - 卸载或依赖变化时清理 timer。
- `MultiMix-Frontend/app/assets/__tests__/use-asset-generation-jobs.test.tsx`
  - 用真实 hook、假计时器和完整 API 响应验证外部行为。

### 修改

- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`
  - 删除内嵌的素材生成任务生命周期实现；
  - 只传入 token/对话，接收刷新后的对话；
  - 使用 hook 暴露的 `jobsByConversation`、`registerJob` 和 `retryJob` 接回现有 UI。
- `MultiMix-Frontend/app/assets/__tests__/agent-ui-copy.test.ts`
  - 将轮询实现位置断言改到新 hook；
  - 保留工作台必须接入 hook、任务卡和重试动作的结构契约。

现有 `asset-generation-poller.ts` 和对应测试继续保留，纯函数职责不扩张。

## 具体改法

1. 先写 hook 行为测试，并确认因模块尚不存在或 API 尚未实现而按预期失败。
2. 新 hook 接收：
   - `token`；
   - `conversations`；
   - 稳定的 `onConversationRefreshed` 回调；
   - 稳定的 `onConversationRefreshError` 回调。
3. 新 hook 返回：
   - `jobsByConversation`；
   - `registerJob(conversationId, job)`；
   - `retryJob(jobId)`，失败继续抛给页面沿用现有 `formatComposerError`。
4. 轮询继续调用现有 `assetWorkspaceAdapter`，不新增接口层或配置项。
5. 页面用 `useStableCallback` 包装刷新回调，避免页面每次渲染重启轮询 effect。
6. 先让新增测试通过，再删除页面中的旧实现；每次删除后运行相关测试，避免同时改变时序。

## 必须保持不变的行为

- 后端未启用或 token 为空时不轮询。
- queued/running 任务在 200ms 后开始，正常每 2.5 秒继续轮询。
- 临时请求错误不会把任务改为失败，而是在 4 秒后重试。
- 同一 `jobId::run` 同时只允许一个请求。
- 新任务或重试增加 run 后，旧请求结果不得覆盖新状态。
- completed 后刷新对应对话，成功后移除任务；刷新失败保留任务以便后续再试。
- failed 任务留在 UI，用户点击重试后沿用现有错误提示。
- 从对话 metadata 恢复未完成任务的规则保持逐字一致。

## 风险与取舍

- 最大风险是 React effect 闭包和 timer 清理改变轮询时序；用假计时器和受控 Promise 固定。
- 直接 mock 整个工作台会只验证 mock，本次测试真实 hook，只替换网络边界。
- 不在本轮顺手拆 agent action、视频 job、上传或对话加载；否则会扩大改动和冲突面。
- 不改 `asset-generation-poller.ts` 的语义，也不把轮询间隔顺手改成配置项。
- `next-env.d.ts` 是外部已有改动，保持当前 SHA-256
  `F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0`。

## 验证方式

- [x] 新 hook 测试先按预期失败，再通过。
- [x] 覆盖持久化恢复、正常轮询、完成只刷新一次、刷新失败保留和报错、失败任务重试、
  旧 run/旧任务隔离、并发去重和卸载清理。
- [x] `asset-generation-poller.test.ts` 通过。
- [x] `asset-generation-job-ui.test.tsx` 通过。
- [x] `agent-ui-copy.test.ts` 通过。
- [x] `npm --prefix MultiMix-Frontend run test` 通过。
- [x] 定向 ESLint、`npm --prefix MultiMix-Frontend run check:agents` 和 `git diff --check` 通过。
- [x] 后端保持干净，`next-env.d.ts` 哈希保持不变。
- [x] 计划执行记录与实际代码一致，完成后移入 `docs/archive/plans/`。

## 执行结果（2026-07-30）

- 新增 191 行的 `use-asset-generation-jobs.ts`，集中持有素材生成任务生命周期。
- `assets-workspace-client.tsx` 从约 2,281 行降到 2,158 行，净移出 123 行异步协调逻辑。
- 页面现在只负责传入 token/对话、接收刷新结果，以及把任务状态和重试动作传给 UI。
- 新增 11 个真实 hook 行为测试；每项都先观察到对应失败，再写最小实现使其通过。
- 测试额外发现并阻止了一个搬迁时的竞态回归：新任务登记后、React effect 尚未同步 ref 前，
  旧请求可能覆盖新任务。最终恢复了旧实现的同步 ref 保护，并用测试固定。
- 前端全量结果：62 个测试文件、438 项测试全部通过；类型检查和定向 ESLint 通过。
- `check:agents`、视频预览契约、三仓 `git diff --check` 通过；后端未修改。
- `next-env.d.ts` 的 SHA-256 保持为
  `F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0`。
