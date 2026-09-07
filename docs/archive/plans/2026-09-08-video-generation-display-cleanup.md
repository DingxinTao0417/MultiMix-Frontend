# 视频生成态重复状态与旧草稿卡片收敛

> Status: archived
> Owner: frontend
> Last verified: 2026-09-08

## 背景与根因

视频工程生成期间，右侧展示区已经在标题旁和中央等待区表达“生成中”，但页头操作区仍额外渲染任务阶段胶囊，形成第三处重复状态；同时，生成前编导稿留下的 `product.timeline` 会被底部通用时间轴条件继续渲染，因此出现与当前视频生成任务无关的“编导 / 草稿”卡片。

根因均在 `ProductWorkspace` 的展示条件：

1. `app/assets/components/product-workspace.tsx:1502` 在 `orchestrationPending` 时始终把 `liveStageLabel` 放进右上角操作区，没有考虑标题旁和中央等待区已经提供生成反馈。
2. `app/assets/components/product-workspace.tsx:1867` 只以“没有可浏览的视频工程且存在 timeline”判断底部时间轴，没有排除 `orchestrationPending`，导致上一阶段的编导稿时间轴泄漏进视频生成态。

## 涉及文件与关键位置

- `app/assets/components/product-workspace.tsx:386-388, 1220-1244, 1502-1506, 1734-1745, 1867-1883`：生成态状态与底部时间轴展示条件。
- `app/assets/__tests__/display-area-cases.test.tsx:333-338`：视频工程生成态的展示区回归测试。
- `e2e/display-area.spec.ts:132-139`：刷新后仍处于生成态的浏览器验收。

## 具体改法

1. 先扩展生成态组件测试：保留标题旁“生成中”和中央“视频生成中”，同时要求右上角阶段胶囊不存在、底部旧时间轴不存在；先运行并确认测试因当前行为而失败。
2. 删除右上角 `liveStageLabel` 胶囊及其无用计算/导入；在底部旧时间轴条件中排除 `orchestrationPending`。保留对话区真实执行时间线、标题旁轻量状态和中央等待说明。
3. 更新生成态 E2E 断言，并运行针对性测试、受保护视频预览契约检查、展示区覆盖检查和类型检查。

## 风险与取舍

- 生成过程中不再在右上角显示细分阶段，但对话区仍是详细进度的权威位置，右侧仍保留标题旁与中央等待反馈，用户不会失去任务状态。
- 只在视频工程生成中隐藏旧时间轴；独立编导稿产物和生成完成后需要的分镜/音轨展示不受影响。
- 不修改播放器外壳、比例、控制条、阴影或浏览态布局，避免触碰已确认的播放器视觉契约。

## 验证方式

- TDD：针对 `display-area-cases.test.tsx` 运行生成态用例，记录实现前预期失败、实现后通过。
- 浏览器契约：更新并运行 `e2e/display-area.spec.ts` 的 `CASE-04`，确认刷新前后右上角无重复胶囊、底部无旧时间轴。
- 受保护链路：运行 `npm run check:video-preview-contract`、`npm run test:product-stage-style`、`npm run test:display-coverage`。
- 运行前端类型检查，并执行 `npm run docs:check`。

## 并发依赖

- `creative-direction-overlap-fix` 当前占用 `app/assets/components/product-workspace.tsx`。本任务在该占用释放前只完成调查与计划，不写入冲突代码；释放后重新登记开发占用再进入 TDD。

## 任务清单

- [x] 任务 1：补充生成态失败回归测试并确认红灯（2 个用例分别捕获右上角阶段胶囊和底部旧时间轴）。
- [x] 任务 2：完成重复状态与旧时间轴的最小实现收敛（针对性 2 个回归用例已转绿）。
- [x] 任务 3：运行针对性、受保护链路、类型和文档检查。

## 验证结果

- 组件回归：`test:display-components` 通过，33 / 33。
- 浏览器覆盖：`test:display-coverage` 通过，14 passed / 1 skipped；`CASE-04` 已覆盖刷新前后无右上角重复阶段胶囊、无底部旧时间轴。
- 视频预览契约与产物区样式契约均通过；TypeScript 类型检查、目标文件 ESLint、`git diff --check` 均通过。
- 一次性测试库与产物目录已清理，专用端口无监听进程。
- `docs:check` 仍被两份与本任务无关、已完成但未归档的后端实验计划阻断；本计划本身未被检查器报错，完成后归档到前端 `docs/archive/plans/`。
