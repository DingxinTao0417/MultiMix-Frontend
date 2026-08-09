# 分镜卡片与换素材窗口实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-12

**Goal:** 让视频比例、分镜卡和换素材窗口遵循已确认的当前 UI 规格。

**Architecture:** 保留 `ProductPreview -> SegmentCards -> ProductWorkspace -> EditorView/FilmStrip -> AssetPicker` 的现有链路。比例继续由 `product.ratio` 映射到展示区 class；分镜卡只调整展示语义；素材替换继续调用现有分镜重合成接口，只把选择改为显式确认。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest、Testing Library、现有 `shadcn-prototype-*` CSS token。

## Global Constraints

- 不改后端接口，不创建本地数据库，不启动独立 E2E 环境。
- `asset_reference` 继续是分镜主素材权威；公共素材只能在 `no_asset_hit` 后兜底。
- `mg_decision` 继续是 MG 权威；卡片只展示简短用户标签。
- 不在用户分镜列表显示 `兜底素材`。

### Task 1: 比例与分镜卡契约

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/storyboard-preview.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/segment-cards.tsx`
- Modify: `MultiMix-Frontend/app/globals.css`
- Test: `MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts`
- Test: `MultiMix-Frontend/app/assets/__tests__/segment-cards-contract.test.ts`

- [x] 增加失败测试：横屏/竖屏比例 class 必须控制轻量预览、播放器和占位画布。
  - 验证案例：`ratio-landscape` 对应 `16 / 9`，`ratio-portrait` 对应 `9 / 16`。
- [x] 增加失败测试：分镜卡不得渲染 `兜底素材`，仅在没有素材标题和缩略图时显示 `待补素材`。
  - 验证案例：正常已匹配卡无状态；无素材卡显示异常状态。
- [x] 实现最小组件和 CSS 调整并跑专项测试。
  - 命令：`npm test -- app/assets/__tests__/video-browse-contract.test.ts app/assets/__tests__/segment-cards-contract.test.ts`
  - 预期：两个测试文件全部通过。

### Task 2: 确认式素材选择器

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/asset-picker.tsx`
- Modify: `MultiMix-Frontend/app/editor/FilmStrip.tsx`
- Modify: `MultiMix-Frontend/app/globals.css`
- Create: `MultiMix-Frontend/app/assets/__tests__/asset-picker.test.tsx`

- [x] 增加失败测试：点击候选只产生选中态，未直接调用 `onSelect`。
  - 验证案例：点击素材后 `确认替换` 可用，回调次数仍为 0。
- [x] 增加失败测试：确认按钮提交选中素材，关闭/Escape 不提交。
  - 验证案例：点击确认后回调携带正确素材；点击取消不调用回调。
- [x] 增加失败测试：窗口使用 `素材库 · 已理解的素材`、简洁说明和随工程比例变化的缩略图 class。
  - 验证案例：横屏工程候选为 16:9，竖屏工程候选为 9:16。
- [x] 实现受控确认交互，保持现有推荐和素材库接口不变。
  - 命令：`npm test -- app/assets/__tests__/asset-picker.test.tsx`
  - 预期：素材选择器交互测试全部通过。

### Task 3: 用户文案收口

**Files:**

- Modify: `MultiMix-Frontend/lib/asset-mappers.ts`
- Modify: `MultiMix-Frontend/app/assets/components/source-ref-block.tsx`
- Modify: `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`

- [x] 增加失败测试：用户侧来源摘要使用 `公共素材`，不使用 `兜底素材`。
  - 验证案例：两个已保存素材加一个公共素材时，标题为 `基于 2 个已保存素材 + 1 个公共素材生成`。
- [x] 实现来源摘要和来源标签文案调整。
  - 命令：`npm test -- app/assets/__tests__/asset-mappers.test.ts`
  - 预期：mapper 测试全部通过。

### Task 4: 验证与文档归档

**Files:**

- Verify: `MultiMix-Frontend/`
- Move after completion: `docs/plans/active/2026-07-12-storyboard-card-material-picker-implementation.md` -> `docs/archive/plans/2026-07-12-storyboard-card-material-picker-implementation.md`

- [x] 运行 `npm run typecheck`。
- [x] 运行 `npm run lint`。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run check:agents`，其中包含 `docs:check`。
- [x] 运行 `npm run build`。
- [x] 运行 `git diff --check`；识别并保留工作区原有的执行进度标题相关改动，不纳入本任务范围。
- [x] 将全部任务和验证案例打勾后，把计划移入归档目录。
