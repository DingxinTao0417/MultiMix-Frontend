# 嵌入式剪辑器就绪握手修复

> Status: archived
> Owner: frontend
> Last verified: 2026-08-01

## 背景与根因

视频工作台通过 iframe 嵌入预览和导出剪辑器。子页面只在初始化完成时单次发送
`multimix-editor-ready`。当该消息早于工作台的 `message` 监听器注册时，子页面实际已经
可用，但工作台会永久显示“正在准备工程预览”或“正在准备编辑器”，导出无法继续。

护肤素材包工程（资产 802）复现了该竞态：两个 iframe 都已经渲染出剪辑器内容，但父页没有
收到初始就绪消息。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/editor/EditorView.tsx`：嵌入页接收父页同步命令、发布 ready 与预览状态。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`：工作台 iframe 加载后请求子页回报当前状态。
- `MultiMix-Frontend/app/assets/__tests__/video-project-preview.test.tsx`：预览握手的组件回归测试。
- `MultiMix-Frontend/app/assets/__tests__/display-area-cases.test.tsx`：导出剪辑器握手的组件回归测试。

## 具体改法

1. 父页在每个嵌入式 iframe 的 `load` 后发送一个显式的状态同步命令，而不依赖子页的首次主动通知。
2. 子页收到同步命令时：若已 ready，重新发送 `multimix-editor-ready`；预览模式同时发送当前播放状态。
3. 子页在 ready 后短周期重发 ready，直到收到父页确认；这覆盖父页请求本身也早于子页监听器注册的双向竞态。
4. 父页收到任何合法的预览状态时，也将该 iframe 标记为 ready，作为消息顺序变化时的兼容确认。
5. 嵌入式导出在 MP4 校验通过后，调用与完整剪辑器相同的项目 MP4 保存接口；下载按钮只作为已保存产物的本地副本，不再替代持久化。
4. 为“初始 ready 已丢失、随后同步恢复”补回归测试；不按资产、素材类型或单个对话添加分支。

## 风险与取舍

- 同步命令可能在加载过程早期到达；子页仅在 `state === ready` 时回报，因此不会伪造完成。
- 重复 ready 消息是幂等状态确认，父页确认后即停止，不会触发重复导出或重新保存。
- 保存仅发生在已通过导出校验后；若保存失败，成片不宣告成功且保留准确错误信息。
- 保持现有 `origin`、资产 ID 和预览 channel 三重校验，不放宽 iframe 消息来源。

## 验证方式

1. 前端组件测试覆盖丢失首次 ready 后由同步命令恢复的预览及导出场景。
2. 运行目标前端测试和类型/静态检查（按变更范围）。
3. 在已登录浏览器中重新打开护肤工程，确认工作台取消加载遮罩，导出并保存 MP4。

## 执行记录

- 已实现可确认的嵌入式 ready 握手、预览确认和导出后的 MP4 保存。
- `video-browse-contract.test.ts`、`typecheck`、视频预览契约和展示区样式契约均通过。
- 已登录浏览器以完整剪辑器复核护肤工程并成功保存线上 MP4；嵌入式浏览器消息通道仍需在后续浏览器 E2E 中单独覆盖。
