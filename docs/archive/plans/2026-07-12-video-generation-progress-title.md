# 视频生成进度标题实施计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-12

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将视频确认后的执行卡标题改为“视频生成进度”，并与上方“视频方案”保持相同字号。

**Architecture:** 保留 `AgentRunTimeline` 的状态、折叠和耗时逻辑，只收口用户可见标题。样式继续由现有标题类控制，通过组件渲染测试与 CSS 契约测试分别锁定文案和 `17px` 字号。

**Tech Stack:** React 19、TypeScript、CSS、Vitest、Markdown 文档检查。

## Global Constraints

- 用户可见标题固定为“视频生成进度”。
- 不向用户暴露“视频工程”内部概念；生成完成后直接进入编辑与导出体验。
- 标题字号必须与“视频方案”标题一致，当前契约值为 `17px`。
- 不改变真实任务步骤、完成/失败状态、耗时、折叠或重试行为。
- 不覆盖目标文件中已有的未提交改动。

---

### Task 1: 执行卡标题与字号契约

**Files:**
- Modify: `MultiMix-Frontend/app/assets/__tests__/agent-run-timeline.test.ts`
- Modify: `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`
- Modify: `MultiMix-Frontend/app/assets/components/agent-run-timeline.tsx`
- Modify: `MultiMix-Frontend/app/globals.css`
- Modify: `docs/specs/ui/video-confirmation-execution-card.md`

**Interfaces:**
- Consumes: `AgentRunTimeline` 已有 `steps`、`completionConfirmed`、`errorMessage` 与折叠状态。
- Produces: 所有执行状态统一渲染标题文本 `视频生成进度`；`.shadcn-prototype-agent-run-title` 使用 `font-size: 17px`。

- [x] **Step 1: 写入失败的文案与字号测试**

在终态成功、终态失败和运行中渲染断言中要求出现 `视频生成进度` 且不出现 `MultiMix 执行`；将样式契约改为同时断言确认标题与执行标题都是 `17px`。

- [x] **Step 2: 运行定向测试并确认按预期失败**

Run: `npm test -- app/assets/__tests__/agent-run-timeline.test.ts app/assets/__tests__/product-stage-style-contract.test.ts`

Expected: FAIL，原因是组件仍渲染 `MultiMix 执行`，样式测试仍接受旧标题契约。

- [x] **Step 3: 写入最小实现**

将 `AgentRunTimeline` 头部主标题统一为 `视频生成进度`，保留终态色点、步骤数、耗时和展开逻辑；将标题样式保持为 `17px`，与 `.shadcn-prototype-confirm-done-head` 一致。

- [x] **Step 4: 运行定向测试并确认通过**

Run: `npm test -- app/assets/__tests__/agent-run-timeline.test.ts app/assets/__tests__/product-stage-style-contract.test.ts`

Expected: PASS，两个测试文件零失败。

- [x] **Step 5: 运行产品样式与文档检查**

Run: `npm run test:product-stage-style && npm run docs:check`

Expected: 两条命令均退出码 `0`。

- [x] **Step 6: 核对最终差异并归档计划**

只保留标题文案、字号契约和设计规范相关差异；完成后将本计划移入 `docs/archive/plans/` 并把所有步骤标记为完成。
