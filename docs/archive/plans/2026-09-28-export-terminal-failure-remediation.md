# 导出失败入口统一整改

> Status: archived
> Owner: frontend
> Last verified: 2026-09-28

## 背景与根因

`product-workspace.tsx:1118-1139` 等待已有品牌任务后仅处理 completed，失败则继续落入重试或新合成。`EditorView.tsx:469-473` 首次质量失败直接透传后端英文摘要，而工作台恢复和重试已经中文化，入口表达不一致。

## 涉及文件与改法

- `app/assets/components/product-workspace.tsx`：等待品牌任务失败后保存质量报告、错误与重试资格并返回；由下一次用户操作决定重试，不能同一点击继续合成。使用统一失败摘要函数。
- `app/assets/lib/video-quality.ts`：集中质量 blocker 的中文摘要；无 blocker 的非质量错误保持原错误，不用通用摘要掩盖其他故障。
- `app/editor/EditorView.tsx`：首次失败使用同一摘要函数，报告仍通过现有 bridge 发送；复核时发现独立编辑器恢复、重试也透传同一英文错误，纳入同一函数收敛，不改变流程。
- `app/assets/__tests__/product-workspace-video-actions.test.tsx`、`video-quality.test.ts`、`app/editor/__tests__/editor-layout.test.ts`：TDD 覆盖品牌任务等待后失败不会启动新合成/自动重试、质量摘要及非质量错误兼容、编辑器消费统一函数。
- `docs/API.md`：补充品牌任务终态和摘要统一规则。

## 风险与取舍

只收敛终态，不改 API、后端发布规则或重试资格。可重试品牌失败保留任务，下次用户点击才重试；不可重试失败展示报告，下次用户明确导出才可新合成。不启动真实数据库或付费能力。

## 任务与验证

1. 补失败复现测试并确认失败。
2. 最小实现终态收口和共享中文摘要，同步文档。
3. 定向 Vitest、TypeScript、目标 ESLint、docs:check、diff 检查；归档计划并释放占用。真实浏览器和生产验证不在本轮范围，不提交或推送。

## 完成与验证

- 先补失败测试：品牌任务等待后失败落入新合成或自动重试，首次失败未使用共享摘要。修复后不可重试和可重试失败均停在失败态；测试证明可重试失败只有第二次用户点击才调用原任务重试。
- 共享函数对质量 blocker 输出中文摘要，对非质量错误保留原文；工作台恢复/重试及编辑器首次、独立恢复/重试入口统一消费。编辑器入口由源码契约检查、摘要行为由单元测试验证，不等同真实浏览器验收。
- 五个定向测试文件 84 项通过；TypeScript、目标 ESLint、docs:check、git diff --check 通过。React 复核没有新增 Hook、布局或可访问性变更。
- 没有修改后端或数据，未跑真实浏览器 E2E/生产验证，未提交推送。
