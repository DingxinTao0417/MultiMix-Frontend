# MultiMix 对话加载与回复动效实施计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-12

> **For agentic workers:** REQUIRED SUB-SKILL: use executing-plans task-by-task. The workspace forbids Subagent execution unless the user explicitly approves this exact scope.

**Goal:** 将历史对话读取改为延迟出现的中性消息骨架，将普通助手等待改为原位的“正在整理内容”占位，并移除现有上下弹跳圆点。

**Architecture:** 新建一个短时等待反馈组件，集中管理 500ms 延迟、历史消息骨架和助手等待占位。conversation-studio.tsx 只选择真实状态对应的反馈；已有真实步骤时继续由 AgentRunTimeline 独占。样式在现有 shadcn-prototype 命名空间内定点修改，不改变消息模型、请求流程或后端接口。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest 4、Testing Library、现有全局 CSS。

## Global Constraints

- 不启动 Subagent；改变执行方式必须重新取得用户明确批准。
- 不修改 MultiMix-Backend、对话状态机、API 契约、视频执行时间线或数据库。
- 历史读取使用中性灰，不使用 AI 渐变。
- 没有真实阶段事件时固定显示“正在整理内容”，不得轮播伪阶段。
- 等待反馈延迟 500ms 出现；动画周期 1.6 秒，透明度 0.35–0.75，位移不超过 1px。
- prefers-reduced-motion: reduce 下不得持续播放循环动画。
- app/globals.css 当前已有用户未提交改动。只能使用定点补丁，修改前后必须检查 diff，禁止覆盖或暂存无关内容。
- 未经用户明确要求不创建 Git commit；每个任务以测试检查点代替提交检查点。
- 不启动 E2E 后端，不创建 SQLite。若后续增加浏览器 E2E，必须先告知临时库路径、端口和清理策略。

## File Map

- Create: MultiMix-Frontend/app/assets/components/conversation-waiting-state.tsx — 延迟 hook、历史骨架、助手占位。
- Create: MultiMix-Frontend/app/assets/__tests__/conversation-waiting-state.test.tsx — 延迟、清理、互斥和样式契约。
- Modify: MultiMix-Frontend/app/assets/components/conversation-studio.tsx — 接入真实状态。
- Modify: MultiMix-Frontend/app/assets/__tests__/conversation-detail-loading.test.tsx — 更新加载与失败预期。
- Modify: MultiMix-Frontend/app/globals.css — 新动效、骨架和 reduced-motion。
- Reference: docs/specs/ui/conversation-loading-and-reply-motion.md。

---

### Task 1: 建立独立等待状态组件

**Files:**

- Create: MultiMix-Frontend/app/assets/components/conversation-waiting-state.tsx
- Create: MultiMix-Frontend/app/assets/__tests__/conversation-waiting-state.test.tsx

**Interfaces:**

- Produces: WAITING_STATE_DELAY_MS = 500
- Produces: useDelayedWaitingVisibility(delayMs?: number): boolean
- Produces: ConversationDetailSkeleton({ delayMs? }): JSX.Element | null
- Produces: AssistantReplyPending({ delayMs? }): JSX.Element | null

**Reproduction case:** 当前历史读取立即显示成助手 pending；普通 pending 是空文本加三个跳点，快速请求会闪烁。

- [x] **Step 1: 写失败测试**

~~~tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AssistantReplyPending,
  ConversationDetailSkeleton,
} from "../components/conversation-waiting-state";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("conversation waiting states", () => {
  it("delays the history skeleton so fast loads do not flash", () => {
    const { container } = render(<ConversationDetailSkeleton />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(499));
    expect(screen.queryByText("载入对话…")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("载入对话…");
    expect(container.querySelectorAll(".shadcn-prototype-conversation-skeleton-row")).toHaveLength(3);
  });

  it("shows one readable assistant status after the delay", () => {
    render(<AssistantReplyPending />);
    act(() => vi.advanceTimersByTime(500));
    expect(screen.getByRole("status")).toHaveTextContent("正在整理内容");
    expect(screen.getByRole("status")).not.toHaveTextContent("理解需求");
  });

  it("cancels the timer when pending unmounts", () => {
    const { unmount } = render(<AssistantReplyPending />);
    unmount();
    expect(() => act(() => vi.advanceTimersByTime(500))).not.toThrow();
  });
});
~~~

- [x] **Step 2: 运行测试确认失败**

Run:

~~~powershell
npm test -- app/assets/__tests__/conversation-waiting-state.test.tsx
~~~

Expected: FAIL，无法解析 conversation-waiting-state。

- [x] **Step 3: 实现最小组件**

~~~tsx
"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

export const WAITING_STATE_DELAY_MS = 500;

export function useDelayedWaitingVisibility(delayMs = WAITING_STATE_DELAY_MS): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  return visible;
}

export function ConversationDetailSkeleton({ delayMs = WAITING_STATE_DELAY_MS }: { delayMs?: number }) {
  const visible = useDelayedWaitingVisibility(delayMs);
  if (!visible) return null;

  return (
    <div className="shadcn-prototype-conversation-skeleton" role="status" aria-live="polite">
      <span className="shadcn-prototype-conversation-skeleton-label">载入对话…</span>
      <div className="shadcn-prototype-conversation-skeleton-list" aria-hidden="true">
        <span className="shadcn-prototype-conversation-skeleton-row assistant"><i /><i /></span>
        <span className="shadcn-prototype-conversation-skeleton-row user"><i /><i /></span>
        <span className="shadcn-prototype-conversation-skeleton-row assistant short"><i /><i /></span>
      </div>
    </div>
  );
}

export function AssistantReplyPending({ delayMs = WAITING_STATE_DELAY_MS }: { delayMs?: number }) {
  const visible = useDelayedWaitingVisibility(delayMs);
  if (!visible) return null;

  return (
    <span className="shadcn-prototype-assistant-waiting" role="status" aria-live="polite">
      <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
      正在整理内容
      <span className="shadcn-prototype-assistant-waiting-dots" aria-hidden="true">
        <i /><i /><i />
      </span>
    </span>
  );
}
~~~

- [x] **Step 4: 运行组件测试**

Run:

~~~powershell
npm test -- app/assets/__tests__/conversation-waiting-state.test.tsx
~~~

Expected: 3 tests PASS，无 act 警告。

- [x] **Step 5: 检查任务边界**

Run:

~~~powershell
git status --short
git diff -- app/assets/components/conversation-waiting-state.tsx app/assets/__tests__/conversation-waiting-state.test.tsx
~~~

Expected: 只新增上述两个文件，不暂存其他改动。

**Validation cases:**

- [x] 499ms 内不显示状态。
- [x] 500ms 后历史骨架包含三组轮廓和唯一可读文案“载入对话…”。
- [x] 助手占位只宣告“正在整理内容”。
- [x] 提前卸载会清理 timer。

---

### Task 2: 接入历史加载、普通 pending 和真实执行卡

**Files:**

- Modify: MultiMix-Frontend/app/assets/components/conversation-studio.tsx:3-14, 468-510
- Modify: MultiMix-Frontend/app/assets/__tests__/conversation-detail-loading.test.tsx
- Extend: MultiMix-Frontend/app/assets/__tests__/conversation-waiting-state.test.tsx

**Interfaces:**

- Consumes Task 1 的 ConversationDetailSkeleton 和 AssistantReplyPending。
- Consumes 已有 ownsWorkflowCard。
- Preserves AgentRunTimeline、detailLoadError、onRetryDetail、shouldRenderMessageBody。

**Reproduction case:** detailsLoaded === false 被渲染成助手消息；message.pending 无条件附加旧跳点，不能清楚区分真实时间线。

- [x] **Step 1: 把详情加载测试改成延迟骨架**

在现有测试中加入 act、beforeEach 和 fake timers。第一条测试必须断言：

~~~tsx
expect(screen.queryByRole("status")).not.toBeInTheDocument();
act(() => vi.advanceTimersByTime(500));
expect(screen.getByRole("status")).toHaveTextContent("载入对话…");
expect(container.querySelector("article.assistant.pending")).not.toBeInTheDocument();
expect(container.querySelectorAll(".shadcn-prototype-conversation-skeleton-row")).toHaveLength(3);
~~~

失败测试继续断言错误立即出现，并补充：

~~~tsx
expect(screen.queryByText("载入对话…")).not.toBeInTheDocument();
~~~

- [x] **Step 2: 增加普通 pending 与时间线互斥测试**

在测试中加入以下完整 fixture 和用例：

~~~tsx
import ConversationStudio from "../components/conversation-studio";
import { assetWorkspaceAdapter } from "../lib/asset-workspace-adapter";

const readyConversation = {
  ...assetWorkspaceAdapter.getNewConversation(),
  detailsLoaded: true,
  messages: [{ role: "assistant" as const, text: "上一条回复" }],
};

it("shows the assistant placeholder for an ordinary empty pending message", () => {
  render(
    <ConversationStudio
      basePath="/app/assets"
      selectedConversation={readyConversation}
      selectedProduct={null}
      onSelectProduct={vi.fn()}
      pendingExchange={{
        id: "pending-1",
        userText: "改短一点",
        assistantText: "",
        status: "pending",
      }}
    />,
  );
  act(() => vi.advanceTimersByTime(500));
  expect(screen.getByRole("status")).toHaveTextContent("正在整理内容");
});

it("lets a real execution timeline own the pending state", () => {
  render(
    <ConversationStudio
      basePath="/app/assets"
      selectedConversation={readyConversation}
      selectedProduct={null}
      onSelectProduct={vi.fn()}
      pendingExchange={{
        id: "pending-2",
        userText: "确认生成视频工程",
        assistantText: "已确认，正在创建视频工程任务。",
        status: "pending",
        presentation: "execution_anchor",
        runSteps: [{ key: "create_job", label: "创建视频工程任务", status: "run" }],
      }}
    />,
  );
  act(() => vi.advanceTimersByTime(500));
  expect(screen.queryByText("正在整理内容")).not.toBeInTheDocument();
  expect(screen.getByText("创建视频工程任务")).toBeInTheDocument();
});
~~~

- [x] **Step 3: 运行集成测试确认旧实现失败**

Run:

~~~powershell
npm test -- app/assets/__tests__/conversation-detail-loading.test.tsx app/assets/__tests__/conversation-waiting-state.test.tsx
~~~

Expected: FAIL；旧实现仍显示“正在加载对话内容”和 typing dots。

- [x] **Step 4: 定点接入新组件**

增加：

~~~tsx
import {
  AssistantReplyPending,
  ConversationDetailSkeleton,
} from "./conversation-waiting-state";
~~~

将 lines 469–483 的加载分支替换为下面的精确 diff；后面的 `visibleConversationMessages.map` 回调保持原位置：

~~~diff
 {selectedConversation.detailsLoaded === false ? (
-  <div className="shadcn-prototype-message-group" role={detailLoadError ? "alert" : "status"}>
-    <article className={detailLoadError ? "assistant" : "assistant pending"}>
-      {detailLoadError ? (
+  detailLoadError ? (
+    <div className="shadcn-prototype-message-group" role="alert">
+      <article className="assistant">
         <p>
           对话内容加载失败。
           <button type="button" onClick={onRetryDetail}>重试加载</button>
         </p>
-      ) : (
-        <p>
-          正在加载对话内容
-          <span className="shadcn-prototype-typing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
-        </p>
-      )}
-    </article>
-  </div>
+      </article>
+    </div>
+  ) : <ConversationDetailSkeleton />
 ) : visibleConversationMessages.map((message, index) => {
~~~

在 ownsWorkflowCard 后增加：

~~~tsx
const showsAssistantWaiting = message.role === "assistant"
  && message.pending === true
  && !ownsWorkflowCard
  && !message.text.trim();
~~~

正文分支改为：

~~~tsx
{showsAssistantWaiting ? (
  <AssistantReplyPending />
) : shouldRenderMessageBody(message) ? (
  <p>{message.text}</p>
) : null}
~~~

不得改变确认卡、时间线、建议按钮、产物卡或发送流程。

- [x] **Step 5: 运行聚焦回归**

Run:

~~~powershell
npm test -- app/assets/__tests__/conversation-detail-loading.test.tsx app/assets/__tests__/conversation-waiting-state.test.tsx app/assets/__tests__/conversation-execution-presentation.test.ts
~~~

Expected: 全部 PASS；execution anchor 仍只显示真实时间线。

- [x] **Step 6: 检查 diff**

Run:

~~~powershell
git diff -- app/assets/components/conversation-studio.tsx app/assets/__tests__/conversation-detail-loading.test.tsx app/assets/__tests__/conversation-waiting-state.test.tsx
~~~

Expected: 不包含发送、确认或消息模型的无关修改。

**Validation cases:**

- [x] 历史详情读取不再伪装成助手回复。
- [x] 失败立即显示错误和“重试加载”。
- [x] 普通空 pending 超过 500ms 后显示“正在整理内容”。
- [x] 真实执行卡存在时不重复显示占位。
- [x] pending 已携带正文时直接显示正文，不附加旧跳点。

---

### Task 3: 落地低幅度动效与 reduced-motion

**Files:**

- Modify: MultiMix-Frontend/app/globals.css:2010-2072, 8438-8446
- Extend: MultiMix-Frontend/app/assets/__tests__/conversation-waiting-state.test.tsx

**Interfaces:**

- Consumes Task 1 的 CSS class。
- Removes .shadcn-prototype-typing-dots 和 @keyframes shadcn-prototype-typing。
- Produces @keyframes shadcn-prototype-waiting-breathe。

**Reproduction case:** 旧动画以 1.2 秒执行 translateY(-2px)，历史读取错误使用 AI 渐变。

- [x] **Step 1: 增加样式契约失败测试**

~~~tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";

it("uses restrained waiting motion and removes bouncing dots", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  expect(css).toContain(".shadcn-prototype-conversation-skeleton");
  expect(css).toContain(".shadcn-prototype-assistant-waiting");
  expect(css).toContain("@keyframes shadcn-prototype-waiting-breathe");
  expect(css).toContain("animation: shadcn-prototype-waiting-breathe 1.6s");
  expect(css).not.toContain("translateY(-2px)");
  expect(css).not.toContain(".shadcn-prototype-typing-dots");
});
~~~

- [x] **Step 2: 运行样式测试确认失败**

Run:

~~~powershell
npm test -- app/assets/__tests__/conversation-waiting-state.test.tsx
~~~

Expected: FAIL；新样式不存在，旧跳点仍存在。

- [x] **Step 3: 用定点补丁替换旧样式**

删除 typing-dots 和旧 keyframes，新增下列规则：

~~~css
.shadcn-prototype-conversation-skeleton {
  display: grid;
  width: min(560px, 92%);
  gap: 12px;
}

.shadcn-prototype-conversation-skeleton-label {
  color: #8a857d;
  font-size: 12px;
  font-weight: 600;
}

.shadcn-prototype-conversation-skeleton-list {
  display: grid;
  gap: 14px;
}

.shadcn-prototype-conversation-skeleton-row {
  display: grid;
  width: 72%;
  gap: 7px;
}

.shadcn-prototype-conversation-skeleton-row.user {
  justify-self: end;
  width: 58%;
}

.shadcn-prototype-conversation-skeleton-row.short { width: 48%; }

.shadcn-prototype-conversation-skeleton-row i {
  display: block;
  height: 10px;
  border-radius: 999px;
  background: #e9e6e0;
  animation: shadcn-prototype-waiting-breathe 1.6s ease-in-out infinite;
}

.shadcn-prototype-conversation-skeleton-row i:last-child { width: 68%; }

.shadcn-prototype-thread .assistant .shadcn-prototype-assistant-waiting {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: #6e6a64;
  font-size: 13px;
  font-weight: 600;
}

.shadcn-prototype-thread .assistant .shadcn-prototype-assistant-waiting > svg {
  color: var(--sp-ai-a, #7c5cff);
  animation: shadcn-prototype-waiting-breathe 1.6s ease-in-out infinite;
}

.shadcn-prototype-thread .assistant .shadcn-prototype-assistant-waiting-dots {
  display: inline-flex;
  gap: 3px;
}

.shadcn-prototype-thread .assistant .shadcn-prototype-assistant-waiting-dots i {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.35;
  animation: shadcn-prototype-waiting-breathe 1.6s ease-in-out infinite;
}

.shadcn-prototype-thread .assistant .shadcn-prototype-assistant-waiting-dots i:nth-child(2) { animation-delay: 160ms; }
.shadcn-prototype-thread .assistant .shadcn-prototype-assistant-waiting-dots i:nth-child(3) { animation-delay: 320ms; }

@keyframes shadcn-prototype-waiting-breathe {
  0%, 100% { opacity: 0.35; transform: translateY(0); }
  50% { opacity: 0.75; transform: translateY(-1px); }
}
~~~

在现有 reduced-motion media query 内增加：

~~~css
.shadcn-prototype-conversation-skeleton-row i,
.shadcn-prototype-assistant-waiting > svg,
.shadcn-prototype-assistant-waiting-dots i {
  animation: none !important;
  opacity: 0.55;
  transform: none;
}
~~~

- [x] **Step 4: 确认 globals.css 只含目标补丁**

Run:

~~~powershell
git diff -- app/globals.css
~~~

Expected: 能清楚区分本任务样式与进入任务前已有的用户改动；如目标区发生重叠，停止并先向用户说明。

- [x] **Step 5: 运行样式与组件测试**

Run:

~~~powershell
npm test -- app/assets/__tests__/conversation-waiting-state.test.tsx app/assets/__tests__/conversation-detail-loading.test.tsx
~~~

Expected: 全部 PASS；不再存在 typing dots 或 translateY(-2px)。

**Validation cases:**

- [x] 历史骨架全部为中性灰。
- [x] 助手等待透明度为 0.35–0.75，最大位移 1px。
- [x] 周期 1.6 秒。
- [x] reduced-motion 下保持静态且可理解。

---

### Task 4: 完整回归和文档收口

**Files:**

- Verify: Task 1–3 的五个前端文件。
- Move after completion: 本计划从 docs/plans/active/ 移到 docs/archive/plans/。

- [x] **Step 1: 运行聚焦测试**

~~~powershell
npm test -- app/assets/__tests__/conversation-waiting-state.test.tsx app/assets/__tests__/conversation-detail-loading.test.tsx app/assets/__tests__/conversation-execution-presentation.test.ts
~~~

Expected: 全部 PASS。

- [ ] **Step 2: 运行完整测试**

~~~powershell
npm test
~~~

Expected: Vitest 退出码 0；既有失败必须准确记录，不能冒充通过。

- [x] **Step 3: 运行类型检查与构建**

~~~powershell
npm run typecheck
npm run build
~~~

Expected: 两条命令退出码均为 0。

- [x] **Step 4: 运行文档检查**

~~~powershell
npm run docs:check
~~~

Expected: Docs check passed.

- [x] **Step 5: 做源码验收**

~~~powershell
rg -n "正在加载对话内容|shadcn-prototype-typing-dots|translateY\(-2px\)|正在整理内容|载入对话" app/assets app/globals.css
~~~

Expected: 前三项无命中；后两项只存在于目标组件和测试。

- [x] **Step 6: 检查最终工作区边界**

~~~powershell
git status --short
git diff --check
git diff -- app/assets/components/conversation-waiting-state.tsx app/assets/components/conversation-studio.tsx app/assets/__tests__/conversation-waiting-state.test.tsx app/assets/__tests__/conversation-detail-loading.test.tsx app/globals.css
~~~

Expected: 无空白错误；最终汇报单列本任务文件与进入任务前已存在、未触碰的用户改动。

- [ ] **Step 7: 完成后归档计划并复跑文档检查**

Move:

~~~text
docs/plans/active/2026-07-12-conversation-loading-reply-motion-implementation.md
-> docs/archive/plans/2026-07-12-conversation-loading-reply-motion-implementation.md
~~~

Run:

~~~powershell
npm --prefix MultiMix-Frontend run docs:check
~~~

Expected: Docs check passed；归档文件保留已勾选项和验证结果。

**Final acceptance:**

- [x] 快速历史加载和快速助手回复不闪现动画。
- [x] 慢速历史加载显示中性骨架，不像助手生成。
- [x] 普通助手等待原位显示“正在整理内容”，完成或失败后不残留。
- [x] 真实 Agent 时间线不出现重复 loading。
- [x] reduced-motion 用户看到静态、可理解的状态。

## Verification Notes

- 聚焦回归：3 个测试文件、19 项测试通过。
- 生产构建：通过；仅有项目已有的 `<img>` 优化警告。
- 类型检查：通过。
- 文档检查：`Docs check passed.`。
- 全量测试：218 项通过、1 项失败。剩余失败是并行修改中的 `product-stage-style-contract.test.ts` 仍要求旧的 `previewShowsBrowse` 三元源码结构，而当前视频工作台已改用 `showEditorEmbed` 分支；不涉及本计划文件。
- 因全量测试尚未恢复，本计划保留在 active，不归档。
- [x] 聚焦测试、完整测试、类型检查、构建和 docs 检查均有明确结果。
