# 导出失败质量反馈恢复修复

> Status: archived
> Owner: frontend
> Last verified: 2026-09-27

## 背景与根因

导出终结任务失败时，后端 `quality_report` 已随任务保存并由前端 adapter 返回，但 `app/assets/components/product-workspace.tsx:962-969,1172-1179` 在失败分支先返回，只在成功分支调用 `setQualityReport`。因此刷新恢复或服务端重试失败后，用户只见笼统错误，失去质量问题和修复建议。`app/assets/components/video-quality-panel.tsx:47-60` 仅在存在页面内修复按钮时显示 `suggested_actions[0]`；`app/assets/lib/video-quality.ts:28-43` 也未给新导出时长错误码专门标题。

## 涉及文件与具体改法

- `app/assets/__tests__/product-workspace-video-actions.test.tsx`：先补失败任务恢复、服务端重试仍失败的 UI 回归，断言质量报告的具体问题可见，缺少报告时不残留旧报告。
- `app/assets/__tests__/video-quality-panel.test.tsx`：先补没有页面内修复入口时仍显示建议，以及新错误码标题的测试。
- `app/assets/components/product-workspace.tsx`：失败终态先同步当前任务的质量报告，再设置错误态并返回；成功路径继续展示其报告。处理空报告，避免把先前检查结果冒充本次失败原因。
- `app/assets/components/video-quality-panel.tsx`、`app/assets/lib/video-quality.ts`：非可直接修复的问题以文字展示服务端建议，并为导出时长错误码提供可读标题；不虚构无效的修复按钮。
- `docs/API.md:780-787`：补明失败任务恢复时质量报告与任务错误须同时展示。

## 风险与取舍

- 不改变后端任务状态、重试资格、MP4 质量门、导出按钮流程或数据契约。
- 未携带质量报告的失败继续只显示任务错误；避免旧质量报告误导用户。
- 建议仅作文字提示，不将“检查视频轨”伪装成可由页面自动完成的操作。

## 任务与验证

1. 新增失败 UI 测试并确认修复前失败。
2. 最小实现失败报告恢复、明确标题和建议展示，同步接口文档。
3. 运行定向 Vitest、类型/静态检查和 `docs:check`，复核当前脏工作区差异并释放占用。若需要真实页面复测，只使用与现有开发进程隔离的环境，不连接真实数据库。

## 实施与验收记录

- 先补失败测试，确认刷新恢复、重试失败无法看到质量报告，新时长错误没有明确标题与建议；修复后相关 50 项 Vitest 测试通过，包含旧报告清理用例。
- 失败终态现展示本次任务报告；没有报告时清除旧报告。非页面内可修复的问题以文字展示后端建议，新时长类错误码有明确标题；不改变导出任务与重试状态。
- `npm run typecheck`、目标文件 ESLint、`npm run docs:check`、`git diff --check` 通过。Vitest 运行中存在既有 React `act(...)` 警告，未导致失败。
- 未运行真实浏览器 E2E、生产验证或数据库操作；本轮不提交或推送。
