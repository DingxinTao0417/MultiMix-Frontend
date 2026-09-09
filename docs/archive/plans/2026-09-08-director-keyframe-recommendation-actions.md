# 编导稿关键帧建议操作入口修复（已被对话方案取代）

> Status: archived
> Owner: frontend
> Last verified: 2026-09-09

## 归档结论

该计划完成了旧版“分镜卡片展示采纳按钮”的实现与部署，但 2026-09-09 的产品决策明确：关键帧建议及其采纳应发生在对话中，不再以分镜按钮展示。因此停止旧方案的生产 UI 验收，不再把按钮是否可见作为验收条件；后续工作转入后端跨端计划 \`MultiMix-Backend/docs/plans/active/2026-09-09-director-keyframe-conversation-recommendations.md\`。

## 背景与根因

生产环境的编导稿已经在 `metadata.video_plan.generated_clip_recommendations` 中保存逐段关键帧建议，adapter 也把它们映射到了 `product.segments[].imageGenerationRecommendation`。但是 `app/assets/components/product-preview.tsx` 在 `product.mode === "copy"` 时直接返回 Markdown 正文，导致后面的 `SegmentCards` 永远不会渲染。修复这一层后，生产验证继续发现 `app/assets/components/product-workspace.tsx` 的普通编导稿展示分支没有把 `onGenerateKeyframe` 传给 `ProductPreview`，因此卡片能显示建议文本但没有采纳按钮。第二次生产验证表明，上层还会按页面瞬时写入状态移除整个回调，`SegmentCards` 也会按 `isPresenter` 再次屏蔽入口；这两层 UI 推断覆盖了后端已经发布的逐镜结构化建议。

## 涉及文件与关键位置

- `app/assets/components/product-preview.tsx`：`product.mode === "copy"` 的提前返回分支。
- `app/assets/components/product-workspace.tsx`：普通编导稿展示分支的回调透传。
- `app/assets/components/assets-workspace-client.tsx`：关键帧动作回调不再按页面瞬时状态从组件树移除，由动作处理函数执行最终写入检查。
- `app/assets/components/segment-cards.tsx`：后端存在结构化建议时允许真人分镜显示采纳入口。
- `app/assets/__tests__/display-area-cases.test.tsx`：编导稿展示契约与关键帧建议入口覆盖。
- `app/assets/__tests__/presenter-segment-cards.test.tsx`：真人分镜的结构化关键帧建议入口覆盖。

## 具体改法

1. 先增加失败测试：带关键帧建议的编导稿必须保留 Markdown 正文，并显示逐段建议及“采纳关键帧建议”操作。
2. 普通编导稿继续只显示连续正文；仅当至少一个分镜含关键帧建议时，在正文下追加 `SegmentCards`。
3. 在 `ProductWorkspace` 的普通编导稿展示分支把现有 `onGenerateKeyframe` 回调传入预览和分镜卡，沿用既有结构化采纳链路。
4. 增加工作台级测试，确保真实容器组合中按钮可见并提交正确的产物与分镜。
5. 只要后端发布了合法建议，就稳定渲染采纳入口；点击时再由现有 handler 校验连接、登录与完整对话状态。真人分镜的修改配音/换素材限制保持不变，但不再吞掉后端明确发布的关键帧建议。

## 风险与取舍

- 不把编导稿改成视频预览模式，避免引入播放器或工程态视觉语义。
- 不为没有建议的编导稿增加分镜面板，保持当前默认阅读体验。
- 入口只消费后端结构化建议，不在前端根据文案猜测是否需要关键帧。

## 验证方式

- 定向 Vitest：编导稿默认展示和关键帧建议操作测试。
- `npm run lint`、`npm run typecheck`。
- `npm run docs:check`。
- 部署后在生产对话中确认 4 条建议和 4 个采纳按钮可见，并验证点击进入真实图片提案确认链路。

## 任务

- [x] 增加失败测试
- [x] 实现条件式分镜建议入口与容器回调透传
- [x] 运行前端检查并提交
- [x] 部署 Vercel
- [x] 因产品决策改变，取消旧按钮方案的生产 UI 验收并归档
