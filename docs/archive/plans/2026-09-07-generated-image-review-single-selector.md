# 生成关键帧单一选择入口实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-07

## 目标

移除右侧展示区的重复关键帧缩略图，仅通过对话内关键帧组切换当前帧，同时保留右侧大图、审核结果和批量应用操作。

## 涉及文件

- `app/assets/components/generated-image-gallery.tsx`：不再渲染右侧缩略图选择列表。
- `app/globals.css`：删除右侧缩略图的布局规则和无效的横向滚动样式。
- `app/assets/__tests__/generated-image-gallery.test.tsx`：验证右侧不再有缩略图选择器，受控帧选择仍驱动大图和审核结果。

## 实施任务

### 1. 锁定唯一选择入口

- [x] 扩展 gallery 测试：渲染两帧后，断言右侧没有 `查看 F01` / `查看 F02` 的选择按钮，但传入 `selectedFrameId="F02"` 时仍显示 F02 大图和对应审核结果。
- [x] 运行测试，确认现有重复缩略图实现会失败。

### 2. 删除重复展示

- [x] 从 `GeneratedImageGallery` 移除 `.shadcn-prototype-generated-image-thumbnails` 及其帧按钮。
- [x] 保留受控 `selectedFrameId`、`onSelectedFrameChange`、大图、审核区和应用操作，确保对话内选择仍能驱动右侧。
- [x] 从 `app/globals.css` 移除仅供右侧缩略图使用的横向滚动与尺寸规则，不影响对话内 `.shadcn-prototype-inline-image-keyframe-list`。
- [x] 运行 gallery 测试，确认用例通过。

### 3. 联合验证

- [x] 运行 `npx vitest run app/assets/__tests__/generated-image-gallery.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx`。
- [x] 运行 `npm run typecheck` 和 `npm run docs:check`。
- [x] 刷新 `http://localhost:3220/?conversation=local-inline-keyframes-20260907`，从对话区点击 F02，确认右侧同步显示 F02 大图与审核结果、没有右侧缩略图，且批量应用按钮仍可见；未点击批量应用按钮。

## 风险与取舍

- 右侧失去本地重复切换入口，但对话内缩略图已完整表达三帧状态，能够减少重复信息和误以为两处状态可独立选择的风险。
- 不改动关键帧数据、审核结果、选帧状态或分镜写入请求。
