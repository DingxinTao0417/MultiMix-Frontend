# Frontend main 合并冲突解决计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-26

## 背景与根因

将本地 `ee0caa4`（安全失败诊断）及此前的生成任务卡稳定性提交合并到最新 `origin/main` 时，`conversation-studio.tsx` 与 `library-workshop.tsx` 出现文本冲突。本地新增多 generation job 的锚定/去重展示；远端新增运行时写入能力门控、公开素材搜索与可访问性交互。直接选任意一侧都会丢失已验证行为。

## 具体改法

1. `conversation-studio.tsx`：保留本地的 `liveGenerationJobs` 及已锚定/已被替代过滤，逐项渲染生成卡；同时将远端的 `writeCapabilities.canGenerate` 应用于重试入口，取消仍可用。
2. `library-workshop.tsx`：保留远端的公开素材、写入能力和焦点管理实现；保留本地在视频工程未完成前不开放剪辑器的边界。删除所有冲突标记，不改变 API 调用参数。
3. `lib/api.ts` 与 `asset-workspace-adapter.ts`：合并远端的公开素材 DTO/调用与本地的 `failure_diagnostic`、`productStatus`，使 UI 依赖的公共接口完整且不回退安全诊断。
4. 不纳入本次冲突解决的远端文件仅作为 merge 父提交内容；不混入用户未请求的重构。

## 风险与验证

- 生成任务卡必须既不重复，也不得在后端不可写时露出重试入口。
- 素材库公开搜索、导入、删除、重新解析必须遵守远端写入门控；未完成视频工程不能打开剪辑器。
- 运行冲突相关前端测试、类型检查、文档检查；完成 merge 后检查无未解决冲突，再按单写入提交规则继续推送。

## 实施与证据（2026-08-26）

- 已将多 generation job 的锚定/去重渲染与 `canGenerate` 重试门控合并；未确认任务不会重复展示。
- 已合并公开素材 DTO/adapter、写入门控、焦点管理与本地 `failure_diagnostic`、`productStatus`；并补回自动合并遗漏的公开素材搜索入口。
- 通过：冲突相关前端测试 `40 passed`、`npm run typecheck`；待执行文档检查、合并提交、推送和生产部署。
