# 创意方向与编导稿文字重叠修复

> Status: archived
> Owner: frontend
> Last verified: 2026-09-08

## 背景与根因

通用讲解型编导稿在展示 `creative_direction` 时，创意方向卡片与下方 Markdown 正文发生文字重叠。

根因有两层：

1. `app/assets/components/product-workspace.tsx` 在产物页头与主内容之间新增了 `CreativeDirectionSelector`，但 `app/globals.css` 中 `.shadcn-prototype-product` 仍只有 `auto minmax(0, 1fr) auto` 三行。创意方向占用了可伸缩主内容行，下方 `.shadcn-prototype-product-main` 落入自动隐式行；长 Markdown 撑开隐式行后，方向区轨道收缩，方向内容溢出并与正文叠压。
2. `app/assets/components/creative-direction-selector.tsx` 使用 Tailwind 原子类，但当前 `app/globals.css` 没有导入 Tailwind 样式层。方向卡片因此退回浏览器默认样式，边距、布局、字号和按钮样式均未生效。

## 涉及文件与关键位置

- `app/assets/components/creative-direction-selector.tsx`：方向区 DOM 类名与状态样式。
- `app/assets/components/product-workspace.tsx:1543`：方向区插入产物布局的位置。
- `app/globals.css:2268`：产物容器网格行定义。
- `app/assets/__tests__/creative-direction-selector.test.tsx`：方向区渲染与布局回归契约。
- `e2e/creative-direction-selection.spec.ts`：长 Markdown 下默认态与展开态的浏览器边界回归。

## 具体改法

1. 先补失败回归测试，要求方向区使用独立语义类，并要求带方向区的产物容器进入明确的四行布局；测试应在实现前因类名和 CSS 契约缺失而失败。
2. 将 `CreativeDirectionSelector` 的 Tailwind 原子类替换为项目命名空间内的语义类，补齐卡片、标题、候选项、状态胶囊、按钮和说明文案样式。
3. 给存在创意方向的产物容器增加显式状态类，并将网格行设为 `auto auto minmax(0, 1fr) auto`，确保方向区自然占高，Markdown 主内容只使用剩余空间并在自身滚动。

## 风险与取舍

- 不全局启用 Tailwind，避免 Preflight 和大量现存原子类突然生效、引发全站视觉回归。
- 仅在存在创意方向时增加第四行，不改变其他文案、图片、音频和视频产物的既有三行布局。
- 方向候选展开后会占用更多纵向空间；主正文区域相应缩小并保持可滚动，优先保证内容不重叠且全部可达。

## 验证方式

- TDD：运行 `creative-direction-selector.test.tsx`，记录实现前预期失败与实现后通过。
- 运行 `product-stage-style-contract.test.ts` 和 `npm run test:product-stage-style`，确认产物区布局契约未回退。
- 运行前端类型检查。
- 使用已有的接口拦截型浏览器 E2E，在不读写数据库的固定长 Markdown 场景中检查方向区与正文边界框不相交，并确认默认态与展开态均无重叠；如需启动独立前端，使用隔离端口并在结束后清理进程。

## 任务清单

- [x] 任务 1：补充并验证会失败的布局/样式回归测试。
- [x] 任务 2：完成语义样式与四行布局的最小实现。
- [x] 任务 3：运行针对性测试、类型检查和浏览器视觉验证。

## 验证记录

- `npm run test -- app/assets/__tests__/creative-direction-selector.test.tsx app/assets/__tests__/product-stage-style-contract.test.ts`：16 / 16 通过。
- `npm run test:product-stage-style`：通过。
- `npm run typecheck`：通过。
- 目标 TS / TSX 文件 ESLint：通过。
- `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3220 npx playwright test e2e/creative-direction-selection.spec.ts --workers=1`：1 / 1 通过；长 Markdown 默认态与展开态的方向区、正文边界框不相交。
- `npm run docs:check`：本次计划未报错；检查仍被两份既有后端实验计划阻塞，它们已完成但仍位于 `MultiMix-Backend/docs/plans/active/`，不在本次修改范围内。
