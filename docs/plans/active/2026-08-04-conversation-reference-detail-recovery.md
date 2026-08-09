# 加入素材后对话详情恢复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-04

## 背景与根因

浏览器 E2E 在已完成一次只读提问的成片对话中，从图片库选择“加入对话”后，输入框持续显示
“参考样例只读”。这不是该对话真的只读：`assets-workspace-client.tsx` 用
`detailsLoaded === false` 在完整详情尚未恢复时暂时禁用编辑。

一次消息提交会用后端返回的完整对话替换本地状态，但该返回没有明确保留
`detailsLoaded: true`。此前并行发出的轻量快照随后可以覆盖这条状态为
`detailsLoaded: false`；同一 ID 的详情请求键又被视为已使用，导致不再恢复完整详情，界面永久停在
加载/只读状态。

## 涉及文件与具体改法

- `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`
  - 将消息接口返回的已完整映射对话显式标记为 `detailsLoaded: true`，使轻量快照不能覆盖已知完整详情。
- `MultiMix-Frontend/app/assets/__tests__/asset-workspace-adapter.test.ts`
  - 先添加适配器回归测试，证明消息响应保留完整详情标记；旧实现应失败。
- `MultiMix-Frontend/lib/asset-mappers.ts`
  - 已就绪视频工程仍须保留其消息绑定的结构化原子修改动作；只清理过期的视频工程确认建议，不能把
    后续“替换素材、改声音、改字幕”等动作的实时完成状态一并清掉。
- `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`
  - 增加已就绪视频工程内分镜修改动作的映射回归测试，锁定完成状态可以回到对话时间线。
- `MultiMix-Frontend/e2e/agent-video-atomic-edit.spec.ts`
  - 保留现有“从图片库加入对话后可继续编辑”的真实浏览器验收，不用放宽等待条件或删除断言来掩盖问题。
  - 校验素材替换后的两层引用：`asset_reference.chosen_asset_id` 必须是用户选中的原素材；
    `primary_visual` 必须是可播放的持久化派生素材，并在 `provenance.source_asset_id` 回指该原素材。

## 风险与取舍

- 只对 `/conversations/messages` 返回的完整会话设置已加载标记；摘要和 snapshot 仍保持轻量/只读语义。
- 不改变后端接口、对话编排、字幕决策或素材引用的保存格式。
- 该修复不触碰目前被另一开发占用的 `conversation-studio.tsx` 和确认卡逻辑。
- 保留原有“工程准备完成后不再显示旧的生成确认建议”体验；仅修复动作状态被错误抹除的问题。
- `primary_visual.asset_id` 是最终可播放文件的 ID，不等同于用户原始素材 ID；测试不把两者强行相等，
  同时要求来源回指精确一致。

## 验证方式

1. TDD：新增适配器测试，先确认旧实现不能表达完整详情，再实施最小修复。
2. 运行适配器相关 Vitest 与前端类型检查。
3. 重跑隔离的 `test:e2e:agent-video-atomic`；确认可完成素材替换、恢复版本与声音确认流程，并自动清理临时端口、SQLite 和构建产物。
4. 运行 `docs:check`。

## 执行结果

- 红灯：消息接口返回的完整对话缺少 `detailsLoaded: true`，轻量快照可将编辑器永久降级为只读。
- 绿灯：适配器回归测试 23 项通过；完整消息响应不再被快照降级。
- 红灯：已就绪视频工程错误清除了后续原子修改的 `agentAction`，导致完成文案出现但状态点仍显示处理中。
- 绿灯：素材映射回归测试 40 项通过；保留已就绪工程的分镜修改状态，同时继续过滤过期的视频工程确认建议。
- 浏览器验收：`test:e2e:agent-video-atomic` 通过（41.9 秒）。验收覆盖加入对话引用、分镜替换、完成状态、刷新恢复、版本恢复与全片换声确认。
- 测试中的主视觉断言已按权威契约修正：最终可播放的派生文件 ID 与用户源素材 ID 不同，但
  `primary_visual.provenance.source_asset_id` 必须精确回指源素材。
