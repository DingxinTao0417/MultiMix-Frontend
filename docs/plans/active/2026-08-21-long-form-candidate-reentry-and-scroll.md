# 长视频候选重选入口与滚动修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-21

## 背景与根因

生产验收会话 `asset-conversation-d7e2c02583704677912383410e755c02` 中，用户先从长视频候选创建了完整保留版视频工程，随后无法在完成的视频页重新选择其他候选；手动打开“拆条候选 v1”后，候选展示区在窄屏工作台中无法滚动，后续候选卡和操作按钮无法触达。

两个问题的根因分别是：

1. `ProductPreview` 仅在当前选中产物为 `long_form_candidate_set` 时渲染候选卡。完成的视频工程没有“返回这条来源的候选”动作；`assets-workspace-client.tsx` 的 `handleLongFormSelect()` 又要求当前选中的产物 ID 必须等于候选分析资产 ID，以防把旧候选误套到当前工程。因此已有安全边界，但没有安全的重新进入入口。
2. 候选页的 `.shadcn-prototype-product-preview.copy` 与 `.shadcn-prototype-product-main` 虽在对话工作台中允许内容溢出，但其父 `.shadcn-prototype-product`、`.shadcn-prototype-workspace` 和 `.shadcn-prototype-inset` 都是固定视口高度且 `overflow: hidden`。生产浏览器实测候选内容 `scrollHeight=2308px`、可见高度 `732px`，没有任何可滚动祖先承接余量。

## 涉及文件

- `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`：从已完成的原声拆条视频回到同一来源的候选产物。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`：在视频工程页展示“尝试其他拆条方式”入口，并把操作委托给父级选择状态。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`：从 `video_plan.scenes[*].audio_intent.source_asset_id` 读取原声拆条来源、精确匹配候选并展示重新进入入口。
- `MultiMix-Frontend/app/globals.css`：让候选产物使用工作台已有的 stage scroll surface，而不是由固定高度父级裁掉。
- `MultiMix-Frontend/scripts/check-product-stage-style.mjs`：把既有展示样式契约从旧 JSX 字符串升级为候选页与普通视频页都必须保有正确滚动表面的行为契约。
- `MultiMix-Frontend/app/assets/__tests__/long-form-candidate-reentry.test.tsx`：先红后绿验证来源关联判定和点击只切换展示状态。
- `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`：先红后绿锁定候选页必须进入 stage scroll surface，避免以后再次被 `overflow: hidden` 截断。
- 本计划文档。

## 具体改法

1. 新增最小、纯前端的来源关联 helper：
   - 只接受 `source_clip` 分镜的公开 `audio_intent.source_asset_id`；同一工程没有唯一来源时返回空，不猜测。
   - 在当前会话的 products 中只匹配同一 `source_asset_id` 的 `long_form_candidate_set`；多个匹配项取会话中最近的一个，找不到则不展示入口。
2. 视频工程页新增“尝试其他拆条方式”按钮：
   - 只在能精确找到同源候选时显示；点击只切换展示区选中的候选产物，不创建任务、不改写当前视频工程。
   - 进入候选页后继续使用既有 `handleLongFormSelect()` 与后端 `analysis_asset_id` 合同；用户选新的候选才会创建新的编导稿/工程，旧工程保留。
3. 候选页展示区改为显式 stage scroll surface：
   - 对 `long_form_candidate_set` 使用与长文档/视频浏览态相同的右侧滚动表面，并保留底部内边距。
   - 不放宽整个工作台或页面的 `overflow`，避免影响对话栏、播放器和既有视频预览契约。
4. 更新既有产品展示契约脚本：
   - 继续验证普通视频预览使用共享滚动面、不把滚动面嵌套到视频浏览态；同时明确候选集也必须有可滚动的共享表面。
5. 生产复测补正来源读取：
   - 2026-08-22 生产工程只在 `metadata.video_project.segments[*].audio_intent.source_asset_id` 暴露原声来源；前端 helper 此前只读取 `video_plan.scenes`，导致入口仍被安全隐藏。
   - helper 按权威优先级读取工程分镜，再以编导分镜和 `video_segments` 作为兼容投影；合并后的来源 ID 必须仍唯一，不能使用标题、时间或数组顺序猜测。
   - 当原声意图没有投影到工程时，只接受同一分镜 `asset_reference.chosen_asset_id + source_range` 作为确定性长视频来源事实；普通素材引用不能触发入口。

## 风险与取舍

- 重新选择仅改变前端焦点；不复用、改写或删除已完成的视频工程，避免破坏确认幂等与历史版本。
- 来源无法唯一判定时宁可不显示入口，不能按标题、顺序或最近资产做伪关联。
- 滚动只作用于候选产物，不改变已受保护的视频播放器外壳和比例契约。

## 验证方式

1. TDD：先增加来源关联 helper 的失败测试，覆盖同源唯一候选、不同来源不匹配、多个来源不确定三种情况；确认旧代码失败后再实现。
2. TDD：先让展示样式合同要求候选产物包含 `shadcn-prototype-stage-scroll-surface`；确认旧代码失败后再实现。
3. 运行专项 Vitest、`npm --prefix MultiMix-Frontend run test:product-stage-style`、`npm --prefix MultiMix-Frontend run typecheck`、`npm --prefix MultiMix-Frontend run docs:check`。
4. 在当前生产会话中复测：从 `111 视频 v1` 点击“尝试其他拆条方式”，候选页可滚动到 Top 4；选择其他方式时当前 62.603 秒工程仍保留。

## 当前验证记录

- 2026-08-21：样式合同先红，确认旧实现缺少候选页 stage scroll surface 与重新进入入口；实现后通过。
- 2026-08-21：专项回归 `long-form-candidate-reentry` 通过 3 项（同源、混源拒绝、仅切换展示状态）；`test:product-stage-style`、`typecheck`、`docs:check`、既有展示组件回归与生产构建通过。
- 2026-08-21：`lint` 无错误；工作区原有 5 条未使用变量警告仍存在，本次未触及。
- 2026-08-22：生产部署后确认候选页滚动面已生效；完成工程未出现入口，定位为工程分镜来源字段未被 helper 消费，待按本计划第 5 项补正并重新验证。工程 UI 显示“基于 3 个已保存素材生成”，因此继续按权威的 `asset_reference + source_range` 合同补正，不以素材数量猜测来源。
- 2026-08-22：补正后的专项回归覆盖工程分镜、兼容分镜和 `asset_reference + continuous_excerpt source_range` 三种公开来源投影，共 7 项通过；展示区回归、类型检查、样式合同与文档检查通过。
