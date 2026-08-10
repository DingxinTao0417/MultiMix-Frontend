# 对话附件真实上传进度实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-30

> **Current product decision (2026-07-30):** 对话输入框暂不支持视频附件。
> 本文中“开放聊天视频选择”和视频浏览器冒烟属于历史实施目标，已被
> `docs/archive/plans/2026-07-30-chat-video-attachment-temporary-disable-design.md`
> 取代；视频素材库和底层上传能力继续保留。

> **For agentic workers:** 在当前会话内逐项执行本计划；未经用户明确批准不得委派 Subagent。每一步先写失败测试、确认失败，再做最小实现。

**Goal:** 在对话输入框内为图片、视频和文档附件分别显示真实的上传百分比与进度条，传输完成后显示“上传完成”，同时维持素材尚未可用时的发送安全门。

**Architecture:** 将浏览器上传从不可观察的 `fetch` 表单请求收敛为支持 `XMLHttpRequest.upload.onprogress` 的前端适配器能力，向每个附件的本地状态写入 `uploadProgress`。两个对话输入组件只消费同一附件状态并复用同一套卡片文案/样式；服务端接口、素材理解和 `metadata.understanding` 不变。视频上传使用既有 `/v1/assets/upload` 的 `target_kind=video`，不新增后端 API。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest、现有 FastAPI 上传接口。

## 背景与根因

- 现状在 `MultiMix-Frontend/app/assets/components/conversation-studio.tsx:38-53` 和 `conversation-start.tsx:10-14` 中把附件状态简化为 `uploading|processing|ready|failed`，卡片只显示“上传中”。
- `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts:1055-1060` 用 `fetch` 提交 `FormData`，浏览器 Fetch API 不提供请求上传字节进度，因此界面无法判断上传是否卡住。
- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx:1422-1448` 为每个附件并行调用上传，但未保存进度。前端也未接受视频；后端已支持 `.mp4/.mov/.webm/.mkv` 和 `target_kind=video`（`MultiMix-Backend/app/api/assets.py:341-346`）。

## 已确认产品决策

- 范围仅限对话输入框附件卡片，不改素材库上传按钮。
- 图片、视频、文档均显示每文件独立的真实传输进度；不使用定时模拟或估算百分比。
- 浏览器将字节传输完成且服务端返回成功后，卡片显示“上传完成”；不在附件卡片上展示“解析中/识别中”。
- 素材可供 AI 使用仍以现有后端就绪状态为准：发送门继续阻止尚未准备好的附件，文案改为中性描述，不能把“上传完成”误表述为“已可创作”。
- 上传失败继续显示错误和重试；重试从 0% 开始。删除上传中的附件仍只能移除卡片，不能承诺取消已发出的 HTTP 请求。

## 涉及文件与边界

- 修改 `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`：为 `uploadAsset` 增加可选 `onProgress(percent)`；唯一负责 XHR、鉴权、HTTP 错误和 JSON 解析。
- 修改 `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`：确定文件类别（图片/视频/文档）、记录每个附件百分比和传输完成的展示状态，并将回调传给适配器。
- 修改 `MultiMix-Frontend/app/assets/components/conversation-studio.tsx` 与 `conversation-start.tsx`：允许视频文件、统一状态文案与进度条 DOM，保留两个输入态的行为一致。
- 修改 `MultiMix-Frontend/app/globals.css`：只新增附件卡内的细进度轨、可访问性隐藏文本与不同类别图标布局；不改变受保护的视频预览播放器样式。
- 修改/新增 `MultiMix-Frontend/app/assets/__tests__/*`：覆盖进度合同、视频路由和发送门文案；不触及后端，因为 API 契约不变。

## 风险与取舍

- XHR 用于这一条 multipart 上传，其他 API 保留 fetch；这是浏览器可获得真实上传字节进度的最小边界。
- `progress.total` 缺失或为 0 时只显示“上传中”和不确定进度条，绝不伪造百分比；本地文件上传通常会提供 total。
- 100% 仅在服务器成功响应后提交到卡片，以避免“字节已发完但服务端拒绝”被显示成上传完成。
- 后端当前同步执行初始理解；未来改为异步时，发送门仍能根据 `processing` 安全阻止发送，附件卡片不会泄漏该内部阶段。
- 视频进入 `target_kind=video`，文档继续进入 `assets`；不能把视频作为文档上传，否则会触发后端类型一致性校验失败。

## 验证方式

- Vitest：真实百分比映射、无 `total` 降级、失败/重试、图片/视频/文档文件类别和发送门。
- TypeScript、ESLint 与全量前端单元测试。
- 通过浏览器手工验证：一个图片、一个 `.mp4`、一个 PDF 同时上传，进度相互独立；传输完成后卡片显示“上传完成”；素材未就绪时发送按钮仍给出中性阻止提示；失败后重试重新计数。
- 不启动 E2E 独立后端或创建 SQLite 数据库；本次无需测试库。

---

### Task 1: 为上传适配器暴露真实字节进度

**Files:**

- Modify: `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts:261,1055-1060`
- Test: `MultiMix-Frontend/app/assets/__tests__/asset-workspace-adapter-upload.test.ts`

**Interfaces:**

- Extends `uploadAsset(token, file, view, onProgress?)` where `onProgress?: (percent: number | null) => void`.
- Produces one terminal response promise with the existing `ContentAsset` shape; a non-2xx response rejects with the existing formatted API error.

- [x] **Step 1: Write failing adapter tests**

  Stub `XMLHttpRequest`, invoke `uploadAsset` with a file, emit `{ loaded: 25, total: 100, lengthComputable: true }`, and assert the callback receives `25`; emit a success response and assert the parsed asset is returned. Add a second test with `lengthComputable: false` that asserts `null`, and a 422 response that rejects.

- [x] **Step 2: Run the focused test and verify red**

  Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/asset-workspace-adapter-upload.test.ts`

  Expected: FAIL because the adapter has no progress callback or XHR upload implementation.

- [x] **Step 3: Implement the minimal XHR multipart helper**

  Replace only the `uploadAsset` request path with a local promise helper that sets `Authorization: Bearer <token>`, appends unchanged `file` and `target_kind`, calls `onProgress(Math.round(loaded / total * 100))` only for computable totals, and resolves after a successful JSON response. Preserve the existing fetch implementation for all other adapter methods.

- [x] **Step 4: Run focused verification**

  Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/asset-workspace-adapter-upload.test.ts`

  Expected: PASS.

**执行结果（2026-07-21）：** 已完成。新增 `asset-workspace-adapter.test.ts` 的可计算/不可计算上传字节测试；聚焦测试 17 项通过。实现保留原 `fetch` 路径给无进度回调的调用方，并在对话上传路径使用 XHR；502/503/504 保留一次重试。

### Task 2: 建立统一的对话附件类别和上传状态投影

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/conversation-studio.tsx:38-53`
- Modify: `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx:91-93,1385-1468`
- Modify: `MultiMix-Frontend/app/assets/lib/asset-workspace-shared.ts:93-114`
- Test: `MultiMix-Frontend/app/assets/__tests__/chat-attachment-upload-state.test.ts`

**Interfaces:**

- Extends `ChatImageAttachment` with `fileKind: "image" | "video" | "source"` and `uploadProgress?: number | null`.
- Produces `chatUploadFileKind(file): "image" | "video" | "source"`, with videos sent to adapter view `"video"`, sources to `"assets"`, and images to `"image"`.
- Produces a single presentation helper for `上传中 ${n}%` / `上传中` / `上传完成` / `上传失败` so both composers cannot drift.

- [x] **Step 1: Write failing state tests**

  Assert `.mp4`, `.mov`, `.webm`, and `.mkv` map to `video`; a 37% in-flight attachment returns `上传中 37%`; an uncomputable upload returns `上传中`; a server-returned processing asset presents `上传完成` but `attachmentSendBlockReason` still prevents sending with the neutral message `资料正在准备，暂不可发送。`.

- [x] **Step 2: Run the focused test and verify red**

  Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/chat-attachment-upload-state.test.ts app/assets/__tests__/attachment-send-guard.test.ts`

  Expected: FAIL because video has no chat type and state has no progress/presentation helper.

- [x] **Step 3: Implement the smallest shared state change**

  Add the category and progress fields, update upload initialization to `uploadProgress: 0`, forward adapter progress into only the matching attachment, and set terminal `uploadProgress: 100` only after the adapter resolves. Keep the internal `processing`/`ready` status for state safety; project its display through the new shared helper as `上传完成`.

- [x] **Step 4: Run focused verification**

  Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/chat-attachment-upload-state.test.ts app/assets/__tests__/attachment-send-guard.test.ts`

  Expected: PASS.

**执行结果（2026-07-21）：** 已完成。新增 `chat-attachment-upload-state.test.ts`，并更新发送门回归测试；进度状态、视频分类和中性阻止文案共 25 项聚焦测试通过。

### Task 3: 统一两个对话输入态的进度 UI 并开放视频选择

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/conversation-studio.tsx:49-53,629-724`
- Modify: `MultiMix-Frontend/app/assets/components/conversation-start.tsx:10-14,176-257`
- Modify: `MultiMix-Frontend/app/globals.css:1943-2026`
- Test: `MultiMix-Frontend/app/assets/__tests__/agent-ui-copy.test.ts`

**Interfaces:**

- Both components render an `aria-live="polite"` upload-status element and a semantic progressbar (`role="progressbar"`, bounded `aria-valuenow` only when determinate).
- The existing media entry accepts `.mp4,.mov,.webm,.mkv` in addition to existing image files; non-image file card fallback remains usable.

- [x] **Step 1: Extend the source contract test first**

  Add assertions that both composer files contain the shared attachment status helper, video extensions, `role="progressbar"`, and the upload-complete copy; ensure neither contains a simulated timer or synthetic percentage.

- [x] **Step 2: Run the focused contract test and verify red**

  Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/agent-ui-copy.test.ts`

  Expected: FAIL because neither composer exposes upload progress or video selection.

- [x] **Step 3: Implement the two equivalent render branches and CSS**

  Keep the attachment filename, remove/retry controls, thumbnail and fallback icon. For `uploading`, add a 3px progress rail with width from the actual percentage; for unknown totals use an indeterminate rail and omit numeric ARIA value. For completed transfer, render `上传完成`; for failure retain the error/retry UI. Expand the image picker accept value to include the supported video extensions and update its label to describe image/video materials.

- [x] **Step 4: Run focused verification**

  Run: `npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/agent-ui-copy.test.ts app/assets/__tests__/chat-attachment-upload-state.test.ts`

  Expected: PASS.

**执行结果（2026-07-21）：** 已完成。两个输入态均渲染相同的 `aria-live` 状态和 `role="progressbar"`；源码契约与状态测试 62 项通过。

### Task 4: 回归验证与文档准入检查

**Files:**

- Modify: this plan, marking completed steps and recording actual commands/results.

- [x] **Step 1: Run frontend validation**

  Run:

  ```powershell
  npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/asset-workspace-adapter-upload.test.ts app/assets/__tests__/chat-attachment-upload-state.test.ts app/assets/__tests__/attachment-send-guard.test.ts app/assets/__tests__/agent-ui-copy.test.ts
  npm --prefix MultiMix-Frontend run typecheck
  npm --prefix MultiMix-Frontend run lint
  npm --prefix MultiMix-Frontend run test
  npm --prefix MultiMix-Frontend run docs:check
  ```

  Expected: every command exits 0.

- [ ] **Step 2: Perform a browser-level manual smoke test without a test database**

  In the existing authenticated development workspace, select one PNG, one MP4 and one PDF; verify independent determinate progress, no invented parsing percentage, `上传完成` after each successful request, video is stored as video, and send remains safely unavailable until the backend reports assets usable. Verify a forced upload error exposes retry and a retry restarts at 0%.

- [x] **Step 3: Record actual results and scope**

  Replace this task's unchecked checklist with the executed commands, outcome, manual smoke-test evidence, and any deliberately unrun validation. Do not claim visual or end-to-end confirmation from unit tests alone.

**执行结果（2026-07-21）：**

- 通过：`npm --prefix MultiMix-Frontend/.worktrees/codex-chat-attachment-upload-progress run lint`（0 error，9 条既有 `<img>` 优化 warning）、`typecheck`、聚焦 Vitest（84 tests）、全量 `npm test`（45 files / 333 tests）。
- 通过：根工作区中的 `npm --prefix MultiMix-Frontend run docs:check`。隔离工作树内运行同一命令会因其父目录不含工作区 docs 根而跳过，未把“跳过”计为通过。
- 未运行：需要已登录真实后端的浏览器上传冒烟；本次未启动独立后端、未创建 SQLite 测试库，也未连接开发者正在使用的服务。故尚未以浏览器实测确认真实网络上传的视觉表现。

## 当前收口（2026-07-30）

- [x] 两个聊天媒体选择器不再声明视频格式或视频文案。
- [x] 视频通过拖放或构造文件进入时被明确拒绝，不调用聊天上传回调。
- [x] 图片和文档继续上传，混合文件不因视频而整体失败。
- [x] 视频素材库和 `chatAttachmentFileKind(video)` 保持不变。

## 浏览器复现后的状态对账收口（2026-07-31）

### 背景与根因

- 真实浏览器上传 `商业计划书v0(1).pdf` 后，`POST /v1/assets/upload` 已成功；线上库中源资产为
  `ready/source_ready`，最新 ingest job 为 `completed/ready`。
- 对话附件卡却仍显示“上传完成”，发送门仍提示“资料正在准备”。这说明浏览器内附件状态停在
  `processing`，而不是服务端解析未完成。
- 现有 `waitForUploadedSourceReady` 只在单次上传回调中启动。该一次性启动若因重渲染、短暂断连或
  回调时序遗漏，就没有后续的状态对账入口；页面会安全地一直阻止发送，但不会自行恢复。

### 涉及文件与具体改法

- 修改 `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`：为当前对话中所有已获服务端
  `assetId` 且本地仍为 `processing` 的附件建立幂等状态对账。使用 ref 记录正在轮询的附件，避免渲染或
  现有单次回调产生重复请求；完成时仅将对应附件改为 `ready`，失败时保留现有失败提示。
- 修改/新增 `MultiMix-Frontend/app/assets/__tests__/`：先覆盖“已有 processing 附件会触发一次对账、
  同一附件不会并发重复对账、完成后解除安全门”的回归。
- 不修改后端上传/素材理解逻辑、`metadata.understanding`、视频确认门或发送门规则；服务端状态仍是
  唯一可用性依据。

### 风险与取舍

- 轮询只针对本地已接受且仍未就绪的附件，且同一附件同一时刻只允许一个请求；不会把上传中的字节
  传输伪装成完成，也不会提前允许发送。
- 网络读取失败继续保持 `processing` 并按既有节奏重试；用户仍可删除附件或离开页面，卸载后停止。

### 验证方式

1. 先运行新增回归测试，证明旧实现无法从已存在的 `processing` 状态恢复。
2. 实现最小状态对账后，运行聚焦 Vitest、TypeScript 与 `docs:check`。
3. 在当前已登录浏览器复测 PDF：先看到真实上传完成，再等待服务端 ready 后发送按钮恢复；随后继续
   同一条“仅已保存素材、不使用公共素材”的视频生成测试。

## 完成标准

- [x] 图片和文档能在两个对话输入态完成选择和上传；聊天视频被明确拒绝并指向视频素材库。
- [x] 不存在模拟进度或把后端解析时间显示为上传百分比的逻辑。
- [x] 传输完成后显示“上传完成”，但后台未就绪的素材仍不能被静默遗漏或提前发送。
- [x] 上传失败可重试，重试进度从 0% 重新开始。
- [x] 计划中的自动化验证和文档检查均通过，未执行的浏览器验证已如实记录。
