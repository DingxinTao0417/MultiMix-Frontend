# 对话视频附件临时禁用实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-30

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan
> task-by-task. 本工作区未经用户明确批准禁止 Subagent；用户未要求提交代码，因此所有 commit
> 步骤均省略，只报告未提交改动。

**Goal:** 让两个聊天输入态明确只支持图片和文档；视频与未知格式不进入上传回调，并向用户显示
统一拒绝原因，同时保留视频素材库和后端视频上传能力。

**Architecture:** 新增一个无 React 依赖的聊天附件策略模块，集中维护 accept、文件分组和拒绝文案。
`ConversationStart` 与 `ConversationStudio` 只消费策略结果，并复用各自已有的 composer error 区域。
全局文件分类、上传适配器、素材库和后端不改。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest、Testing Library。

## Global Constraints

- 聊天视频拒绝文案逐字为：`对话暂不支持视频附件，请先上传到视频素材库。`
- 未知格式拒绝文案逐字为：`暂不支持该附件格式。`
- 聊天图片 accept 逐字为：`image/png,image/jpeg,image/webp`。
- 聊天文档 accept 保持：`.pdf,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm`。
- MP4/MOV/WebM/MKV 通过 MIME 或扩展名均判为视频。
- 混合文件中图片/文档继续上传，视频和未知格式被拒绝并提示。
- `chatAttachmentFileKind(video)`、视频素材库 accept、上传适配器和后端保持不变。
- 不启动后端、不创建 SQLite、不调用真实 Provider、不修改受保护播放器样式。
- 实施必须走 TDD：每个新行为先运行并观察预期失败，再写最小实现。

---

### Task 1: 建立聊天附件共享策略

**Files:**

- Create: `MultiMix-Frontend/app/assets/lib/chat-attachment-policy.ts`
- Create: `MultiMix-Frontend/app/assets/__tests__/chat-attachment-policy.test.ts`

**Interfaces:**

- Produces:
  - `CHAT_IMAGE_UPLOAD_ACCEPT: "image/png,image/jpeg,image/webp"`
  - `CHAT_SOURCE_UPLOAD_ACCEPT: ".pdf,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm"`
  - `partitionChatAttachmentFiles(files: FileList | File[]): ChatAttachmentPartition`
  - `chatAttachmentRejectionMessage(partition: ChatAttachmentPartition): string | null`
- `ChatAttachmentPartition` contains `acceptedFiles`, `rejectedVideoCount` and
  `rejectedUnsupportedCount`.

- [x] **Step 1: Write the failing policy tests**

```ts
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import {
  CHAT_IMAGE_UPLOAD_ACCEPT,
  CHAT_SOURCE_UPLOAD_ACCEPT,
  chatAttachmentRejectionMessage,
  partitionChatAttachmentFiles,
} from "../lib/chat-attachment-policy";

const file = (name: string, type: string) => new File(["content"], name, { type });

describe("chat attachment policy", () => {
  it("accepts images and supported documents", () => {
    const image = file("cover.png", "image/png");
    const pdf = file("brief.pdf", "application/pdf");

    expect(partitionChatAttachmentFiles([image, pdf])).toEqual({
      acceptedFiles: [image, pdf],
      rejectedVideoCount: 0,
      rejectedUnsupportedCount: 0,
    });
    expect(CHAT_IMAGE_UPLOAD_ACCEPT).toBe("image/png,image/jpeg,image/webp");
    expect(CHAT_SOURCE_UPLOAD_ACCEPT).toBe(
      ".pdf,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm",
    );
  });

  it.each([
    ["clip.mp4", "video/mp4"],
    ["clip.pdf", "video/mp4"],
    ["clip.mov", ""],
    ["clip.webm", "application/octet-stream"],
    ["clip.mkv", ""],
  ])("rejects chat video %s", (name, type) => {
    const partition = partitionChatAttachmentFiles([file(name, type)]);

    expect(partition.acceptedFiles).toEqual([]);
    expect(partition.rejectedVideoCount).toBe(1);
    expect(chatAttachmentRejectionMessage(partition)).toBe(
      "对话暂不支持视频附件，请先上传到视频素材库。",
    );
  });

  it("keeps supported files from a mixed selection and reports every rejected class", () => {
    const image = file("cover.png", "image/png");
    const partition = partitionChatAttachmentFiles([
      image,
      file("clip.mp4", "video/mp4"),
      file("archive.zip", "application/zip"),
    ]);

    expect(partition.acceptedFiles).toEqual([image]);
    expect(chatAttachmentRejectionMessage(partition)).toBe(
      "对话暂不支持视频附件，请先上传到视频素材库。 暂不支持该附件格式。",
    );
  });
});
```

- [x] **Step 2: Run the policy test and verify RED**

Run:

```powershell
npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/chat-attachment-policy.test.ts
```

Expected: FAIL because `../lib/chat-attachment-policy` does not exist.

- [x] **Step 3: Implement the smallest policy module**

```ts
export const CHAT_IMAGE_UPLOAD_ACCEPT = "image/png,image/jpeg,image/webp";
export const CHAT_SOURCE_UPLOAD_ACCEPT = ".pdf,.txt,.md,.markdown,.html,.htm,.xlsx,.xlsm";

const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|webm|mkv)$/i;
const SOURCE_EXTENSION_PATTERN = /\.(pdf|txt|md|markdown|html|htm|xlsx|xlsm)$/i;

export type ChatAttachmentPartition = {
  acceptedFiles: File[];
  rejectedVideoCount: number;
  rejectedUnsupportedCount: number;
};

export function partitionChatAttachmentFiles(
  files: FileList | File[],
): ChatAttachmentPartition {
  const partition: ChatAttachmentPartition = {
    acceptedFiles: [],
    rejectedVideoCount: 0,
    rejectedUnsupportedCount: 0,
  };
  for (const file of Array.from(files)) {
    if (file.type.startsWith("video/") || VIDEO_EXTENSION_PATTERN.test(file.name)) {
      partition.rejectedVideoCount += 1;
    } else if (file.type.startsWith("image/") || SOURCE_EXTENSION_PATTERN.test(file.name)) {
      partition.acceptedFiles.push(file);
    } else {
      partition.rejectedUnsupportedCount += 1;
    }
  }
  return partition;
}

export function chatAttachmentRejectionMessage(
  partition: ChatAttachmentPartition,
): string | null {
  const messages: string[] = [];
  if (partition.rejectedVideoCount > 0) {
    messages.push("对话暂不支持视频附件，请先上传到视频素材库。");
  }
  if (partition.rejectedUnsupportedCount > 0) {
    messages.push("暂不支持该附件格式。");
  }
  return messages.length ? messages.join(" ") : null;
}
```

- [x] **Step 4: Run the policy test and verify GREEN**

Run the Step 2 command again.

Expected: PASS with 0 failed tests.

---

### Task 2: 接入两个聊天输入态并固定真实行为

**Files:**

- Create: `MultiMix-Frontend/app/assets/__tests__/chat-video-attachment-rejection.test.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/conversation-start.tsx:3-14,65-139,222-258`
- Modify: `MultiMix-Frontend/app/assets/components/conversation-studio.tsx:1-62,246,490-512,786-821`

**Interfaces:**

- Consumes Task 1 的四个导出。
- Produces 两个组件一致的行为：
  - 支持文件传给 `onUploadImages`；
  - 视频/未知格式不传给回调；
  - composer error 区显示共享拒绝文案；
  - 媒体按钮只描述图片。

- [x] **Step 1: Write failing component behavior tests**

```tsx
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import ConversationStart from "../components/conversation-start";
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

function conversation() {
  return {
    ...assetWorkspaceAdapter.getNewConversation(),
    id: "conversation-1",
    detailsLoaded: true,
    readonly: false,
  };
}

const video = () => new File(["video"], "clip.mp4", { type: "video/mp4" });
const image = () => new File(["image"], "cover.png", { type: "image/png" });

describe("chat video attachment rejection", () => {
  it("rejects video in a new conversation while uploading the supported image", () => {
    const onUploadImages = vi.fn();
    render(
      <ConversationStart
        suggestions={[]}
        conversation={conversation()}
        onSend={vi.fn().mockResolvedValue(undefined)}
        onUploadImages={onUploadImages}
      />,
    );

    const imageFile = image();
    fireEvent.drop(screen.getByLabelText("新建对话"), {
      dataTransfer: { files: [video(), imageFile] },
    });

    expect(onUploadImages).toHaveBeenCalledWith([imageFile]);
    expect(screen.getByText(
      "对话暂不支持视频附件，请先上传到视频素材库。",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeInTheDocument();
  });

  it("rejects video in an existing conversation while uploading the supported image", () => {
    const onUploadImages = vi.fn();
    render(
      <ConversationStudio
        selectedConversation={conversation()}
        selectedProduct={null}
        onSelectProduct={vi.fn()}
        onUploadImages={onUploadImages}
        readonly={false}
      />,
    );

    const imageFile = image();
    fireEvent.drop(screen.getByLabelText("Content generation conversation"), {
      dataTransfer: { files: [video(), imageFile] },
    });

    expect(onUploadImages).toHaveBeenCalledWith([imageFile]);
    expect(screen.getByText(
      "对话暂不支持视频附件，请先上传到视频素材库。",
    )).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上传图片素材" })).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run the component test and verify RED**

Run:

```powershell
npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/chat-video-attachment-rejection.test.tsx
```

Expected: FAIL because the buttons still say “上传图片或视频素材” and no video rejection message is rendered.

- [x] **Step 3: Wire the shared policy into `ConversationStart`**

Replace the local accept constants with:

```ts
import {
  CHAT_IMAGE_UPLOAD_ACCEPT,
  CHAT_SOURCE_UPLOAD_ACCEPT,
  chatAttachmentRejectionMessage,
  partitionChatAttachmentFiles,
} from "../lib/chat-attachment-policy";
```

Replace `handleAttachmentFiles` with:

```ts
const handleAttachmentFiles = (files: FileList | File[]) => {
  const partition = partitionChatAttachmentFiles(files);
  setError(chatAttachmentRejectionMessage(partition));
  if (partition.acceptedFiles.length) {
    onUploadImages?.(partition.acceptedFiles);
  }
};
```

Set the image input to `accept={CHAT_IMAGE_UPLOAD_ACCEPT}`, the source input to
`accept={CHAT_SOURCE_UPLOAD_ACCEPT}`, and change both media button attributes to:

```tsx
aria-label="上传图片素材"
title="上传图片素材"
```

- [x] **Step 4: Wire the same policy into `ConversationStudio`**

Import the same four symbols, replace `handleAttachmentFiles` with:

```ts
const handleAttachmentFiles = (files: FileList | File[]) => {
  const partition = partitionChatAttachmentFiles(files);
  setSendError(chatAttachmentRejectionMessage(partition));
  if (partition.acceptedFiles.length) {
    onUploadImages?.(partition.acceptedFiles);
  }
};
```

Use the same two accept constants and the same “上传图片素材” button attributes.

- [x] **Step 5: Run Task 1 and Task 2 tests and verify GREEN**

Run:

```powershell
npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/chat-attachment-policy.test.ts app/assets/__tests__/chat-video-attachment-rejection.test.tsx
```

Expected: both files PASS with 0 failed tests.

---

### Task 3: 更新结构契约和旧 active 计划

**Files:**

- Modify: `MultiMix-Frontend/app/assets/__tests__/agent-ui-copy.test.ts:1420-1436`
- Modify: `docs/plans/active/2026-07-21-chat-attachment-upload-progress.md`
- Modify: `docs/plans/active/2026-07-30-chat-video-attachment-temporary-disable-design.md`

**Interfaces:**

- 结构契约证明两个组件都消费共享策略，且不再自行声明视频 accept。
- 旧计划保留历史实施证据，但当前产品决定明确指向 2026-07-30 设计。

- [x] **Step 1: Change the source-contract expectations before implementation verification**

在 `agent-ui-copy.test.ts` 对两个组件分别断言：

```ts
const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
for (const composer of [conversationStudio, conversationStart]) {
  expect(composer).toContain("CHAT_IMAGE_UPLOAD_ACCEPT");
  expect(composer).toContain("CHAT_SOURCE_UPLOAD_ACCEPT");
  expect(composer).toContain("partitionChatAttachmentFiles");
  expect(composer).toContain('aria-label="上传图片素材"');
  expect(composer).not.toContain(".mp4,.mov,.webm,.mkv");
  expect(composer).not.toContain("上传图片或视频素材");
}
expect(workspaceClient).toContain(
  'if (view === "video") return ".mp4,.mov,.webm,.mkv"',
);
```

删除旧的两条 `.mp4,.mov,.webm,.mkv` 正向断言，保留进度条、文档和卡片状态断言。

- [x] **Step 2: Run the contract test**

Run:

```powershell
npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/agent-ui-copy.test.ts
```

Expected: PASS；若失败，只修接线或契约，不改已确认的产品范围。

- [x] **Step 3: Reconcile the old active plan**

在旧计划 header 后加入：

```md
> **Current product decision (2026-07-30):** 对话输入框暂不支持视频附件。
> 本文中“开放聊天视频选择”和视频浏览器冒烟属于历史实施目标，已被
> `docs/plans/active/2026-07-30-chat-video-attachment-temporary-disable-design.md`
> 取代；视频素材库和底层上传能力继续保留。
```

将“当前回归待办”替换为以下当前口径：

```md
## 当前收口（2026-07-30）

- [ ] 两个聊天媒体选择器不再声明视频格式或视频文案。
- [ ] 视频通过拖放或构造文件进入时被明确拒绝，不调用聊天上传回调。
- [ ] 图片和文档继续上传，混合文件不因视频而整体失败。
- [ ] 视频素材库和 `chatAttachmentFileKind(video)` 保持不变。
```

将完成标准第一条改为：

```md
- [ ] 图片和文档能在两个对话输入态完成选择和上传；聊天视频被明确拒绝并指向视频素材库。
```

完成实施后勾选上述当前条目；不要改写 2026-07-21 的历史执行结果。

- [x] **Step 4: Update the approved design with actual implementation notes**

在设计文档末尾新增“实施结果”，记录实际文件、测试数量、未执行的浏览器验证和任何设计偏差；
无偏差时明确写“实现与批准设计一致”。

---

### Task 4: 完整回归与收尾

**Files:**

- Modify: `docs/plans/active/2026-07-30-chat-video-attachment-temporary-disable-implementation.md`
  （勾选实际完成项并记录结果）

- [x] **Step 1: Run focused attachment regression**

```powershell
npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/chat-attachment-policy.test.ts app/assets/__tests__/chat-video-attachment-rejection.test.tsx app/assets/__tests__/chat-attachment-upload-state.test.ts app/assets/__tests__/attachment-send-guard.test.ts app/assets/__tests__/agent-ui-copy.test.ts
```

Expected: all focused files PASS with 0 failed tests.

- [x] **Step 2: Run static and full frontend verification**

```powershell
npm --prefix MultiMix-Frontend run typecheck
npm --prefix MultiMix-Frontend exec eslint app/assets/lib/chat-attachment-policy.ts app/assets/components/conversation-start.tsx app/assets/components/conversation-studio.tsx app/assets/__tests__/chat-attachment-policy.test.ts app/assets/__tests__/chat-video-attachment-rejection.test.tsx app/assets/__tests__/agent-ui-copy.test.ts
npm --prefix MultiMix-Frontend run test
npm --prefix MultiMix-Frontend run check:agents
```

Expected: every command exits 0; ESLint has 0 errors.

- [x] **Step 3: Verify isolation and late changes**

```powershell
git diff --check
git -C MultiMix-Frontend diff --check
git -C MultiMix-Backend diff --check
npm --prefix MultiMix-Frontend run work:guard -- check --token <runtime-token>
```

Expected: all commands exit 0；后端无本任务改动，`next-env.d.ts` 的既有 SHA-256 保持
`F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0`。

**执行结果（2026-07-30）：**

- 聚焦附件回归 5 个文件 / 77 个测试通过；全量前端 64 个文件 / 449 个测试通过。
- 最终并行验证曾有 `library-workshop-performance.test.tsx` 的详情弹窗等待超时；未改代码或测试，
  随即单独复跑该文件 5/5 通过，再独立复跑全量 449/449 通过，判定为并行负载下的瞬时超时。
- `typecheck`、定向 ESLint、`check:agents`、`docs:check` 和视频预览契约检查退出码均为 0。
- 根文档、前端与 detached 后端 worktree 的 `git diff --check` 均通过；后端 worktree 无改动。
- 原工作区 `next-env.d.ts` 的 SHA-256 仍为
  `F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0`，未被本任务触碰。
- 未运行登录态浏览器验证；未启动后端、未创建 SQLite、未调用真实 Provider。

- [x] **Step 4: Archive only the completed 2026-07-30 documents**

实现和验证全部完成后，将本实施计划和对应设计移到 `docs/archive/plans/`，header 改为
`Status: archived`。旧的 2026-07-21 上传进度计划继续 active，直到其保留的图片/文档浏览器
验证完成或另有产品决定。

- [x] **Step 5: Release the work claim and report**

释放本任务 claim，确认 registry/lock 不存在。最终回复必须说明用户可见变化、测试证据、
后端未改、未运行的浏览器验证、晚到外部文件和未提交状态。

**释放结果（2026-07-30）：** task `chat-video-attachment-disable` 已释放，状态查询返回空列表，
运行时 registry 与 lock 文件均不存在。
