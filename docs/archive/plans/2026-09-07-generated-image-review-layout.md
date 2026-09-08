# 生成关键帧展示与审核布局实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-07

## 目标

将连续关键帧展示调整为单列“看图 → 审核 → 操作”，消除右侧审核栏与状态重复，同时保持多帧切换和分镜应用行为。

## 涉及文件

- `app/assets/components/generated-image-gallery.tsx`：调整语义结构，让审核结果成为大图下的内容区，缩略图只用于切换。
- `app/globals.css`：把生成图片审核卡从双列改为单列；定义审核区、横向缩略图和窄屏样式。
- `app/assets/__tests__/generated-image-gallery.test.tsx`：覆盖切帧时大图与审核结果同步，以及多帧应用入口仍存在。
- `docs/specs/ui/generated-image-review-layout.md`：已确认的产品设计依据。

## 实施任务

### 1. 先锁定展示与切换行为

- [x] 扩展 gallery 测试：给 F01 / F02 放入不同审核差异，点击 F02 后断言大图、审核标题和差异证据都切到 F02。
- [x] 运行该测试，确认旧结构下新增断言失败或未覆盖。

### 2. 重组展示语义与样式

- [x] 在 `GeneratedImageGallery` 内把审核结果从独立右侧 `aside` 移入大图、标题之后的单列审核区。
- [x] 将审核状态徽章、人工复核提示、差异列表和“未发现关键差异”提示保留为当前选中帧的内容。
- [x] 保留缩略图选择、单图应用、三图批量应用、应用中与已应用状态；缩略图只展示帧号和简短状态。
- [x] 将 `.shadcn-prototype-generated-image-review` 改成单列卡片，并将缩略图改为横向可滚动的等宽列表；移除右侧审核栏专属的边框和响应式分栏规则。
- [x] 运行 gallery 测试，确认所有既有与新增用例通过。

### 3. 验证产品行为与本地页面

- [x] 运行 `npx vitest run app/assets/__tests__/generated-image-gallery.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx`，确认切换、审核与应用保护不回归。
- [x] 运行 `npm run typecheck` 和 `npm run docs:check`。
- [x] 刷新 `http://localhost:3220/?conversation=local-inline-keyframes-20260907`，确认当前大图在上、审核区在下、三帧缩略图可切换、批量应用按钮可见；未点击该按钮，避免写入验收数据。

## 风险与取舍

- 单列会增加纵向高度，但检查流程更连贯，且避免当前双列中审核信息与大图的注意力分散。
- 不改变后端数据、审核判断或图片应用请求，只调整现有前端的呈现顺序。
- 仅显示最多三项审核证据和既有人工提示，避免审核内容挤压当前大图。
