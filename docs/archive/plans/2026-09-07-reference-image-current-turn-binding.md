# 当前轮参考图绑定修复

> Status: archived
> Owner: frontend
> Last verified: 2026-09-07

## 背景与根因

在生产会话中，用户从“项目资源”选择鞋子原图后，页面只提供“加入项目”；素材详情的“用于创作”则会新开泛内容对话并自动生成文案。两者都不会把素材作为当前会话下一条消息的显式参考图，因此“只重做 F04”被错误路由为编导稿，而非 FLUX 图片确认卡。

后端已支持版本化的 `reference_context_selection_version=v1` 和 `linked_asset_ids`，并且会话消息可持久化该选择。根因在前端生产构建缺少将“项目资源中的当前素材”写入 `conversationContextAssets` 的入口及其可见状态。

## 改法

- `app/assets/components/project-resources-drawer.tsx`：为 active source 提供非付费的“用于本轮”操作；该操作不能创建项目、对话、proposal 或 job。
- `app/assets/components/assets-workspace-client.tsx`：接收该操作，在当前会话以单一素材替换 `conversationContextAssets` 并关闭抽屉；下一条消息才携带该素材 ID。
- `app/assets/components/conversation-studio.tsx`：在输入框上方展示“本轮参考素材”，并允许用户在发送前清除。
- `app/assets/lib/conversation-context-assets.ts`：仅从最近一条带版本化显式选择证据的用户消息恢复上下文；不得从项目资源、历史产物或无版本 `linked_asset_ids` 猜测。

## 风险与取舍

- 不复用“用于创作”：它的产品语义是新建泛创作对话，不能承担当前会话的参考图选择。
- 不自动从项目资源推断参考图，避免多素材时把错误物品带入 FLUX。
- 本修复不开放独立文生图入口，不改变后端确认门，不创建或自动确认 Modal job。

## 验证

1. 前端单元测试证明“用于本轮”只回调选择，不创建生成；刷新后只恢复版本化显式素材选择。
2. TypeScript 类型检查通过。
3. 生产验证要求仍为：选择素材后只展示图片确认卡，确认前不产生编导稿、视频工程或 Modal 调用。

## 收口记录

- 2026-09-08：定向单元测试 8/8 通过，TypeScript 类型检查通过；功能分支提交 `417697b` 已合并进本地 `main`。
