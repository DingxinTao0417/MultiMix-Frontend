# 导出失败停止与版本检查结果隔离整改

> Status: completed
> Owner: frontend
> Last verified: 2026-09-28

## 背景与根因

用户确认修复本轮只读审查的两项问题。独立编辑器等待品牌任务时只处理成功，失败终态继续进入自动重试或新一轮渲染。工作台按版本缓存文件，但共用一份质量报告，已完成品牌任务下载没有替换报告，因此旧原始版失败会污染当前成功结果。

## 范围与关键位置

- `app/editor/EditorView.tsx:561–690`：品牌任务恢复、失败和显式重试。
- `app/assets/components/product-workspace.tsx:220、930–980、1086–1240`：质量报告状态、任务恢复、缓存和完成下载。
- `app/editor/__tests__/standalone-export.test.tsx`：新增真实组件交互回归（隔离编辑器引擎与接口）。
- `app/editor/__tests__/editor-layout.test.ts`：既有错误文案契约。
- `app/assets/__tests__/product-workspace-video-actions.test.tsx`：成功恢复与版本切换交互。

不改后端、vendor、播放器视觉、生产配置、数据及其他未提交改动。

## 具体改法

1. 独立编辑器收到失败终态立即保存可重试任务或清除不可重试任务，显示共享本地化失败文案并返回。下一次用户点击才允许重试，复用同一任务。
2. 工作台质量报告按 `ExportVariant` 隔离，界面从当前版本派生报告；成功任务用其报告（缺失即清空）替换当前版本的旧报告，缓存下载恢复完成状态并清除旧错误。原始版后台恢复显式归属原始版，不覆盖品牌版。
3. 先补失败复现测试，再最小实现；完成后运行相关回归、类型、lint、离线快速测试、构建和文档检查，记录证据并归档。

## 风险与取舍

- 保留其他版本真实失败报告，不通过一刀切清空来掩盖问题。
- 不新建重试协议，不改变服务端质量门。只修复消费终态和界面归属。
- 组件交互测试模拟服务端终态，不代表真实编码、上传或生产全链路通过；本轮选择 L2 相关回归，外部付费调用为零。

## 验证案例

- 独立编辑器品牌任务等待后失败，分别覆盖 retryable true/false；同次点击无 retry、无新渲染。可重试场景第二次点击复用失败 job 并成功下载。
- 原始版失败后品牌版直接 completed 或等待后 completed，报告为 pass、warning 或 null，不显示旧原始版 blocker。
- 品牌版缓存下载后仍显示其自身报告和成功状态，不残留另一版错误。
- 工程切换清空版本缓存；既有恢复失败、重试失败和质量检查阶段测试继续通过。

## 任务与进度

- [x] 1. 补充复现测试并完成独立编辑器失败停止修复。两类失败在改前分别复现新渲染和自动重试；修复后组件交互与错误文案契约共 12 项通过。
- [x] 2. 完成工作台质量报告版本隔离与成功/缓存下载修复。直接成功、等待后成功、缺失报告、独有告警和缓存下载切换场景通过；相关 6 文件 89 项及 typecheck 通过。
- [x] 3. 相关回归与静态检查完成；按以下证据归档与释放占用。

## 验证记录

- L2，外部接口与编辑器引擎由测试隔离，外部付费调用为零，未连接数据库或启动 UI/E2E 进程。
- 改前失败证据：独立编辑器两个案例分别进入新渲染与同次点击自动 retry；工作台三个案例下载成功后仍存在原始版旧 blocker。均在最小实现后通过。
- `npx vitest run app/assets/__tests__/video-quality.test.ts app/assets/__tests__/video-quality-panel.test.tsx app/assets/__tests__/product-workspace-video-actions.test.tsx app/editor/__tests__/editor-layout.test.ts app/editor/__tests__/video-export-client.test.ts app/editor/__tests__/standalone-export.test.tsx --silent --reporter=dot`：6 文件、89 项通过（2.79 秒）。
- `npm run typecheck`、`npm run lint`、针对变更文件的 ESLint、`npm run build`、`npm run check:agents`、`git diff --check`：通过。React best-practices 复核：报告从当前版本派生；共享 setter 稳定且 Hook 依赖完整，无新增订阅。
- `npm run test:fast`：全量 Vitest 1143 通过、2 失败（29.93 秒），因该层失败未继续自动运行后两层；单独补跑 `npm run test:demo-units` 为 8 项通过，`npm run test:scripts` 为 236 通过、1 跳过、0 失败。
- 两个全量既有失败：`agent-ui-copy.test.ts:1350` 仍要求旧空态文案（当前 HEAD 已不存在该文案，本轮不改空态）；`asset-generation-job-ui.test.tsx:49` 要求失败重试后无步骤列表（测试及其组件本轮均未改动）。不通过改测试期望来掩盖失败，后续单独核对现行设计。
- 日志保存在 `/tmp/multimix-export-variant-*-20260928*.log`，仅为本地检查日志，不提交。
- 结论仅覆盖导出终态与版本报告的组件/API 模拟边界。未做真实浏览器、编码上传或生产验收，未提交/推送，保留原有无关脏文件。
