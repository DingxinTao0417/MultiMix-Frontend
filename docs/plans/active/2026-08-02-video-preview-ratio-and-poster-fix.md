# 视频预览比例与首帧占位修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-02

## 背景与根因

- “Webb图片科普视频”的已确认参数和真实成片均为横屏，但历史最终产物缺少前端当前读取的 `video_project.ratio`、`mp4_artifact.ratio` 与 `intent.ratio`。前端因此显示“按指令”，播放器落入默认 `198px` 宽度。
- `video_project` 已保留 `orchestration.layout` 以及 `settings.width/height`，但 `MultiMix-Frontend/lib/asset-mappers.ts` 没有使用这些确定性工程字段恢复比例。
- “基于来源生成”的 MP4 第 0 帧实际存在，播放器冷加载时白屏来自 `<video preload="metadata">` 没有 `poster`；真实画面尚未解码前，透明 video 暴露白色画布背景。

## 涉及文件与关键位置

- `MultiMix-Frontend/lib/asset-mappers.ts`：产物比例映射与分镜缩略图映射。
- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：成片浏览态选择首个可用分镜缩略图作为 poster。
- `MultiMix-Frontend/app/assets/components/video-preview-player.tsx`：播放器 poster 契约与加载完成后的显示切换。
- `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`：缺少显式 ratio 时从工程 layout/画布恢复比例。
- `MultiMix-Frontend/app/assets/__tests__/video-preview-player.test.tsx`：冷加载 poster、视频缩略图排除与现有播放器行为。

## 具体改法

1. 先新增失败测试：构造没有显式 ratio、但 `video_project.orchestration.layout=landscape` 或 `settings=1920x1080` 的产物，期望映射为 `16:9`。
2. 在 mapper 中按“显式 ratio → 工程 layout → 工程宽高”的顺序确定比例；只支持当前确认门允许的 `16:9`、`9:16`、`1:1`，不做语义猜测。
3. 先新增失败测试：播放器收到 poster 时必须写入 `<video poster>`，并保持现有白色外壳、比例和控制条。
4. 成片浏览态从第一个具有 `assetThumbnailUrl` 且不是明确视频类型的分镜取得 poster；没有安全图片候选时维持现状。
5. 不修改播放器外壳、圆角、阴影、内边距、控制条和媒体画布比例契约。

## 风险与取舍

- 历史工程可能没有显式 ratio；用工程 layout/宽高恢复属于确定性结构兜底，能够覆盖历史数据而不迁移数据库。
- 分镜缩略图代表首个分镜素材，不一定包含最终字幕或 MG；它只在成片首帧尚未解码时短暂展示，优先避免无信息白屏。
- 明确为视频的分镜缩略图不作为 poster，避免把视频 URL 填入图片封面属性。

## 验证方式

- TDD 红绿验证：`asset-mappers.test.ts`、`video-preview-player.test.tsx`。
- 播放器受保护契约：`npm --prefix MultiMix-Frontend run check:video-preview-contract`。
- 样式契约：`npm --prefix MultiMix-Frontend run test:product-stage-style`。
- 展示区隔离覆盖：`npm --prefix MultiMix-Frontend run test:display-coverage`（脚本使用独立端口和临时 SQLite，并负责清理）。
- 静态验证：`npm --prefix MultiMix-Frontend run typecheck`。

## 实际结果

- 比例恢复按显式 ratio、工程 layout、工程 width/height 的确定性顺序实现；无需迁移 Webb 历史产物。
- 成片播放器使用首个不是明确视频类型的分镜缩略图作为加载 poster；没有安全缩略图时保持原有白色准备态。
- 定向测试 48/48 通过；播放器契约、产品样式契约、TypeScript 检查和展示区隔离覆盖通过。
- 展示区覆盖共 29 个组件测试、10 个浏览器案例通过；临时 SQLite、媒体目录和 3219/8299 测试进程已清理。
