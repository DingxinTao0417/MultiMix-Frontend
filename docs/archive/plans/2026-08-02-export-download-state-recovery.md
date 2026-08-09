# 已导出成片下载状态恢复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-02

## 背景与根因

公共素材 PDF 工程 `914` 的 MP4 已完成验片并持久化到 `metadata.video_project.mp4_ref`，浏览态预览也能读取该地址。但 `ProductWorkspace` 只把同一浏览器会话内从编辑器回传的 `Blob` 视为“导出完成”；切换或刷新产品时，`useEffect` 无条件把 `exportState` 重置为 `idle`。因此刷新后按钮错误地显示“导出视频”，再次点击会重新进入编辑器导出流程，而不是下载已验证成片。

## 涉及文件与改法

- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`
  - 从已持久化的 `video_project.mp4_ref` / 兼容 MP4 artifact 派生“已有可下载成片”状态。
  - 产品切换或刷新时若该引用存在，初始化为 `done`；按钮显示“下载成片”。
  - 下载时优先复用会话内已验证 Blob；若 Blob 不存在则读取同一后端媒体代理 URL 为 Blob 后再触发浏览器原生下载，不重新验片、不重新导出、不启动编辑器。
- `MultiMix-Frontend/app/assets/__tests__/product-workspace-video-actions.test.tsx`
  - 先覆盖“已持久化 MP4 在首屏即显示下载成片”和“点击走媒体代理下载而非质量检查/编辑器”的回归场景。

## 风险与取舍

- 仅以真实 MP4 引用恢复下载，不把 ready 工程或预览占位误判为已导出。
- 跨端口媒体地址若直接赋给下载链接，浏览器可能导航而非下载；因此恢复下载时会先读取为 Blob。短暂下载失败只显示“下载失败，重试”，并始终重试下载，不会回退到导出。
- 未持久化 MP4 的工程保持原有“导出视频”路径与质量检查，防止绕过验片。

## 验证方式

1. 新增前端单测，断言持久化 MP4 不触发 `getVideoQuality` 或编辑器导出。
2. 运行该测试及关联展示测试、类型/lint 中与改动相关的检查。
3. 在当前线上公共素材工程 `914` 刷新后，用浏览器确认按钮为“下载成片”，预览 URL 与下载 URL 都指向同一媒体代理；不创建新工程、不重渲染视频。

## 实施记录（2026-08-02）

- 新增回归用例后先复现：已有 `mp4_ref` 的工程首屏错误显示“导出视频”。
- `ProductWorkspace` 现在仅在 `video_project.mp4_ref` 或兼容 MP4 artifact 引用存在时恢复 `done` 状态；无 MP4 工程的导出与验片路径未改。
- 恢复下载会先从现有媒体代理读取 Blob，再触发浏览器下载；浏览器实际验证显示页面 URL 保持在工作台，按钮切换为“再次下载”，且没有“导出视频”按钮或新视频工程。
- 验证：`product-workspace-video-actions.test.tsx` 8/8、关联展示用例合计 35/35 通过；ESLint 无错误（2 条既有、无关警告）。
