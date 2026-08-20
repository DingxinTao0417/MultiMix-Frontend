# LLY-30 修复中文输入法 Enter 误发送创作请求

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-15

## 背景与根因

- 中文输入法（IME）composition 期间，候选词尚未上屏，用户按 Enter 通常是在“选词/确认候选”，而不是“发送消息”。
- 创作首页 `ConversationStart` 与工作室 `ConversationStudio` 的两个 textarea 的 `onKeyDown` 当前只判断 `event.key === "Enter" && !event.shiftKey`，没有检查 `event.isComposing` / `event.nativeEvent?.isComposing`，因此在 composition 期间按 Enter 会 `preventDefault()` 并直接调用提交函数，把未上屏的输入误发成创作请求。
- 根因：缺少共享的 IME-safe Enter 判定；两处入口各自维护同一份不完整判定，行为无法保持一致。
- 修复方式：抽取共享纯 helper `shouldSubmitComposerOnEnter`，两处 handler 统一调用；只有 helper 返回 true 时才 `preventDefault()` 并调用原有提交函数。这是根因修复（统一判定逻辑），不是单入口补丁。

## 计划存放位置说明

- 本计划文件位于 `MultiMix-Frontend/docs/plans/active/`。依据：
  - 前端 AGENTS.md 约定“前端整改项记录在 `docs/plans/active/`”（前端仓库内目录）；
  - `work:guard` 与 `docs:check` 均只认可 `MultiMix-Frontend/docs/plans/active/` 或 `MultiMix-Backend/docs/plans/active/` 下的 active plan。
- 开工时曾按任务字面路径在工作区根 `docs/plans/active/` 落盘一次，因 `work:guard begin` 硬性校验拒绝该路径，已删除该副本，避免同一计划两份存放。

## 基线核对（2026-08-15，本会话实测）

- Frontend `main`：HEAD 与 `origin/main` 均为 `06a907cacaac4cd6c8fab91f5023a8b708c84060`。
- Backend `main`：HEAD 与 `origin/main` 均为 `a5be85ede1efa9d0e2545f3d1fa45338e1b5c639`，工作区干净。
- Frontend 工作区唯一既有改动：`next-env.d.ts` 单行修改（`.next-build/types/routes.d.ts` → `.next/types/routes.d.ts`），属用户既存改动，必须逐字节保留。
- `next-env.d.ts` SHA256（开工前）：`F4E8976C19FC926644D72610BF1058BD6BF52ADD97E46A02BC0B912A751625C0`。
- `npm --prefix MultiMix-Frontend run work:guard -- status` 返回 `[]`，无活动占用。
- 既有环境告警（非本任务引入，不处理）：`docs:check` 因工作区根 `docs/` 目录存在而报 `doc-root` / `stale-location` 两条 issue，导致 `check:agents` 基线即失败；本任务只报告、不改动工作区根 docs。

## 涉及文件与关键位置（重新核对后的当前行号）

- `MultiMix-Frontend/app/assets/components/conversation-start.tsx`
  - 第 5 行：现有 import 来自 `../lib/asset-workspace-shared`。
  - 第 225–230 行：textarea `onKeyDown`，当前为 `if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); }`。
- `MultiMix-Frontend/app/assets/components/conversation-studio.tsx`
  - 第 6 行：现有 import 来自 `../lib/asset-workspace-shared`。
  - 第 1007–1012 行：textarea `onKeyDown`，当前为 `if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitInstruction(); }`。
- `MultiMix-Frontend/app/assets/lib/asset-workspace-shared.ts`
  - 既有共享纯 helper 模块（无 JSX/状态），末尾为附件发送守卫 `attachmentSendBlockReason`（第 154–163 行）。新增 helper 追加在该模块内。
- `MultiMix-Frontend/app/assets/__tests__/composer-ime-submit.test.tsx`（新增）
  - 组件行为测试（jsdom + Testing Library 渲染真实组件）+ 共享 helper 单测。

## 具体改法

### 1. 共享 helper（`asset-workspace-shared.ts` 新增）

使用结构化最小事件形状，同时兼容 React SyntheticEvent 与原生事件投影：

```ts
export type ComposerEnterKeyEvent = {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean } | null;
};

export function shouldSubmitComposerOnEnter(event: ComposerEnterKeyEvent): boolean {
  if (event.key !== "Enter" || event.shiftKey === true) return false;
  if (event.isComposing === true) return false;
  if (event.nativeEvent?.isComposing === true) return false;
  return true;
}
```

- `key` 非 `Enter` → false；`shiftKey === true` → false（保持 Shift+Enter 换行语义）。
- `event.isComposing === true` 或 `event.nativeEvent?.isComposing === true` → false。
- 不新增词表、magic keyCode 或重复判断；React `KeyboardEvent<HTMLTextAreaElement>` 结构上可直接赋给该类型。

### 2. `conversation-start.tsx`

- 在既有 import 中追加 `shouldSubmitComposerOnEnter`。
- `onKeyDown` 改为：

```tsx
onKeyDown={(event) => {
  if (shouldSubmitComposerOnEnter(event)) {
    event.preventDefault();
    void submit();
  }
}}
```

### 3. `conversation-studio.tsx`

- 在既有 import 中追加 `shouldSubmitComposerOnEnter`。
- `onKeyDown` 改为：

```tsx
onKeyDown={(event) => {
  if (shouldSubmitComposerOnEnter(event)) {
    event.preventDefault();
    void submitInstruction();
  }
}}
```

- 其余提交路径（发送按钮、表单 onSubmit、确认卡、建议卡、`multimix:composer-send` 事件）一律不动。

## 风险与取舍

- **风险：** 某些浏览器/输入法在 compositionend 后立即上屏并紧跟着的 Enter keydown 可能仍带 `isComposing`；标准行为是 compositionend 之后的普通 Enter 不带 isComposing，helper 双通道检查已覆盖 React SyntheticEvent 与原生事件投影两种形态。若后续发现个别浏览器异常，可再评估 `compositionend` 时序处理，本任务不做提前假设。
- **取舍：** 判定只在 Enter 按下的那一刻做，不引入组件内 composition 状态跟踪（`keyCode === 229` 等历史魔法值不使用），改动最小且无状态残留。
- **影响面：** 只收紧“Enter 是否提交”的判定；发送函数、附件守卫、停止生成、表单按钮、后端行为均不变。非 IME 用户的普通 Enter、Shift+Enter 行为与现状完全一致。
- `next-env.d.ts` 不触碰；不在本任务做任何 commit/push/部署/Linear 状态变更。

## TDD 与验证矩阵

先写测试（预期在当前实现下失败），再实现，最后全量验证。

| # | 用例 | 断言 |
|---|------|------|
| 1 | Start：输入非空文本，compositionStart 后触发 `isComposing=true` 的 Enter keydown | `onSend` 调用 0 次；事件未被 `preventDefault` |
| 2 | Start：compositionEnd 后触发普通 Enter | 异步等待发送完成，严格恰好 1 次；发送文本正确 |
| 3 | Start：Shift+Enter | `onSend` 调用 0 次；keydown 未被 `preventDefault`（保留换行语义） |
| 4 | Studio：同上三类行为，目标为 `onSendMessage` | 同上，且断言发送文本正确 |
| 5 | helper：`{ key: "Enter" }` → true；`shiftKey: true` → false；`key: "a"` → false | 直接单测 |
| 6 | helper：直接 `isComposing: true` → false | 兼容 React SyntheticEvent 形态 |
| 7 | helper：`nativeEvent: { isComposing: true }` → false | 兼容原生事件投影形态 |

验证命令：

1. `npx vitest run app/assets/__tests__/composer-ime-submit.test.tsx`（针对性新测试）
2. `npm --prefix MultiMix-Frontend run typecheck`
3. `npm --prefix MultiMix-Frontend run lint`
4. `npm --prefix MultiMix-Frontend run test`
5. `npm --prefix MultiMix-Frontend run check:agents`
6. `npm --prefix MultiMix-Frontend run build`
7. `git -C MultiMix-Frontend diff --check`

阶段边界执行 `work:guard check --token <token>`；完成后 `work:guard end --token <token>`。

## 范围声明

- 不改后端；不连接生产库；不启动后端服务。
- 不改发送业务流程（`onSend` / `onSendMessage` 签名与内部逻辑、附件守卫、停止生成、表单按钮、确认卡等一律不动）。
- 不改 `next-env.d.ts`；该文件的用户既存单行修改保持原样，不混入本任务。
- 不使用 E2E 服务或 SQLite；本修复由组件测试覆盖。
- 不 commit、不 push、不部署、不修改 Linear 状态；完成后停在待 Codex 审查状态。
