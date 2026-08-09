# 对话加载动效恢复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-02

## 背景与根因

历史对话详情尚未返回时，权威 UI 规范要求对话区显示延迟 500ms 的“载入对话…”中性骨架。`ConversationStudio` 仍以 `detailsLoaded === false` 作为该动效的触发条件。

`MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx:605-622` 在快照恢复阶段为了提前展示右侧已保存视频工程，构造了一个临时对话对象并把 `detailsLoaded` 强制改为 `true`。这使对话区误判详情已经完成，骨架被一条“正在恢复完整对话记录”助手消息替代。现有 `conversation-detail-loading.test.tsx` 直接渲染 `ConversationStudio`，没有覆盖上层状态转换，因此未发现该回归。

## 涉及文件与改法

- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`
  - 保留快照中已恢复的产品数据，供右侧预览提前展示。
  - 不再把传给对话区的快照伪装成 `detailsLoaded: true`，让对话区继续遵守真实详情状态。
  - 快照期间继续保持编辑、保存、恢复版本和任务重试只读，直至完整详情返回。
- `MultiMix-Frontend/app/assets/__tests__/workspace-new-conversation-routing.test.tsx`
  - 先增加回归断言，证明快照展示模型不得覆盖 `detailsLoaded` 或注入伪助手消息。
  - 当前实现上测试必须先失败，最小修复后再转绿。

## 风险与取舍

- 快照阶段左侧只显示加载骨架，右侧仍可提前显示已经恢复的产品；这是“真实加载状态”和“快速产物恢复”的职责分离。
- 不修改后端接口、详情请求、快照请求或对话编排状态。
- 不改动加载动效的样式、500ms 延迟、失败重试呈现，也不触碰当前被其他任务占用的 `conversation-studio.tsx`。

## 验证方式

- TDD 红灯：单独运行新增的 workspace 回归测试，确认当前实现因强制 `detailsLoaded: true` 而失败。
- TDD 绿灯：实施最小修复后重复运行该测试。
- 运行 `conversation-detail-loading.test.tsx` 与 `conversation-waiting-state.test.tsx`，确认骨架、延迟和失败态未回归。
- 运行前端类型检查及本次涉及文件的 ESLint。
- 运行 `npm --prefix MultiMix-Frontend run docs:check`。

## 执行结果

- 红灯 1：快照详情被伪装为已加载，新增回归测试在旧实现上按预期失败。
- 绿灯 1：移除临时 `detailsLoaded: true` 和伪助手恢复消息后，骨架触发条件恢复。
- 红灯 2：状态恢复后发现右侧快照产品会被隐藏，补充独立回归测试并在未修复实现上按预期失败。
- 绿灯 2：产品选择允许读取快照产品，但快照期间仍保持只读；左侧加载状态与右侧快速恢复解耦。
- 未修改 `conversation-studio.tsx`、动效样式、后端接口或详情请求流程。
