# 对话视频附件临时禁用设计

> Status: archived
> Owner: frontend
> Last verified: 2026-07-30

## 背景与产品决定

用户确认：当前阶段不在聊天输入框中支持视频附件。图片和文档继续支持；视频素材库及其后端上传能力
继续保留。

当前两个聊天输入态存在不一致：

- `conversation-start.tsx` 和 `conversation-studio.tsx` 的媒体选择器声明接受
  `.mp4/.mov/.webm/.mkv`，按钮也写着“上传图片或视频素材”；
- 两个组件的 `handleAttachmentFiles` 实际只放行图片和文档；
- 因此用户从选择器选中视频后，文件会被静默丢弃，看不到结果或原因。

本设计用明确、统一的“聊天附件策略”取代这种表面支持、实际过滤的状态。

## 目标

- 聊天媒体选择器只展示图片格式，不再向用户承诺视频支持。
- 视频通过拖放或异常文件选择进入聊天时，不上传、不创建附件卡，并显示明确提示：
  `对话暂不支持视频附件，请先上传到视频素材库。`
- 图片和 PDF、文本、Markdown、HTML、Excel 文档保持现有上传、进度、失败和重试行为。
- 新建对话和已有对话使用同一策略，不能再次出现一个入口支持、另一个入口过滤的漂移。
- 视频素材库仍接受 `.mp4/.mov/.webm/.mkv`，后端视频上传接口不变。

## 非目标

- 不删除后端视频上传能力。
- 不修改视频素材库的选择器、上传路由或素材理解。
- 不把视频伪装成文档上传。
- 不调整附件进度条、发送安全门、上传重试或解析状态。
- 不新增浏览器 E2E 后端、SQLite 测试库或真实 Provider 调用。

## 方案比较

### 方案 A：只删除选择器中的视频扩展名

改动最少，但拖放视频仍会被静默过滤，两个组件仍各自维护判断，无法解决行为漂移。

### 方案 B：新增聊天专用附件策略（采用）

新增一个小型共享模块，统一选择器 accept、文件分类和拒绝原因。两个组件只消费策略结果。
这能同时修正文案、消除静默失败，并避免影响素材库。

### 方案 C：修改全局 `chatAttachmentFileKind`

会影响工作台把视频路由到视频素材库的现有能力，边界过大，不采用。

## 模块与数据流

新增 `MultiMix-Frontend/app/assets/lib/chat-attachment-policy.ts`：

- 导出聊天图片 accept：`image/png,image/jpeg,image/webp`；
- 导出聊天文档 accept：沿用当前 PDF、文本、Markdown、HTML、Excel 扩展名；
- 导出 `partitionChatAttachmentFiles(files)`，返回：
  - `acceptedFiles`：图片和受支持文档；
  - `rejectedVideoCount`：被拒绝的视频数量；
  - `rejectedUnsupportedCount`：其他不支持文件的数量。
- 视频按 `video/*` MIME 或 `.mp4/.mov/.webm/.mkv` 扩展名识别，避免拖放文件缺少可靠 MIME
  时漏过限制。

两个聊天组件的处理顺序一致：

1. 文件选择或拖放进入 `handleAttachmentFiles`；
2. 调用共享策略分组；
3. 有视频时写入现有 composer 错误区域，显示统一提示；
4. 仅将 `acceptedFiles` 交给现有 `onUploadImages`；
5. 同一批文件同时包含图片/文档和视频时，支持的文件继续上传，视频被拒绝并提示。

`asset-workspace-shared.ts` 中的 `chatAttachmentFileKind` 继续识别 `"video"`，因为工作台上传层和
视频素材库仍依赖这个分类。

## 用户界面调整

- 两个媒体按钮的 `aria-label` 和 `title` 从“上传图片或视频素材”改为“上传图片素材”。
- 两个媒体 input 删除 `.mp4/.mov/.webm/.mkv`。
- 现有提示“支持拖入 PDF / 图片素材”保持不变。
- 拖入视频后的错误使用两个组件已有的 composer error 区域，不新增 toast、弹窗或新样式。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/assets/lib/chat-attachment-policy.ts`：新增共享策略。
- `MultiMix-Frontend/app/assets/components/conversation-start.tsx:10-14,68,115-139,222-258`
  - 使用共享 accept 与分组；
  - 视频拒绝写入现有 `error`；
  - 更新媒体按钮无障碍文案。
- `MultiMix-Frontend/app/assets/components/conversation-studio.tsx:58-62,246,490-512,786-821`
  - 使用相同策略；
  - 视频拒绝写入现有 `sendError`；
  - 更新媒体按钮无障碍文案。
- `MultiMix-Frontend/app/assets/__tests__/chat-attachment-policy.test.ts`：策略单元测试。
- `MultiMix-Frontend/app/assets/__tests__/chat-video-attachment-rejection.test.tsx`：
  使用真实 `File(type="video/mp4")` 验证两个组件不调用上传回调并显示提示；
  同时验证图片和文档仍会进入上传回调。
- `MultiMix-Frontend/app/assets/__tests__/agent-ui-copy.test.ts`：结构契约改为断言聊天输入不再声明视频。
- `docs/plans/active/2026-07-21-chat-attachment-upload-progress.md`
  - 将“聊天支持视频”的旧产品决定标记为被本设计取代；
  - 删除“必须让视频进入上传回调”的过期回归待办；
  - 保留已经完成的真实进度、状态投影和历史验证记录。

## 错误处理

- 只含视频：不调用上传回调，显示统一提示。
- 视频与支持文件混合：支持文件正常上传，同时显示视频不支持提示。
- 其他未知格式：不上传；显示 `暂不支持该附件格式。`，不静默消失。
- 下一次只选择支持格式时清除上一次附件格式提示，继续使用组件现有错误区域，不新增样式。
- 后续正常发送或切换对话时，沿用组件现有逻辑清理 composer 错误。

## 测试设计

实施走 TDD，每项先观察失败：

1. 共享策略将 PNG/PDF 放入 `acceptedFiles`，将 MP4/MOV/WebM/MKV 计入拒绝视频。
2. 新建对话选择或拖入真实视频 `File` 时，上传回调为 0 次并显示统一提示。
3. 已有对话执行相同行为。
4. 混合文件中图片/文档继续上传，视频被拒绝。
5. 两个媒体 input 和按钮文案不再包含视频扩展名或“视频素材”。
6. 视频素材库的 `uploadAcceptForView("video")` 和 `chatAttachmentFileKind(video)` 保持原行为。

验证命令包括定向 Vitest、类型检查、定向 ESLint、全量前端测试、`check:agents` 和
三仓 `git diff --check`。本次是输入能力收敛，不需要启动后端或创建测试数据库。

## 风险与取舍

- 浏览器 `accept` 只是选择器提示，不能阻止拖放或构造的文件，因此必须保留运行时拒绝。
- 混合文件采用“支持项继续上传、视频明确拒绝”，避免一个视频阻断同批图片或文档。
- 旧计划包含已经完成的视频上传底层能力；只修订当前产品声明，不删除历史实施证据。
- 将来重新开放聊天视频时，应新建设计并同时恢复 accept、运行时策略、真实行为测试和浏览器验证，
  不能只把扩展名加回去。

## 完成标准

- 两个聊天入口不再展示视频支持。
- 视频不会进入聊天上传回调，也不会静默消失。
- 图片和文档现有行为零回归。
- 视频素材库和后端视频能力零改动。
- 旧 active 计划与新产品决定一致。

## 实施结果（2026-07-30）

- 实现与批准设计一致，无范围或行为偏差。
- 新增共享策略 `chat-attachment-policy.ts`，两个聊天组件均消费同一 accept、分组和拒绝文案。
- 新增策略测试与真实 `File` 拖放测试；RED 阶段分别确认缺少策略模块、缺少视频拒绝提示和旧按钮文案。
- 聚焦附件回归 5 个测试文件、77 个测试通过；全量前端 64 个测试文件、449 个测试通过。
- `typecheck`、定向 ESLint、`check:agents`、`docs:check` 和视频预览契约检查全部通过。
- 后端 worktree 保持干净；未启动后端、未创建 SQLite、未调用真实 Provider。
- 未运行登录态浏览器手工验证，因此不声明真实选择器交互或视觉表现已经浏览器确认。
