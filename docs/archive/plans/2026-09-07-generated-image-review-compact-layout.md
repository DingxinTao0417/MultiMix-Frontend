# 生成关键帧紧凑全宽展示实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-07

## 目标

让当前关键帧画布铺满右侧展示区，并将审核结论压缩为紧凑信息条，减少纵向留白和卡片高度。

## 涉及文件

- `app/assets/components/generated-image-gallery.tsx`：将审核头、当前帧和人工提醒压缩成紧凑的内容结构；保留差异证据和批量应用。
- `app/globals.css`：使用全宽横向画布、中心裁切和紧凑审核条，去除多余间距与大块内边距。
- `app/assets/__tests__/generated-image-gallery.test.tsx`：覆盖紧凑审核结构仍随受控帧更新，且发现差异时证据仍存在。

## 实施任务

### 1. 锁定紧凑审核信息

- [x] 扩展 gallery 测试：对存在差异的当前帧，断言审核区包含状态、帧名、人工提醒和差异证据；对无差异帧仍只显示短提示。
- [x] 运行测试，确认当前结构未覆盖紧凑审核语义。

### 2. 重排结构与全宽样式

- [x] 将审核区标题、状态和当前帧名放入同一紧凑头部；人工复核提醒缩为一行文案。
- [x] 保留差异列表最多三项及无差异提示；保留“打开原图”和批量应用按钮。
- [x] 将生成图片画布设为 `width: 100%`、较宽展示比例和 `object-fit: cover` 中心裁切；移除当前 3:4 比例与 `max-height` 对宽度的间接限制。
- [x] 收紧生成审核卡、标题和审核区的间距与内边距，使审核区不再形成高留白大卡片。
- [x] 运行 gallery 测试，确认通过。

### 3. 联合验证

- [x] 运行 `npx vitest run app/assets/__tests__/generated-image-gallery.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx`。
- [x] 运行 `npm run typecheck` 和 `npm run docs:check`。
- [x] 刷新 `http://localhost:3220/?conversation=local-inline-keyframes-20260907`，确认大图铺满右侧可用宽度、审核紧凑、对话内 F02 能同步更新右侧，批量应用可见且未被点击。

## 风险与取舍

- 全宽较宽画布会裁切图片上下边缘；“打开原图”保留为完整图像检查入口。
- 不改变图片选择、审核证据、候选映射或分镜写入逻辑。
