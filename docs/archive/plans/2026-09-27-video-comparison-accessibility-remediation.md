# 视频版本对比键盘与读屏体验整改计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-27

## 背景与根因

第二轮版本对比复查确认两项 P2 问题：首屏“查看受影响分镜”按钮只滚动到列表，键盘焦点仍留在滚出视口的按钮；双播放器虽然在 `VideoPreviewPlayer` 调用处分别传入版本标签，但画面按钮和进度条仍共用相同的可访问名称，无法让读屏用户辨认修改前后。

根因分别位于滚动导航没有焦点交接，以及播放器的 `label` 仅附在无语义角色的根 `div` 上、未传递给播放器控件。

## 涉及文件与关键位置

- `app/assets/components/product-preview.tsx:657-663,759-763`：首屏跳转按钮、分镜列表区域和键盘焦点目标。
- `app/assets/components/video-preview-player.tsx:105-175`：播放器分组名称、播放/暂停按钮名和进度滑块名称。
- `app/globals.css:3970-4088`：播放器与分镜列表的聚焦可见样式。
- `app/assets/__tests__/product-workspace-video-actions.test.tsx`：单元级可访问名称和焦点回归。
- `e2e/display-area.spec.ts:CASE-07 version comparison`：真实页面键盘跳转与两个播放器控件名称验证。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:439-443`、`docs/specs/ui/video-artifact-browse-and-edit-states.md:49-59,160-165`、`docs/specs/ui/prototypes/current/screens/workspace-video.html:749-750`：对比模式的焦点交接和播放器语义契约。

## 具体改法

1. 把对比分镜列表设为可程序化聚焦目标。点击首屏入口时滚动到列表并把焦点交给带明确名称的列表区域；提供清楚的 `:focus-visible` 提示，键盘用户能确认跳转落点。差异按钮继续保持点击后焦点移至播放器组的既有规则。
2. 将播放器根容器暴露为带版本名称的语义分组。播放/暂停按钮与进度滑块可访问名称均包含调用方传入的播放器标签，例如“修改前 · v1 播放视频”和“修改后 · v2 播放进度”。单视频浏览调用方也沿用相同规则。
3. 补单元测试和真实页面 E2E，验证键盘 Enter 跳转后焦点落在列表、两个版本的播放键/滑块名称各自明确、差异选择仍把焦点送回播放器组。
4. 更新设计说明、浏览态规格和当前原型脚本，使约定与实现一致。

## 风险与取舍

- 对列表区域使用 `tabIndex=-1` 仅允许程序化聚焦，不新增额外 Tab 停靠点；列表内按钮仍按自然顺序访问。
- 播放器控件名称变化会同时改善普通浏览态的读屏语义；应检查所有 `VideoPreviewPlayer` 调用方传入的 label 是否自然、唯一。
- 不修改视频加载、播放策略、视觉外壳和媒体数据；不连接生产数据。

## 验证方式

- 先补失败测试：聚焦“查看受影响分镜”后按 Enter，焦点必须到达列表区域；前后播放器分别具有带版本名的播放键和进度滑块可访问名称。
- 运行定向 Vitest、`typecheck`、`lint`、`check:video-preview-contract`、`test:product-stage-style`、`docs:check` 与 `git diff --check`。
- 用隔离的本地展示区 E2E 从真实工作台 fixture 进入版本对比，使用键盘完成跳转，验证焦点、控件可访问名称和既有分镜跳转；检查桌面和窄屏布局、浏览器错误，并将截图保存到仓库外。E2E 临时 SQLite 运行前先告知路径和清理策略，结束后清理临时数据与本任务启动的进程。

## 执行结果

- 已实现列表焦点交接与可见焦点提示；两个播放器组、播放/暂停按钮和进度滑块均以版本标签区分。
- 定向 Vitest：4 个测试文件、58 项通过；`typecheck`、`lint`、`check:video-preview-contract`、`test:product-stage-style`、`docs:check`、`git diff --check` 全部通过。
- 隔离真实页面 E2E：CASE-07 版本对比场景通过，覆盖桌面及 390×844 窄屏布局、键盘 Enter 跳转、焦点落点、两版本控件名称和分镜切换。
- 截图证据保存在仓库外：`/Users/zhangzhishu/Desktop/multimix-test-results/visual-acceptance/video-comparison-a11y-20260927/`。临时数据库及运行目录已清理，8299/3219 端口无本任务残留监听。
- 可访问名称由自动化 DOM/E2E 验证；未进行 VoiceOver/NVDA 等真实读屏器人工验收。
