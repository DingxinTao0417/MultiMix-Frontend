# 视频分镜浏览态交互修整计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-02

## 背景与根因

当前视频展示区有三处浏览体验问题：

- 分镜列表位于独立的 `overflow-y: auto` 容器中，卡片阴影紧贴滚动区域边缘，超出部分会被裁切。
- 当前激活分镜也会常驻显示“修改配音 / 换素材”，使每张卡片的浏览态视觉过重。
- 分镜标题右侧展示冗余的跳转提示，素材来源块默认展开，占用展示区纵向空间。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/globals.css`：分镜列表滚动内边距、卡片操作按钮显隐、来源折叠块样式。
- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：停止向分镜列表传入跳转提示。
- `MultiMix-Frontend/app/assets/components/source-ref-block.tsx`：来源块改为默认收起、点击标题展开。
- `MultiMix-Frontend/app/assets/__tests__/segment-cards-contract.test.ts`：更新按钮显隐与滚动阴影空间契约。
- `MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts`：确认浏览态不再传入跳转提示。
- `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`：保持独立滚动区并验证阴影安全空间。
- `MultiMix-Frontend/app/assets/__tests__/source-ref-block.test.tsx`：补充默认折叠和展开行为验证。
- `MultiMix-Frontend/e2e/display-area.spec.ts`：来源素材案例先展开摘要，再验证素材条目可见。
- `MultiMix-Frontend/docs/MULTIMIX_WORKSPACE_DESIGN.md`：同步本次用户确认的浏览态规则。
- `docs/specs/ui/prototypes/current/screens/workspace-video.html`：同步当前可点击原型。

## 具体改法

1. 在分镜列表滚动内容的上下和水平方向增加少量安全内边距，并用负外边距抵消布局增量，让卡片阴影完整绘制但不改变展示区对齐。
2. 操作按钮默认隐藏，只在卡片 hover 或 `focus-within` 时显示；激活分镜不再触发常驻显示，键盘用户仍可访问。
3. 不再渲染“点击任意分镜可跳转成片 / 切换预览”提示，保留卡片本身的点击跳转能力。
4. 来源引用使用原生 `details/summary`，默认无 `open`，点击标题后展开素材条目和命中说明。
5. 同步权威设计文字、当前原型和独立契约测试，避免实现与基准分叉。

## 风险与取舍

- hover-only 操作在触屏设备上没有悬停状态；按钮仍可通过卡片聚焦后显示，触屏点击卡片后由浏览器焦点行为提供入口。后续如需专门的移动端操作菜单，应另行设计。
- 滚动容器增加安全空间会略微减少单屏可见高度；采用小尺寸内边距并抵消外部布局，优先保证阴影不被截断。
- 原生 `details` 保留浏览器语义与键盘可访问性，视觉通过现有样式统一。

## 验证方式

- 运行相关 Vitest：分镜卡片、来源折叠块、展示区样式契约。
- 运行 `npm --prefix MultiMix-Frontend run check:video-preview-contract`。
- 运行 `npm --prefix MultiMix-Frontend run test:product-stage-style`。
- 运行隔离的 `npm --prefix MultiMix-Frontend run test:display-coverage`。
- 运行 `npm --prefix MultiMix-Frontend run docs:check`。
- 视测试环境可用性执行展示区浏览器截图核对：阴影完整、按钮仅 hover/focus 出现、来源默认收起且可展开。

## 执行结果

- 分镜滚动列表已增加阴影安全空间；激活态不再常驻操作按钮。
- 分镜跳转提示已移除，点击卡片定位行为保留。
- 来源摘要已改为默认收起的原生 disclosure，并同步当前原型与设计规则。
- 定向组件/契约测试 9/9 通过；展示区组件测试 29/29、隔离浏览器 E2E 10/10 通过。
- `check:video-preview-contract`、`test:product-stage-style`、`docs:check`、TypeScript 和相关 ESLint 均通过。
- 一次性测试库、临时产物、测试构建目录和 8299/3219 进程均已清理。
