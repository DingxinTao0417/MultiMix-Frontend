# 重试内容生成卡片去重

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-26

## 背景与根因

内容生成失败后重试会创建新的后继任务，并在新助手消息 metadata 中保存
`retry_of_asset_generation_job_id`。前端为保留多任务历史，按任务 ID 保存实时任务；但对话渲染只把
消息自身的任务 ID 视为已锚定，未把该消息明确替代的前序任务排除。因此重试消息内已经展示上方
进度卡时，前序实时任务仍会在消息列表末尾追加为第二张卡。

## 涉及文件与关键位置

- `app/assets/components/conversation-studio.tsx`：消息锚定任务与末尾实时任务追加逻辑。
- `app/assets/__tests__/conversation-generation-card-order.test.tsx`：对话内任务卡数量与位置回归测试。

## 具体改法

1. 先增加失败测试：重试消息携带后继任务 ID 和前序任务 ID，实时列表同时存在两者时，只渲染消息内的后继任务卡。
2. 从可见消息 metadata 收集被明确替代的前序任务 ID。
3. 末尾追加未锚定实时卡时，同时排除这些已被后继任务替代的 ID；不删除普通失败历史卡，也不改变后端任务状态或轮询。

## 风险与取舍

- 仅依据后端明确提供的重试关系去重，不按时间或状态猜测，避免误隐藏同一会话中的独立并行任务。
- 历史失败消息仍可按现有规则展示；只阻止其对应实时对象再次作为游离卡追加。
- 本次不修改 API、后端重试语义或卡片视觉。

## 验证方式

- Vitest：新增重试链双实时对象的复现用例，修复前失败、修复后通过。
- 运行现有 `conversation-generation-card-order` 与 `asset-generation-job-ui` 测试，确认普通历史卡和单卡行为无回归。
- 运行前端类型检查与文档检查。
