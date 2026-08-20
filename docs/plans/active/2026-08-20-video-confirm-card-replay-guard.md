# 视频确认卡重复点击防护

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-20

## 背景与根因

生产复验中，视频工程已生成完成后，旧编导稿确认卡仍显示并保留“确认，生成视频工程”按钮。再次点击后，前端会把该确认语句提交给普通对话流，导致页面出现“我理解你想做‘确认，视频工程’相关内容……”这类多余回复。

根因在前端会话映射层：`conversationFromPersisted()` 在检测到已有 ready 视频工程时，只过滤了普通建议 chips 和 suggestion actions，没有同步处理 assistant message 上的 `video_project_confirmation` plan。确认卡仍处于 `pending`，所以按钮仍可点。

## 涉及文件

- `MultiMix-Frontend/lib/asset-mappers.ts`
- `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`
- 本计划文档

## 具体改法

1. 当当前会话已有 ready video project 时：
   - 移除/确认旧消息中的 `video_project_confirmation` 待确认 plan；
   - 保留方案信息的展示，不再提供确认按钮。
2. 不改变 `video_parameter_confirmation` 的最新卡保留逻辑。
3. 不改后端确认接口；后端幂等仍保留作为安全防线。
4. 历史清理补充：
   - 对已生成 ready video project 的会话，过滤旧版本误触发产生的普通助手回复；
   - 只匹配“确认视频工程”误被当作普通聊天后的固定澄清型回复；
   - 不删除后端数据，不影响真实用户主动追问、修改分镜或后续助手回复。

## 风险与取舍

- 这是 UI 状态收敛，不影响视频生成、导出和后台 job。
- 若用户确实想重新生成视频工程，应通过失败重试或明确重新生成入口，而不是旧确认卡重复提交。
- 历史清理采用前端只读过滤，不做生产数据库删除；好处是可回滚，风险是数据库里仍保留原始审计记录。

## 验证方式

- 先补失败测试：已有 ready 视频工程时，旧 `video_project_confirmation` plan 不再保持 pending 按钮。
- 先补失败测试：已有 ready 视频工程时，旧“我理解你想做‘确认，视频工程’……”误回复不进入前端消息列表。
- 跑前端相关 mapper 测试。
- 跑 `npm --prefix MultiMix-Frontend run docs:check`。

## 当前验证结果

- `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts -t "marks stale video-project confirmation plans"`：先失败复现，修复后通过。
- `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts app/assets/__tests__/conversation-execution-presentation.test.ts app/assets/__tests__/conversation-agent-actions.test.tsx`：65 passed。
- `npm --prefix MultiMix-Frontend run docs:check`：Docs check passed。
- `git -C MultiMix-Frontend diff --check`：通过；仅 Windows 换行提示。
- `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts -t "filters legacy assistant replies"`：先失败复现，修复后通过。
- `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts app/assets/__tests__/conversation-execution-presentation.test.ts app/assets/__tests__/conversation-agent-actions.test.tsx`：66 passed。
- `npm --prefix MultiMix-Frontend run docs:check`：Docs check passed。
