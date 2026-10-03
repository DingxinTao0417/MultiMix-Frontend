# 导出文件失败态复查入口修复

> Status: archived
> Owner: frontend
> Last verified: 2026-09-28

## 背景与根因

`app/assets/components/product-workspace.tsx:1864-1871` 对所有质量报告提供“重新检查”，但其回调 `requestExportQuality` 只通过 adapter 请求 `stage=export_preflight`（`app/assets/lib/asset-workspace-adapter.ts:1793-1797`）。当当前报告来自已导出的 `export_file` 失败任务时，点击该按钮会用工程预检结果覆盖文件质量报告，造成“文件未重新导出却看似已修好”的假象。导出失败任务携带 blocker 时，`product-workspace.tsx:967,1179` 和 `app/editor/EditorView.tsx:470-474` 还可能直接展示后端英文概述。

## 涉及文件与具体改法

- `app/assets/__tests__/video-quality-panel.test.tsx`、`app/assets/__tests__/product-workspace-video-actions.test.tsx`：先补失败测试，覆盖 `export_file` 不显示“重新检查”、保留文件 blocker、`export_preflight` 仍可重新检查，以及有质量 blocker 的失败摘要为中文。
- `app/assets/components/video-quality-panel.tsx`：只对 `export_preflight` 报告显示现有“重新检查”按钮；`export_file` 报告继续显示具体问题与重新导出的文字建议。
- `app/assets/components/product-workspace.tsx`、`app/editor/EditorView.tsx`：有文件质量 blocker 时使用统一中文失败概述，保留质量面板的具体信息；无报告或无 blocker 时继续保留真实任务错误。
- `docs/API.md:780-788`：明确预检复查与文件重新导出的不同语义。

## 风险与取舍

- 不复用 `export_preflight` 来证明 MP4 文件已经修复；只有新的导出终结任务返回新报告才能更新文件结论。
- 不新增自动重新导出按钮或调用，避免一次“检查”点击意外启动浏览器编码和上传。用户仍使用当前清晰可见的“导出视频”入口。
- 不改后端质量门、任务状态、API 或数据库。

## 任务与验证

1. 新增复现测试，确认修复前失败。
2. 最小修改按钮条件与失败概述，更新接口文档。
3. 跑目标 Vitest、TypeScript、目标文件 ESLint、`docs:check` 与差异检查；复核现有脏工作区并释放开发占用。不启动数据库或付费链路。

## 完成与归档记录

- 文件级失败报告不再提供工程预检“重新检查”；文件失败原因保留到新的导出结果，工程预检仍可重新检查。质量失败使用中文摘要，非质量错误保留真实原因。
- 本计划的实现与验证已由 `MultiMix-Frontend/docs/archive/plans/2026-09-28-export-quality-stage-remediation.md` 和 `MultiMix-Frontend/docs/archive/plans/2026-09-28-export-terminal-failure-remediation.md` 收口。
- 相关代码已随前端提交 `0d9585a` 推送，本轮只补齐文档归档，不修改正式产品、接口或数据。
