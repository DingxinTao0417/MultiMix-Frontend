# 编辑页配乐详情入口与上下文素材替换

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-06

## 背景与根因

视频编辑页目前在加载后无条件挂载 `BgmPanel`。该组件以预览区右上角的绝对定位浮层渲染，既没有关闭入口，也遮挡预览与编辑控件。与此同时，`ReplacePanel` 的触发按钮也无条件显示；没有选中时间轴图片或视频片段时，打开后只能显示“请先选中”的无效提示。

用户已确认将配乐入口置于工作区顶部「详情」内：详情显示当前背景音乐摘要和“更换配乐”按钮，点击后打开右侧曲库抽屉，抽屉可通过明确关闭控件、Esc 或点击外部关闭。曲库仍由编辑器 iframe 承载，以复用在更新 BGM 前保存当前时间轴、更新后重载工程的既有一致性流程；外层工作区通过既有 `postMessage` 通道请求打开。

## 涉及文件与具体改法

- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`
  - 在视频工程的「详情」中增加当前 BGM 摘要和“更换配乐”按钮。
  - 仅当嵌入编辑器已就绪时向 iframe 发送 `multimix-editor-bgm-open`；未就绪时禁用并说明加载中，避免丢失操作。
- `MultiMix-Frontend/app/editor/EditorView.tsx`
  - 删除常驻浮层式 BGM 渲染；维护抽屉开关状态，并处理来自父工作区的打开消息。
  - 保持现有 `persistCurrentProject -> updateProjectBGM -> refreshMountedEditorProject` 的顺序，防止换曲覆盖未保存的时间轴编辑。
- `MultiMix-Frontend/app/editor/BgmPanel.tsx`
  - 改为受控右侧抽屉内容，接受 `open` / `onOpenChange`；保留试听、分类、关闭音乐、恢复自动和换曲行为。
  - 打开时加载曲库，关闭时停止试听；抽屉标题与关闭操作满足可访问性。
- `MultiMix-Frontend/editor-engine/vendor/ReplacePanel.tsx`
  - 仅在选中可替换的图片/视频时间轴片段时显示“替换素材”入口，避免无效入口占据预览区。
- `MultiMix-Frontend/app/editor/__tests__/bgm-panel.test.tsx`、`MultiMix-Frontend/app/editor/__tests__/editor-layout.test.ts` 及工作区展示测试
  - 先补充失败用例：BGM 默认不出现、由详情消息打开且可关闭、关闭会停止试听；未选中片段时不显示替换入口，选中后恢复显示。

## 风险与取舍

- BGM 更新会重载工程，必须继续先保存 iframe 内未保存编辑，不能改为父页直接请求接口。
- 详情是外层工作区组件、曲库在 iframe 内；用严格的同源 `postMessage` 类型和现有 ready 状态衔接，避免引入第二份 BGM 状态或接口实现。
- 不改变 BGM 曲库、选曲、授权、音轨混音或后端数据契约；本次只收敛入口与可见性。

## 验证方式

- [x] BGM 面板组件测试：关闭、停止试听、选择与恢复自动配乐回归。
- [x] 编辑页布局/消息测试：默认不显示曲库，收到详情打开消息后显示并可关闭。
- [x] 素材替换组件测试：无可替换选区时不显示入口，选中视觉片段后显示。
- [x] 运行前端相关 Vitest、`npm --prefix MultiMix-Frontend run typecheck`、`npm --prefix MultiMix-Frontend run docs:check`。
