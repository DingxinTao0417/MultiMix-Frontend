# 导出质量报告阶段隔离整改

> Status: archived
> Owner: frontend
> Last verified: 2026-09-28

## 背景与根因

工作台 `product-workspace.tsx:1870` 对所有质量报告提供重新检查，实际调用 `:1008-1020` 的工程预检并覆盖现有报告。`export_file` 检查的是已编码文件，不能用工程预检通过来清除文件失败。失败恢复及重试分支 `:962-969,1173-1180` 还会直接展示后端英文摘要。

## 改法与涉及文件

- `app/assets/components/product-workspace.tsx`：只给 `export_preflight` 报告提供重新检查；文件报告保留到新导出结果。带 blocker 的失败任务使用中文摘要，具体原因继续从原报告展示；没有质量 blocker 的其他故障保留原错误。
- `app/assets/components/video-quality-panel.tsx`：按报告阶段限制重新检查入口，文件级报告提示需重新导出验证，避免误认为当前文件已重新检查。
- `app/assets/__tests__/video-quality-panel.test.tsx`、`product-workspace-video-actions.test.tsx`：TDD 覆盖文件报告不可预检覆盖、预检仍可检查、失败摘要中文与具体原因保留。
- `docs/API.md`：沉淀阶段隔离和报告更新规则。

## 风险与取舍

不新增文件验证 API、不改变任务重试或后端质量门。重新导出仍通过原导出菜单执行，不添加重复按钮。文件报告保持失败证据，不把旧报告解释成新任务的验证结果。

## 任务与验证

1. 补复现测试并确认失败。
2. 最小修复阶段入口与文案，同步文档。
3. 定向 Vitest、类型检查、目标 ESLint、文档和差异检查；归档计划并释放占用。此次不启动数据库或真实浏览器环境，不提交推送。

## 完成记录

- 修复前两个阶段隔离用例失败；修复后定向 51 项测试通过，预检仍可检查，文件失败没有错误的预检入口且具体报告保留。
- 恢复和服务端重试的质量 blocker 使用中文摘要；其他非质量故障仍保留原错误，不改任务状态或后端验证。
- TypeScript、目标 ESLint、docs:check、git diff --check 通过。React 复核未发现新增 Hook 或可访问性问题，说明文字复用现有面板排版。
- 未运行真实浏览器 E2E 或生产验证，未操作数据库，未提交推送。
