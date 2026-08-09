# 合并视频生成说明与素材使用摘要

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-06

## 背景与根因

视频工程浏览态将动画编排结果渲染为独立的“动画编排摘要”卡，再在其下方渲染可展开的素材使用说明。两块内容都在回答视频的生成依据与编排结果，造成重复卡片和额外纵向空间；用户已确认将动画信息合并进素材使用说明。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：视频浏览态当前分别渲染动画摘要与 `SourceRefBlock` 的位置。
- `MultiMix-Frontend/app/assets/components/source-ref-block.tsx`：可展开的素材来源卡及其摘要行。
- `MultiMix-Frontend/app/globals.css`：来源卡的摘要、展开内容与指标的视觉规则。
- `MultiMix-Frontend/app/assets/__tests__/display-area-cases.test.tsx`、`source-ref-block.test.tsx`：展示区与来源卡回归覆盖。

## 具体改法

1. 将动画编排模式与分镜/效果计数作为来源卡的可选摘要数据传入，而不是单独输出 `video-plan-summary` 卡。
2. 仅在有真实来源摘要或动画摘要数据时显示该合并卡；来源标题保持首要层级，动画指标在同一摘要区作为辅助信息展示。
3. 保留现有展开后的素材引用、命中说明和无素材候选时的现有行为；不改视频播放器、分镜或后端数据契约。
4. 调整组件测试，验证动画信息位于同一张“来源引用”卡中，且不再存在独立的“动画编排摘要”区块。

## 风险与取舍

- 当没有来源摘要但存在动画数据时，合并卡仍需可访问且给出动画摘要，避免信息丢失。
- 本次只重组展示层，不改变动画规划、素材匹配或来源可追溯数据。

## 验证方式

- 已通过展示区与来源引用的定向 Vitest 用例（29 项）。
- 已通过前端类型检查与 lint；lint 仅报告现有无关 warning。
