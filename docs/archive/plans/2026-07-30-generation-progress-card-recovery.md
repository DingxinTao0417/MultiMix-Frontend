# 生成任务进度卡载入恢复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-30

## 背景与根因

浏览器重新打开工作台的失败任务会话时，`AssetGenerationJobCard` 渲染进度列表发生空值异常，页面持续停在“正在载入”。浏览器控制台证据指向 `app/assets/lib/asset-generation-progress.ts` 的 `generationProgressEvents`，随后 Next 开发热更新报告页面脚本语法无效。

任务进度来自在线数据库中的历史 job、实时 job 与会话消息投影；历史记录可能缺少 `progress_events` 或含有不完整事件。因此进度卡必须在边界处把非数组、缺关键字段的值归一化，不能让单条历史任务阻断整个会话。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/assets/lib/asset-generation-progress.ts`
  - `generationProgressEvents`：进度事件的 UI 边界归一化与兜底事件。
- `MultiMix-Frontend/app/assets/components/asset-generation-job-card.tsx`
  - 生成任务卡消费已归一化事件，保持停止和重试入口可用。
- `MultiMix-Frontend/app/assets/__tests__/asset-generation-job-ui.test.tsx`
  - 缺失、`null` 与无效历史 `progress_events` 的渲染回归。

## 具体改法

1. 在 `generationProgressEvents` 仅接受数组形式的 `progress_events`；过滤掉非对象、缺少 `key`/`label`/`status`/`occurred_at` 的记录，并为缺失的 `detail` 提供空字符串。
2. 若归一化后没有可展示事件，生成一个基于 job 状态的兜底事件，确保进度卡总能渲染。
3. 先增加卡片测试，覆盖历史失败任务 `progress_events` 缺失、`null`、非数组和无效事件时仍显示失败信息与“重试生成”。
4. 重启仅由本次任务启动的前端开发进程以清除失效热更新 bundle；不改变 API、在线数据库记录或任务状态。
5. 通过浏览器打开当前失败会话，确认页面完成加载并可点击“重试生成”。

## 风险与取舍

- 过滤无效进度事件会隐藏损坏的历史细节，但保留状态型兜底事件与重试入口，比整个会话不可用更安全。
- 不在前端猜测失败原因或修改任务状态；错误文案仍由既有 `failureMessage` 显示。
- 前端重启前需确认 3200 的进程确为本次/本地 MultiMix 进程，不能替换开发者的其他实例。

## 验证方式

- 先写 UI 失败复现测试，再实现最小归一化。
- 运行 `npm --prefix MultiMix-Frontend run test -- asset-generation-job-ui`（或项目等效 Vitest 命令）、类型/静态检查和 `docs:check`。
- 浏览器 E2E 只使用现有的 3200 本地工作台与已授权的线上测试会话；验证失败任务卡可见且“重试生成”按钮可操作。
