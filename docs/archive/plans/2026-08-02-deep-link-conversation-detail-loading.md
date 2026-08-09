# 深链接对话详情加载修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-02

## 背景与根因

浏览器访问已存在的对话深链接
`/app/assets?conversation=<public_id>` 时，工作台先请求最近 50 条对话摘要。
目标对话不在这 50 条时，前端没有把该 ID 放入 `conversations` 状态，详情加载 effect 因
`selectedPersistedConversation` 为空而直接返回。页面会永久显示“载入对话…”，尽管后端的
`GET /v1/assets/conversations/{public_id}` 可正常返回该对话。

这不是素材、LLM 或用户登录问题，而是“通过直达链接打开历史对话”缺少独立详情加载入口。

## 涉及文件

- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`：在已选对话不在摘要列表时，
  仍发起一次详情读取；成功后将详情合入会话状态，失败后展示现有重试提示。
- `MultiMix-Frontend/app/assets/__tests__/workspace-new-conversation-routing.test.tsx`：补回归用例，
  锁定深链接目标不在最近摘要时不会被降级成“新建对话”。

## 具体改法

1. 将详情读取的条件从“目标已在摘要状态中”改为“有 token 且选中的是持久化对话 ID”。
2. 保留摘要列表的轻量请求和 50 条上限；详情成功后仅把目标会话插入/替换到本地状态，不扩大列表
   读取范围，也不改变删除、重命名或当前对象继承规则。
3. 用当前 `conversationDetailGenerationRef` 与请求键保证相同 ID 的并发读取仍去重；失败继续使用
   现有重试 UI，绝不把未知历史对话伪装成新建对话。

## 风险与取舍

- 深链接会多一次按 ID 的只读请求，但只针对未出现在摘要页的目标，避免为历史直达链接加载全量历史。
- 详情请求仍经过现有前端有限重试和后端只读连接恢复；本修复不放宽鉴权，也不创建任何产物或视频工程。

## 验证

- 单测：历史深链接不在摘要结果时，仍调用详情读取并将返回对话放入状态。
- 浏览器：使用当前护肤会话直达链接，页面显示已有消息与编导稿而非持续“载入对话…”。
- 回归：普通新建对话和摘要内的对话选择保持原路由行为。

## 补充：重复视频参数确认卡（2026-08-02）

### 背景与根因

同一条对话中，用户先以普通文本确认视频参数时，后端会要求携带结构化参数并再次返回同一待确认
计划。前端逐条渲染所有历史 `video_parameter_confirmation` 计划，没有将旧卡标记为历史状态，因而同时
展示两张可提交的“确认参数并生成编导稿”卡。两张卡会让浏览器自动化和用户都无法确定当前唯一有效的
确认入口，也增加重复创建编导稿的风险。

### 涉及文件与改法

- `MultiMix-Frontend/app/assets/lib/conversation-execution-presentation.ts`：在已加载消息中只保留最后一张
  待确认的视频参数计划；普通消息和非参数确认计划不受影响。
- `MultiMix-Frontend/app/assets/components/conversation-studio.tsx`：现有渲染已消费上述可见消息结果，故无需
  改动；经浏览器回归确认它只会渲染该唯一当前参数确认卡。
- `MultiMix-Frontend/app/assets/__tests__/conversation-execution-presentation.test.ts`：先复现“旧参数卡 +
  文本确认 + 新参数卡”时只能保留最新卡的失败用例，再锁定该行为。

### 风险、取舍与验证

- 仅隐藏被更新替代的旧参数操作卡，不删除任何对话消息或审计记录；用户和服务端仍保留完整历史。
- 以计划 `kind` 与消息顺序做结构性判断，不新增中文语义词表；无参数确认或仅一张卡的会话保持原样。
- 运行对应 Vitest、ESLint 与浏览器回归：当前 PDF 对话只显示一张卡，点击后仅创建一次编导稿请求。
