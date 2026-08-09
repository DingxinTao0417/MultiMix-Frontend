# 视频确认切换对话恢复实施计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-16

> **For agentic workers:** Use `test-driven-development` and execute this plan inline. Subagents are not authorized for this task.

**Goal:** 用户确认生成视频后可以立即切换其他对话；返回时仍显示已确认方案和同一张执行卡，确认请求不会因为切换对话被取消。

**Architecture:** 保留普通消息“切换对话即取消旧请求”的既有行为，只把带 `client_request_id` 的视频确认标记为可跨对话继续。乐观交换记录确认方案键，保证返回原对话时确认卡仍能与对应执行卡关联；服务端响应或对账结果继续由 `AssetsWorkspaceClient` 按原会话 ID 写回。

**Tech Stack:** Next.js、React、TypeScript、Vitest、Testing Library。

## 背景与根因

- `MultiMix-Frontend/app/assets/components/conversation-studio.tsx:228-240` 在 `selectedConversation.id` 变化时无条件中止当前请求。
- 确认按钮先创建本地执行流程骨架，因此用户会先看到执行卡；切换对话触发 abort 后，本地分支把它改成“已停止生成”。
- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx:1457-1475` 对主动 abort 不执行 `client_request_id` 对账；若服务端已经提交，前端仍保留旧的待确认会话副本。
- 返回已加载过的对话时不会重新拉取详情，导致确认卡回退为待确认，执行卡消失。
- 后端成功路径已经持久化 `plan.status=confirmed`、确认控制消息、工程资产和 `job_public_id`，本次不修改后端。

## 已确认方案与取舍

采用以下组合方案：

1. 仅视频确认请求跨对话继续；普通消息仍保持原有取消语义，避免扩大行为变化。
2. 乐观交换新增确认方案键，用它恢复对应确认卡的“已确认”视觉状态，不用“存在任意执行卡”这种宽松推断。
3. 请求完成后仍由现有持久化响应替换乐观状态；连接失败仍走现有 `client_request_id` 对账。
4. 不新增轮询接口、不修改后端事务、不改变用户主动点击“停止生成”的现有行为。

风险与处理：

- 切换到另一对话后可能同时存在两个发送请求；完成回调只能清理原会话的乐观交换，不能污染当前对话的输入状态。
- 乐观确认必须绑定具体方案键，避免同一对话存在多个方案卡时误标全部已确认。
- 组件卸载或用户主动停止仍可能中止请求；本次只修复“切换对话”这一明确缺陷。

## Task 1：先写切换回归测试

**Files:**

- Create: `MultiMix-Frontend/app/assets/__tests__/conversation-confirmation-switch.test.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/conversation-studio.tsx`
- Modify: `MultiMix-Frontend/app/assets/lib/conversation-execution-presentation.ts`

**Interfaces:**

- `OptimisticExchange.confirmationPlanKey?: string`：将确认点击绑定到唯一方案卡。
- `sendInstruction(..., optimisticFeedback, clientRequestId)`：当乐观反馈是确认执行卡且存在 request ID 时，请求可跨对话继续。

- [x] 写测试：点击确认后切到对话 B，传给 `onSendMessage` 的 `AbortSignal` 仍为未中止。
- [x] 写测试：切回对话 A 时，服务端响应尚未返回也继续显示“已确认”方案卡和执行流程。
- [x] 运行：`npx vitest run app/assets/__tests__/conversation-confirmation-switch.test.tsx`。
- [x] 预期：两个案例因当前无条件 abort、确认方案键未持久化而失败。

测试核心场景：

```tsx
fireEvent.click(screen.getByRole("button", { name: /确认/ }));
fireEvent.click(screen.getByRole("button", { name: "切到对话 B" }));
expect(capturedSignal?.aborted).toBe(false);
fireEvent.click(screen.getByRole("button", { name: "返回对话 A" }));
expect(screen.getByLabelText(/已确认/)).toBeInTheDocument();
expect(screen.getByText("创建视频工程任务")).toBeInTheDocument();
```

## Task 2：最小实现跨对话确认恢复

- [x] 扩展乐观交换类型，保存 `confirmationPlanKey`。
- [x] 确认点击时把当前方案键写入乐观交换。
- [x] 对视频确认请求标记“切换对话不取消”，普通请求继续走原 abort 清理。
- [x] 返回原对话时，用 `pendingExchange.confirmationPlanKey` 恢复对应确认卡的已确认状态。
- [x] 请求完成或失败时只清理原会话交换；不得把“已停止生成”写到其他对话。
- [x] 重新运行 Task 1 测试，预期通过。

最小实现形态：

```ts
type OptimisticExchange = {
  // existing fields...
  confirmationPlanKey?: string;
};

const isPlanOptimisticallyConfirmed = (plan: AssetMessagePlan) =>
  confirmingPlanKey === confirmationPlanKey(plan)
  || optimisticExchange?.confirmationPlanKey === confirmationPlanKey(plan);
```

## Task 3：回归验证与文档检查

- [x] 运行相关确认/执行卡测试：75 项通过。
- [x] 运行 `npm run typecheck`：通过。
- [x] 运行 `npm run lint`：0 错误，保留 9 条既有 `<img>` 警告。
- [x] 运行 `npm run test`：37 个文件、286 项测试通过。
- [x] 运行 `npm run check:agents`：agent 同步检查通过；`docs:check` 被既有 `docs/plans/active/2026-07-15-mg-export-timeout-handoff.md` 缺状态头阻塞，与本次文件无关。
- [x] 运行 `npm run build`：生产构建通过。
- [x] 检查 `git diff --check` 和窄范围 diff；构建改写的 `next-env.d.ts` 已按执行前 SHA-256 `F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0` 精确恢复。

## 执行结果

- 2026-07-16 完成前端修复；未修改后端、数据库、端口或运行中服务。
- 新增真实交互回归覆盖确认切换、返回恢复和普通消息继续取消三种行为。
- 计划完成后移入 `docs/archive/plans/`；代码保留为未提交状态，等待用户后续提交指令。

## 验收标准

- 点击确认后切换其他对话，不出现“已停止生成”。
- 返回原对话时，即使确认接口尚未返回，也显示已确认方案和原执行卡。
- 接口成功后，乐观状态被持久化的 confirmed 方案、工程资产和真实 job 状态替换。
- 普通消息切换对话时仍会取消，不引入跨对话的普通生成回包污染。
- 不修改后端、不创建数据库、不启动或占用开发者端口。
