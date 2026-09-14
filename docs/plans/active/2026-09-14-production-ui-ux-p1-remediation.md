# 生产 UI/UX P1 整改计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-09-14

## 背景与根因

2026-09-14 登录后生产验收确认两个公开上线前需要收口的问题：

1. 真人口播清理确认卡中的原声音轨 `radio` 命中了 `app/globals.css` 的通用 `input` 规则，被拉伸为整行宽度和 44px 高度，形成卡片中央的大蓝色圆点。根因是音轨选择器没有专属布局和原生单选框尺寸重置。
2. `video-project-preview.tsx` 只在 iframe 主动发送 ready 或 error 消息时结束“正在准备预览”。iframe 已加载但没有回传消息时，完成项目会无限停留在加载态，无法进入设计文档要求的失败说明和重试路径。

本轮保持现有视觉方向、确认语义、播放器外壳和媒体比例不变，只修复控件样式和预览恢复行为。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/globals.css:7797`：通用表单控件规则；在确认卡样式区增加音轨 radio、标签和试听布局。
- `MultiMix-Frontend/app/assets/components/confirm-card.tsx:518`：现有音轨选择结构，原则上不改数据和提交行为。
- `MultiMix-Frontend/app/assets/__tests__/confirm-card-render.test.tsx:444`：增加音轨选择器的样式契约断言。
- `MultiMix-Frontend/app/assets/components/video-project-preview.tsx:95`：增加具名就绪超时、清理和重试复位。
- `MultiMix-Frontend/app/assets/__tests__/video-project-preview.test.tsx:1`：增加无 ready/error 回报时进入失败提示的计时测试，以及 ready 到达后取消超时的回归测试。

## 具体改法

### 任务 1：修复原声音轨选择器

1. 先补失败测试，要求音轨 radio 使用专属 class，并存在限制尺寸的样式契约。
2. 为音轨列表增加独立网格布局；radio 恢复原生 16–18px 尺寸、去除通用输入框内边距和阴影。
3. 试听音频在标签内容下方占据完整可用宽度，保持标签和选中控件的视觉对应。
4. 保留现有 label 包裹、键盘选择、推荐标记和提交 payload。

### 任务 2：补齐预览超时恢复

1. 先补失败测试，使用 fake timers 验证预览在具名超时时间内没有收到 ready/error 时，显示“预览暂时无法加载，可先查看分镜”和“重新加载预览”。
2. ready 或明确 error 到达后清理计时器；切换 asset、重试和卸载时也清理旧计时器。
3. 重试继续复用现有 iframe revision 机制，不新增接口，不自动导出或生成。
4. 保持白色播放器外壳、比例、控制条和失败文案与 `video-preview-shell-contract:v1` 一致。

### 任务 3：验证、提交与生产复测

1. 运行定向 Vitest，并确认每项测试在实现前按预期失败、实现后通过。
2. 运行类型检查、ESLint、播放器视觉契约、产品展示区样式检查和隔离展示区 E2E。
3. 生成桌面确认卡、桌面播放器失败恢复、桌面成功播放器和移动端成功播放器截图。
4. 取得提交锁，仅暂存本计划和本轮实现/测试文件；验证无晚到变化后提交本地 `main`。
5. 按用户已确认范围推送 `origin/main`、部署到 Vercel 生产项目 `multimix-frontend`，再执行登录后只读生产复测。

## 风险与取舍

- 超时过短会把慢设备误判为失败；超时过长又会延续无反馈体验。使用具名常量，并允许 ready 消息在失败后通过“重新加载预览”重新建立 iframe。
- 本轮不改变编辑器预览协议，也不修改后端工程状态；只在前端缺少握手时给出恢复入口。
- 通用 `input` 规则继续服务文本输入，不做全局选择器重构，避免影响搜索、对话输入和资源表单。
- 工作区存在其他会话的未提交文件和开发占用；本轮不得修改或暂存其生产 E2E、后端合同与文档改动。

## 验证方式

- `npm --prefix MultiMix-Frontend test -- --run app/assets/__tests__/confirm-card-render.test.tsx app/assets/__tests__/video-project-preview.test.tsx`
- `npm --prefix MultiMix-Frontend run typecheck`
- `npm --prefix MultiMix-Frontend run lint`
- `npm --prefix MultiMix-Frontend run check:video-preview-contract`
- `npm --prefix MultiMix-Frontend run test:product-stage-style`
- `npm --prefix MultiMix-Frontend run test:display-coverage`
- 登录后生产只读检查：音轨 radio 尺寸、预览超时失败提示、重试入口、成功视频、确认弹窗取消、390px 横向溢出。

## 进度

- [x] 任务 1：原声音轨选择器修复
- [x] 任务 2：预览超时恢复
- [ ] 任务 3：验证、提交、部署与生产复测
