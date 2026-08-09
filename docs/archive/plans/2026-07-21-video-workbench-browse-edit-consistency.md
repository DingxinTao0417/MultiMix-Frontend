# 视频工作台浏览/编辑状态一致性修复计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-21

## 背景与根因

视频工作台已能在浏览态进入嵌入式胶片条编辑器，也能在编辑器内持久化 BGM、素材重组和时间线修改。但编辑器只向父工作台发送 ready、导出和“重组已开始”消息；BGM 保存与重组完成没有发送“工程已持久化”的版本更新通知。用户点击“完成编辑”后，`ProductWorkspace` 仍用进入编辑前的 `ProductArtifact` 渲染浏览态，因此可能显示旧素材、旧分镜或旧配乐状态。

同时，浏览态缺少只读的 BGM 摘要；现有 BGM 能力只在编辑器的 `BgmPanel` 中可见。现有工作台浏览/编辑计划的实现和验收勾选也未按现状回填。

## 目标

- 任意已持久化的编辑变更完成后，工作台从同一会话重新读取该视频产物，并让浏览态与编辑器使用同一服务端工程版本。
- 浏览态显示轻量、只读的 BGM 状态；选曲、试听和修改仍只在编辑器进行。
- 用组件测试和独立浏览器 E2E 验证“浏览 -> 编辑 -> 变更 -> 完成编辑 -> 浏览”闭环，以及失败保留旧状态。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/editor/EditorView.tsx`：`handleBgmProjectChanged`（约 158 行）与嵌入式 `postToParent` 桥接（约 76 行）。
- `MultiMix-Frontend/app/editor/FilmStrip.tsx`：重组合成完成后的 iframe 刷新路径（约 305–340 行）。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`：父窗口消息处理（约 230–310 行）、素材重组后的会话刷新（约 465–492 行）和“完成编辑”（约 680 行）。
- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：浏览态播放器和分镜摘要（约 270–360 行）。
- `MultiMix-Frontend/app/assets/__tests__/product-workspace-video-actions.test.tsx`、`app/assets/__tests__/video-browse-contract.test.ts`、`e2e/display-area.spec.ts`：回归和浏览器验收。
- `docs/specs/video-workbench-browse-and-filmstrip-edit.md`、`docs/plans/active/2026-07-11-video-workbench-browse-filmstrip.md`：更新实际完成状态和验收记录。

## 具体改法

1. 统一嵌入编辑器的持久化事件为 `multimix-editor-project-updated`，消息含 `assetId` 与变更原因；只在服务端成功保存、BGM 更新成功或重组合成任务成功后发送。纯本地裁剪/分割仍沿用自动保存，但保存成功后也必须通知父窗口。
2. `ProductWorkspace` 收到该事件后，在已有 token、会话和 `onProductUpdated` 时复用现有 `loadConversationDetail` 路径，定位同一 `backendAssetId` 并替换当前产物；刷新失败不得清空现有浏览态，并展示可重试提示。刷新期间保留编辑面，完成编辑后再进入已更新浏览态。
3. 从 `metadata.video_project` 的 `track-bgm` / 已投影 BGM 选择信息生成只读摘要，仅显示“背景音乐：已关闭 / AI 匹配 / 已选择曲名”；不在浏览态发起曲库请求或提供选曲控件。数据缺失时不显示摘要，避免伪造状态。
4. 测试先行：分别写入并观察失败的 BGM 持久化通知、重组完成通知、工作台刷新成功与刷新失败保留旧内容、浏览态 BGM 摘要用例；再以最小桥接代码实现。
5. 新增独立端口与一次性 SQLite 的 Playwright 用例，覆盖浏览进入编辑、触发持久化事件、完成编辑后显示更新结果；补充播放跨分镜高亮、键盘换素材入口、失败保留旧素材及全屏编辑入口。测试前告知临时库路径，结束后删除数据库并关闭自启进程。

## 风险与取舍

- 只接受已持久化成功后的事件，避免本地未保存裁剪提前污染浏览态。
- 父窗口仍以服务端重新读取的映射结果为准，不直接信任 iframe 传来的完整工程 JSON，防止双状态源漂移。
- BGM 摘要是只读投影；无明确工程数据时宁可隐藏，不基于曲库默认值猜测。
- 不改变受保护的视频播放器外壳、媒体比例、控制条或全屏编辑器入口。

## 验证方式

- RED/GREEN：定向 Vitest 覆盖父子消息、会话刷新、失败回退和 BGM 摘要。
- 前端回归：相关 Vitest、`npm --prefix MultiMix-Frontend run typecheck`、`npm --prefix MultiMix-Frontend run lint`、`npm --prefix MultiMix-Frontend run docs:check`。
- 浏览器：隔离的有 MP4、无 MP4、MG 失败、素材替换失败和非 ready 五种状态；新增编辑返回浏览态一致性场景。
- 若动到播放器相关选择器或 CSS，运行 `check:video-preview-contract`、`test:product-stage-style`、隔离的 `test:display-coverage`，并保留截图基线。

## 实施记录（2026-07-21）

- [x] `ProductWorkspace` 现在消费 `multimix-editor-project-updated`，并从当前会话重新读取同一 `backendAssetId` 后替换工作台产物；读取失败保留旧浏览态并提供“重试刷新”。
- [x] `EditorView` 在 BGM 持久化成功后、`FilmStrip` 在时间线自动保存或分镜重组合成成功后发送该事件；父窗口不接收 iframe 的完整工程 JSON。
- [x] 浏览态从已持久化的 `video_project.metadata.bgm_choice` 和对应 BGM media 投影只读摘要；无明确选择时不显示，不请求曲库。
- [x] 定向回归：工作台刷新成功/失败、嵌入编辑器消息桥接、浏览态 BGM 摘要共 37 项通过；展示区组件矩阵 27 项通过；播放器契约和产品展示区样式契约通过；类型检查和文档检查通过。
- [x] 隔离浏览器 E2E 已执行：`test:display-coverage` 的组件矩阵 27/27、浏览器矩阵 8/8 通过。一次性 SQLite `multimix-display-coverage-workbench-sync-20260721.sqlite3`、artifact 目录、8299/3219 自启服务和隔离 Next 构建目录均已由脚本清理。
- [x] 全库 `npm run lint` 通过；未删除未跟踪 `.next-upload-e2e/`，而是将所有 `.next-*` 的 Next 生成输出正确排除在 ESLint 源码输入外。

### 验证环境偏差修正

`eslint.config.mjs` 当前仅忽略默认 `.next/**`，而隔离上传/E2E 使用 `.next-upload-e2e/` 等独立 Next 输出目录。它们不是源码，ESLint 不应扫描。将在忽略列表加入 `.next-*/**`（保留默认 `.next/**`），随后重跑全库 lint；不删除未跟踪的构建目录。
