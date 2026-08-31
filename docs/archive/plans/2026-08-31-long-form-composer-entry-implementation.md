# 长视频与播客统一对话入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Status: archived
> Owner: frontend
> Last verified: 2026-08-31

**Goal:** 把长视频文件、受支持视频链接和视频库原片统一带入对话输入框，在用户明确提交处理需求后才启动长内容分析，并移除固定数量承诺。

**Architecture:** 前端输入框负责来源附件、上传 / 导入状态和需求确认；视频文件继续调用长视频专用流式上传接口，视频链接继续调用长视频导入任务。对话提交层只在存在一个已就绪长视频来源且用户提交了非空需求时附加结构化 `long_form_action=analyze`，底层候选 schema 和分析执行链保持不变。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest、Testing Library、Playwright、现有 MultiMix asset adapter 与长视频 API。

## Global Constraints

- 新建对话和已有对话共用同一个输入框入口，不保留独立长视频大卡片或弹窗。
- 视频或链接准备完成后只形成来源附件，不自动开始转写、视觉分析、章节整理或片段推荐。
- 只有用户提交非空需求后才允许发送 `long_form_action=analyze`；仅上传来源时必须停在“待说明需求”。
- 输入框建议只填入文字，不自动发送、不排队。
- 所有生产 UI、默认指令、进度文案和 E2E fixture 不出现固定候选数量承诺；候选卡使用“推荐”而非排行语言。
- 内部 `top_candidate_ids` 等既有持久化 schema 不在本次改名，避免无关数据迁移。
- 长视频文件只允许 MP4、MOV、WebM、MKV；同一轮对话草稿只接受一个待分析长视频来源。
- YouTube、Bilibili 和公开直链 MP4 使用现有长视频 URL 导入接口；普通 URL 保持普通文本粘贴。
- 当前工作区已有未提交修改；所有编辑必须按当前文件内容做最小补丁，不覆盖无关差异。
- 开发期必须登记 `work:guard`；提交、推送仍遵守独立的 submit guard 和用户授权边界。

---

## File Map

- `app/assets/lib/chat-attachment-policy.ts`：定义输入框可接受的图片、文档和长视频文件类型。
- `app/assets/lib/long-form-composer-source.ts`：识别可导入视频 URL，并把文件上传 / URL 导入统一成 `LongFormSourceReady`。
- `app/assets/components/long-form-composer-prompt.tsx`：复用“先说明处理需求”的输入框内提示与填入式建议。
- `app/assets/components/conversation-start.tsx`：新对话输入框的视频按钮、拖放、粘贴、提示和空需求门禁。
- `app/assets/components/conversation-studio.tsx`：已有对话输入框的同等行为。
- `app/assets/components/assets-workspace-client.tsx`：来源附件状态、专用上传 / 导入、重试、视频库带入和结构化分析提交。
- `app/assets/components/library-workshop.tsx`：把视频库拆条动作表述为加入对话并先说明需求。
- `app/assets/components/long-form-candidate-set.tsx`：移除 `Top N` 排行文案，保留真实候选数量。
- `app/assets/components/long-form-entry.tsx`、`long-form-entry.module.css`：统一入口完成后删除。
- `app/globals.css`：增加轻量需求提示的样式，不修改受保护的视频播放器选择器。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`docs/API.md`：更新单一入口、附件类型和分析启动边界。
- `app/assets/__tests__/*`、`e2e/long-form-repurpose.spec.ts`、`e2e/product-positioning.spec.ts`：覆盖 TDD 回归和浏览器行为。

---

### Task 1: 对话附件接受一个长视频来源

**Files:**
- Modify: `app/assets/lib/chat-attachment-policy.ts`
- Modify: `app/assets/__tests__/chat-attachment-policy.test.ts`
- Modify: `app/assets/__tests__/chat-video-attachment-rejection.test.tsx`

**Interfaces:**
- Produces: `CHAT_VIDEO_UPLOAD_ACCEPT: string`
- Produces: `partitionChatAttachmentFiles(files)` 把受支持视频加入 `acceptedFiles`
- Consumes: 既有 `chatAttachmentFileKind(file)` 将视频映射为 `fileKind="video"`

- [x] **Step 1: 把拒绝视频测试改成接受视频的失败测试**

```ts
it.each([
  ["clip.mp4", "video/mp4"],
  ["clip.mov", "video/quicktime"],
  ["clip.webm", "video/webm"],
  ["clip.mkv", "video/x-matroska"],
])("accepts chat video %s", (name, type) => {
  const video = file(name, type);
  expect(partitionChatAttachmentFiles([video]).acceptedFiles).toEqual([video]);
});
```

- [x] **Step 2: 运行测试确认旧策略失败**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/chat-attachment-policy.test.ts app/assets/__tests__/chat-video-attachment-rejection.test.tsx`

Expected: FAIL，视频仍被计入 `rejectedVideoCount`，两个输入框仍显示“请先上传到视频素材库”。

- [x] **Step 3: 最小修改附件策略**

```ts
export const CHAT_VIDEO_UPLOAD_ACCEPT = ".mp4,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska";

if (
  file.type.startsWith("image/")
  || VIDEO_EXTENSION_PATTERN.test(file.name)
  || file.type.startsWith("video/")
  || SOURCE_EXTENSION_PATTERN.test(file.name)
) {
  partition.acceptedFiles.push(file);
} else {
  partition.rejectedUnsupportedCount += 1;
}
```

同时删除 `rejectedVideoCount` 和专用拒绝文案，让混合拖放只报告真正不支持的格式。

- [x] **Step 4: 运行策略与输入框拖放测试**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/chat-attachment-policy.test.ts app/assets/__tests__/chat-video-attachment-rejection.test.tsx app/assets/__tests__/chat-attachment-upload-state.test.ts`

Expected: PASS；两个输入框把视频和图片一起交给 `onUploadImages`。

### Task 2: 用专用链路准备文件与链接附件

**Files:**
- Create: `app/assets/lib/long-form-composer-source.ts`
- Create: `app/assets/__tests__/long-form-composer-source.test.ts`
- Modify: `app/assets/lib/long-form-client.ts`

**Interfaces:**
- Produces: `supportedLongFormUrlFromText(text: string): string | null`
- Produces: `prepareLongFormComposerSource(args): Promise<LongFormSourceReady>`
- Produces: `resolveLongFormAnalyzeAction(attachments, instruction): AssetLongFormAction | undefined`
- Consumes: `uploadLongFormSource`、`importLongFormSourceUrl`、`waitForLongFormSourceReady`

- [x] **Step 1: 写 URL 识别和来源准备失败测试**

```ts
expect(supportedLongFormUrlFromText("https://youtu.be/abc123")).toBe("https://youtu.be/abc123");
expect(supportedLongFormUrlFromText("https://www.bilibili.com/video/BV1xx411c7mD")).toBeTruthy();
expect(supportedLongFormUrlFromText("https://cdn.example.com/show.mp4")).toBeTruthy();
expect(supportedLongFormUrlFromText("看看 https://example.com/article")).toBeNull();

await expect(prepareLongFormComposerSource({
  token: "token",
  input: { kind: "file", file },
  signal: new AbortController().signal,
  onProgress,
})).resolves.toEqual({ id: 91, title: "访谈" });
```

- [x] **Step 2: 运行测试确认新模块不存在**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-composer-source.test.ts`

Expected: FAIL with module not found.

- [x] **Step 3: 实现结构化 URL 检测与统一准备函数**

```ts
const VIDEO_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be",
  "bilibili.com", "www.bilibili.com", "m.bilibili.com", "player.bilibili.com",
]);

export function supportedLongFormUrlFromText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!/^https?:$/.test(url.protocol)) return null;
    return VIDEO_HOSTS.has(url.hostname.toLowerCase()) || url.pathname.toLowerCase().endsWith(".mp4")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
```

`prepareLongFormComposerSource` 的文件分支调用 `uploadLongFormSource`；URL 分支调用导入接口，非完成态继续等待 durable ingest，最终返回稳定资产 ID。AbortError 原样向上传递，其他错误由现有 `formatComposerError` 展示。

- [x] **Step 4: 运行来源准备测试**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-composer-source.test.ts app/assets/__tests__/long-form-client.test.ts`

Expected: PASS；文件和 URL 都只返回 ready source，不触发分析。

### Task 3: 两个输入框统一显示来源、需求提示和发送门禁

**Files:**
- Create: `app/assets/components/long-form-composer-prompt.tsx`
- Create: `app/assets/__tests__/long-form-composer-prompt.test.tsx`
- Modify: `app/assets/components/conversation-start.tsx`
- Modify: `app/assets/components/conversation-studio.tsx`
- Modify: `app/globals.css`
- Modify: `app/assets/__tests__/composer-ime-submit.test.tsx`
- Modify: `app/assets/__tests__/runtime-write-capability-gating.test.tsx`

**Interfaces:**
- Produces: `LongFormComposerPrompt({ onFill })`
- Consumes: `onImportVideoUrl?: (url: string) => void`
- Consumes: `imageAttachments` 中 `fileKind === "video"` 的状态

- [x] **Step 1: 写提示、填入和空需求门禁失败测试**

```tsx
render(<LongFormComposerPrompt onFill={onFill} />);
fireEvent.click(screen.getByRole("button", { name: "找出值得发布的片段" }));
expect(onFill).toHaveBeenCalledWith("找出这段内容中值得发布的片段");

render(<ConversationStart
  conversation={conversation()}
  suggestions={[]}
  imageAttachments={[readyVideoAttachment]}
  onSend={onSend}
/>);
fireEvent.click(screen.getByRole("button", { name: "发送" }));
expect(onSend).not.toHaveBeenCalled();
expect(screen.getByRole("alert")).toHaveTextContent("请先说明你想怎么处理这段内容");
```

- [x] **Step 2: 运行组件测试确认失败**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-composer-prompt.test.tsx app/assets/__tests__/composer-ime-submit.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx`

Expected: FAIL，提示组件和视频需求门禁尚不存在。

- [x] **Step 3: 实现复用提示组件**

```tsx
const suggestions = [
  ["找出值得发布的片段", "找出这段内容中值得发布的片段"],
  ["按主题或观点筛选", "按我指定的主题或观点筛选这段内容"],
  ["先梳理内容结构", "先梳理这段内容的章节和结构，再让我决定下一步"],
] as const;

export default function LongFormComposerPrompt({ onFill }: { onFill: (value: string) => void }) {
  return (
    <div className="shadcn-prototype-long-form-prompt" aria-label="长视频处理需求">
      <p>你想怎么处理这段内容？</p>
      <div>{suggestions.map(([label, value]) => (
        <button type="button" key={label} onClick={() => onFill(value)}>{label}</button>
      ))}</div>
    </div>
  );
}
```

- [x] **Step 4: 把视频按钮、拖放、链接粘贴和门禁接入两个输入框**

两个组件新增隐藏视频 input 与“上传视频素材”按钮；`onPaste` 只在剪贴板是一个受支持 URL 时 `preventDefault()` 并调用 `onImportVideoUrl`。当存在 ready video 时显示 `LongFormComposerPrompt`。提交逻辑先执行：

```ts
const explicitInstruction = composerValue.trim();
if (hasReadyVideoAttachment && !explicitInstruction) {
  setError("请先说明你想怎么处理这段内容。");
  return;
}
```

图片 / 文档的无文字默认行为、IME Enter、只读门禁和停止按钮保持原样。

- [x] **Step 5: 运行两个输入框的聚焦测试**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-composer-prompt.test.tsx app/assets/__tests__/chat-video-attachment-rejection.test.tsx app/assets/__tests__/composer-ime-submit.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx app/assets/__tests__/accessibility-interactions.test.tsx`

Expected: PASS；新建和已有对话行为一致。

### Task 4: 父级状态使用专用上传并仅在确认后分析

**Files:**
- Modify: `app/assets/components/assets-workspace-client.tsx`
- Modify: `app/assets/components/library-workshop.tsx`
- Modify: `app/assets/__tests__/long-form-library-entry.test.tsx`
- Modify: `app/assets/__tests__/long-form-composer-source.test.ts`

**Interfaces:**
- Consumes: `prepareLongFormComposerSource`
- Produces: `ChatImageUpload` 支持 `{ file?: File; sourceUrl?: string }`
- Produces: ready video + non-empty instruction -> `{ kind: "analyze", sourceAssetId }`

- [x] **Step 1: 写“准备不分析、提交才分析”的失败契约测试**

```ts
expect(resolveLongFormAnalyzeAction([], "找出值得发布的片段")).toBeUndefined();
expect(resolveLongFormAnalyzeAction([readyVideo], "")).toBeUndefined();
expect(resolveLongFormAnalyzeAction([readyVideo], "找出值得发布的片段")).toEqual({
  kind: "analyze",
  sourceAssetId: 91,
});
```

视频库测试改为断言点击“拆成短视频”后不调用发送接口，而是把 ready source 带入新对话并显示需求提示。

- [x] **Step 2: 运行测试确认旧行为失败**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-composer-source.test.ts app/assets/__tests__/long-form-library-entry.test.tsx`

Expected: FAIL，视频库仍直接发送固定分析指令，提交解析函数尚不存在。

- [x] **Step 3: 实现可单测的提交解析与附件状态**

```ts
export function resolveLongFormAnalyzeAction(
  uploads: readonly Pick<ChatImageAttachment, "assetId" | "fileKind" | "status">[],
  instruction: string,
): AssetLongFormAction | undefined {
  const readyVideos = uploads.filter((item) => item.fileKind === "video" && item.status === "ready" && item.assetId);
  const sourceAssetId = readyVideos.length === 1 ? readyVideos[0]?.assetId : undefined;
  if (typeof sourceAssetId !== "number" || !instruction.trim()) return undefined;
  return { kind: "analyze", sourceAssetId };
}
```

`handleSendConversationMessage` 使用显式传入动作优先，否则从当前对话草稿解析动作。`selected_product_id` 继续在 analyze 时省略；ready video 同时作为来源附件，不建立图片素材包。

- [x] **Step 4: 文件、链接、重试和视频库统一写入附件状态**

- 文件视频通过 `prepareLongFormComposerSource({ input: { kind: "file", file } })`。
- URL 通过 `prepareLongFormComposerSource({ input: { kind: "url", url } })`。
- 普通图片 / 文档继续走 `assetWorkspaceAdapter.uploadAsset`。
- 视频库 `intent === "long-form"` 只创建 ready video attachment 并切回对话，不调用 `handleSendConversationMessage`。
- `handleRetryChatImage` 根据 `file` 或 `sourceUrl` 重走对应准备分支。
- 同一草稿已有一个视频来源时拒绝第二个，保留其他图片 / 文档附件能力。

- [x] **Step 5: 运行父级与 adapter 聚焦测试**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-composer-source.test.ts app/assets/__tests__/long-form-library-entry.test.tsx app/assets/__tests__/asset-workspace-adapter.test.ts app/assets/__tests__/chat-attachment-upload-state.test.ts`

Expected: PASS；来源准备没有消息请求，提交明确需求才带结构化 analyze action。

### Task 5: 删除旧入口并收敛候选文案

**Files:**
- Delete: `app/assets/components/long-form-entry.tsx`
- Delete: `app/assets/components/long-form-entry.module.css`
- Delete: `app/assets/__tests__/long-form-entry.test.tsx`
- Modify: `app/assets/components/long-form-candidate-set.tsx`
- Modify: `app/assets/__tests__/long-form-candidate-set.test.tsx`
- Modify: `app/assets/__tests__/asset-mappers.test.ts`
- Modify: `e2e/long-form-repurpose.spec.ts`

**Interfaces:**
- Consumes: 统一输入框与视频库附件行为
- Preserves: `LongFormAnalysis.top_candidate_ids` 内部 schema

- [x] **Step 1: 更新候选文案与旧入口缺失的失败测试**

```ts
expect(screen.getByText("推荐 1")).toBeInTheDocument();
expect(screen.queryByText(/^Top\s/i)).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: "上传长视频或粘贴链接" })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: "上传视频素材" })).toBeVisible();
```

浏览器用例把视频库点击后的断言改为“进入对话、显示来源附件和需求提示、没有消息 POST”；输入需求并发送后再断言精确 `long_form_action`，指令不包含固定数量。

- [x] **Step 2: 运行候选与 E2E fixture 单测确认失败**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-candidate-set.test.tsx app/assets/__tests__/asset-mappers.test.ts`

Expected: FAIL，候选仍显示 `Top 1`，旧入口仍存在。

- [x] **Step 3: 删除旧入口并替换用户可见排行文案**

```tsx
<div className={styles.rank}>推荐 {index + 1}</div>
```

删除 `LongFormEntry` import、props 和渲染；保留 `long-form-client.ts` 的上传、导入、候选解析和预览能力。

- [x] **Step 4: 运行候选、映射和长视频 E2E**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/long-form-candidate-set.test.tsx app/assets/__tests__/asset-mappers.test.ts`

Run from `MultiMix-Frontend`: `npx playwright test e2e/long-form-repurpose.spec.ts`

Expected: PASS；页面只有对话入口，视频库不会绕过需求确认。

### Task 6: 同步权威文档与最终验证

**Files:**
- Modify: `docs/MULTIMIX_WORKSPACE_DESIGN.md`
- Modify: `docs/API.md`
- Modify: `app/assets/__tests__/product-positioning-copy-contract.test.ts`
- Modify: `app/assets/__tests__/agent-ui-copy.test.ts`
- Modify: `e2e/product-positioning.spec.ts`
- Modify: `docs/plans/active/2026-08-31-long-form-composer-entry.md`
- Modify: `docs/plans/active/2026-08-31-long-form-composer-entry-implementation.md`

**Interfaces:**
- Documents: 单一输入框、视频专用上传、URL 导入和分析启动门禁
- Verifies: 当前 active plan 与代码一致

- [x] **Step 1: 先更新文档契约测试**

```ts
expect(workspaceDesign).toContain("长视频文件和受支持的视频链接从对话输入框加入");
expect(workspaceDesign).toContain("只有用户明确提交处理需求后才启动长内容分析");
expect(conversationStart).not.toContain("视频请先上传到视频素材库");
```

- [x] **Step 2: 运行文档契约测试确认旧文档失败**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/product-positioning-copy-contract.test.ts app/assets/__tests__/agent-ui-copy.test.ts`

Expected: FAIL，权威文档仍声明对话不接收视频。

- [x] **Step 3: 更新工作台设计、API 和计划状态**

文档必须明确：入口统一但上传实现不强行统一；只上传来源不会创建分析任务；建议只填入输入框；结果数量由质量决定。保留当前文件中的其他在途改动。

- [x] **Step 4: 运行聚焦测试集合**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/chat-attachment-policy.test.ts app/assets/__tests__/chat-video-attachment-rejection.test.tsx app/assets/__tests__/chat-attachment-upload-state.test.ts app/assets/__tests__/long-form-composer-source.test.ts app/assets/__tests__/long-form-composer-prompt.test.tsx app/assets/__tests__/long-form-library-entry.test.tsx app/assets/__tests__/long-form-candidate-set.test.tsx app/assets/__tests__/composer-ime-submit.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx app/assets/__tests__/product-positioning-copy-contract.test.ts app/assets/__tests__/agent-ui-copy.test.ts`

Expected: PASS.

- [x] **Step 5: 运行静态与文档检查**

Run: `npm --prefix MultiMix-Frontend run typecheck`

Run: `npm --prefix MultiMix-Frontend run lint`

Run: `npm --prefix MultiMix-Frontend run docs:check`

Expected: 全部退出码 0；如存在工作区其他在途改动导致的失败，必须区分并报告，不能修改无关测试期望掩盖失败。

- [x] **Step 6: 运行浏览器验收**

使用独立前端端口和现有 Playwright fixture，不连接 Supabase、不启动独立后端、不创建 SQLite：

Run from `MultiMix-Frontend`: `npx playwright test e2e/long-form-repurpose.spec.ts`

验收：独立入口消失；新建 / 已有对话可添加视频；来源就绪后显示需求提示；只上传不分析；提交需求才发送 analyze；页面没有固定数量承诺。

- [x] **Step 7: 阶段复核并释放开发占用**

使用 `begin` 返回的本任务 token 运行 `npm --prefix MultiMix-Frontend run work:guard -- check --token $multimixLongFormWorkToken`。

完成所有验收后把本计划 checkbox 和验证结果更新为真实状态，再运行：

Run: `npm --prefix MultiMix-Frontend run work:guard -- end --token $multimixLongFormWorkToken`

Expected: 占用释放成功；不自动提交或推送代码。

---

## Verification Results

- TDD：附件策略、来源准备、需求提示、空需求门禁、候选文案与文档契约均先观察到预期失败，再完成最小实现并转绿。
- `npm test`：103 个测试文件、771 项测试全部通过。
- `npm run typecheck`：通过。
- `npm run lint`：0 error；保留 `lib/__tests__/product-analytics.test.ts` 中 4 个与本任务无关的既有 warning。
- `npm run docs:check`：通过。
- `npx playwright test e2e/long-form-repurpose.spec.ts`：2 项通过；确认独立入口消失、视频库动作只加入对话、明确提交需求后才发送 analyze。
- 用户可见文案扫描：生产 UI、默认指令和 E2E fixture 不包含 `Top 5` 或固定候选数量承诺。
- 浏览器测试使用独立 3219 端口；进程已结束，未启动后端、未创建 SQLite、未连接 Supabase 数据库。
- `e2e/product-positioning.spec.ts` 已同步新入口文案，但其完整套件依赖独立认证 / 后端环境，本轮未单独运行；对应静态文案契约已由 Vitest 覆盖。
