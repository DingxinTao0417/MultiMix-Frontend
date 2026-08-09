# 视频生成分步状态图标实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-12

**Goal:** 提升视频生成进度明细中成功对勾和失败叉号的线条与颜色辨识度。

**Architecture:** 保留现有 `RunStatusIcon` 状态映射和 18px 对齐网格，只调整成功/失败 SVG 描边参数及其圆形容器的视觉 token。使用现有样式契约测试锁定图标尺寸、描边、前景色、背景色、边框和不透明度。

**Tech Stack:** React、Lucide React、CSS、Vitest。

## Global Constraints

- 只修改成功与失败步骤图标，不修改标题状态点、运行态、等待态、文字、间距或数据逻辑。
- 成功使用绿色，失败使用红色。
- 不启动服务或数据库，不启用 Subagent。

### Task 1: 锁定成功与失败图标视觉契约

**Files:**

- Modify: `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`
- Modify: `MultiMix-Frontend/app/assets/components/agent-run-timeline.tsx`
- Modify: `MultiMix-Frontend/app/globals.css`

- [x] 增加失败测试：成功与失败 SVG 均为 12px、3px 描边。
  - 验证案例：测试直接检查 `Check` 与 `X` 的 `size={12}` 和 `strokeWidth={3}`。
- [x] 增加失败测试：成功图标使用绿色前景、浅绿色背景和绿色边框，且不缩小、不降低透明度。
  - 验证案例：成功容器命中 `color/background/border` token，步骤覆盖规则为 `transform: none; opacity: 1`。
- [x] 增加失败测试：失败图标使用红色前景、浅红色背景和红色边框。
  - 验证案例：失败容器命中 `color/background/border` token。
- [x] 实现最小样式与图标参数调整，并确认专项测试通过。

### Task 2: 全量验证与归档

- [x] 运行 `npm run typecheck`。
- [x] 运行 `npm run lint`。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run test:product-stage-style`。
- [x] 运行 `npm run check:agents`。
- [x] 运行 `npm run build`。
- [x] 运行 `git diff --check` 并复核变更范围。
- [x] 全部完成后将本计划移入 `docs/archive/plans/`。
