# 分镜轻量预览视觉起始态实施计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-08

## 背景与根因

轻量分镜预览当前只会显示已挂载的图片/视频主素材；当编导已选择 `graphics_primary` 的图形、动画或品牌收束主画面但尚无独立媒体缩略图时，界面会退到“待补素材”式的空白占位。这个状态把正常的图形主画面误表示为素材缺口，也没有向用户展示该镜的视觉起始状态。

当前权威设计已确认：轻量预览不是缩小版成片。有主素材时展示主素材或代表帧；`graphics_primary` 时展示由已保存的分镜结构化字段驱动的背景、版式和起始态；只有真正的 `unfilled`、加载失败或未知状态才显示占位/失败说明。完整字幕、MG overlay、配音和最终合成动效不属于轻量预览范围。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/assets/lib/asset-workspace-types.ts`：新增分镜的受控 `primaryVisualTreatment` 投影，保留模型输出的结构化呈现方式，不用本地文案反推语义。
- `MultiMix-Frontend/lib/asset-mappers.ts` 与 `app/assets/__tests__/asset-mappers.test.ts`：从 `primary_visual_strategy.visual_treatment` 映射受控值，并证明 `graphics_primary` 不被降级为素材缺口。
- `MultiMix-Frontend/app/assets/components/storyboard-preview.tsx`：渲染通用图形主画面起始态；它仅消费 `primaryVisualTreatment`、标题、口播、图形组件和背景策略的已保存投影，不根据中文关键词推断分镜语义。
- `MultiMix-Frontend/app/assets/components/segment-cards.tsx`：图形主画面不显示“待补素材”，缩略图显示一致的图形视觉锚点。
- `MultiMix-Frontend/app/globals.css`：补充受限、比例自适应的图形预览背景和缩略图样式，保持现有白色播放器外壳契约。
- `MultiMix-Frontend/app/assets/__tests__/storyboard-preview.test.tsx`、`segment-cards-contract.test.ts`、`video-browse-contract.test.ts`：先补失败测试，再覆盖图形镜展示、真实缺素材占位与播放器比例/外壳零回归。

## 具体改法

1. 将模型已输出的 `source_primary | source_with_graphics | graphics_primary` 作为受控枚举投影到前端分镜类型；未知/历史缺字段保持未定义，不臆造默认语义。
2. 保持素材优先：只要有可读的主图片或视频，仍按当前路径展示媒体。仅当没有媒体且 `primaryVisualTreatment=graphics_primary` 时，显示图形背景起始态。
3. 图形起始态固定为通用、非最终合成的背景和信息层次，呈现分镜标题、可选图形组件与口播摘要；不渲染字幕、MG 或模拟最终动画。
4. 仅 `materialFillStatus=unfilled` 或媒体加载失败使用“待补素材/预览不可用”提示。`graphics_primary` 永远不是待补素材。
5. 保持 `asset_reference`、`mg_decision`、`primary_visual` 的既有权威边界：本改动只消费已保存的前端投影，不创建素材、改变素材选择或重写工程。

## 风险与取舍

- 轻量图形预览表达起始态而非最终渲染，不能将其标示为成片或完整动画；以简短“图形主画面”说明区分。
- 不能按图形组件名称新增不同视觉模板，避免前端成为语义决策层；首版使用单一受控展示框架，内容来自模型输出字段。
- 历史分镜缺少 `primaryVisualTreatment` 时保持当前占位逻辑，避免误将真实缺素材改为正常画面。

## 验证方式

1. TDD：先运行新增组件测试，证明现状不能渲染 `graphics_primary` 视觉锚点；同时保留真实 `unfilled` 的占位用例。
2. 运行 mapper、分镜浏览、分镜卡与展示区定向测试。
3. 运行 `npm --prefix MultiMix-Frontend run check:video-preview-contract`、`npm --prefix MultiMix-Frontend run test:product-stage-style`、`npm --prefix MultiMix-Frontend run test:display-coverage` 与 `docs:check`。
4. 浏览器验收（独立前端端口、无后端写入）：检查横竖比例、图形镜背景、素材镜代表帧、真实缺素材提示，以及不出现黑块/空白画布。

## 执行结果

- 新增 `primaryVisualTreatment` 的受控前端投影；`graphics_primary` 直接消费编导模型已保存的结构化决策，不通过文案或关键词重判。
- 没有可读媒体的 `graphics_primary` 分镜现在显示通用图形背景、版式层次、分镜标题、口播摘要和已保存的呈现方式；它不渲染完整字幕、MG 或最终动效。
- 图形主画面在主区和分镜缩略图中都不再标为“待补素材”；`unfilled` 分镜仍保留原有占位说明。
- 已完成 TDD 红绿验证：原实现未找到“图形主画面预览”，最小实现后新增组件测试通过。
- 定向回归、播放器契约、样式契约和隔离展示区 E2E 已通过；完整前端测试 `78` 个文件、`547` 项用例与生产构建均通过，测试运行目录及一次性 SQLite 已清理。
