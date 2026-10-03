# 产物门控工作台：无产物只显示对话

> Status: active-plan
> Owner: frontend
> Last verified: 2026-09-25

## 背景与根因

MultiMix 的提示词推荐本质上是在帮助用户完成下一轮对话，应当跟随 Agent 回复、确认卡、失败卡或输入框出现。此前让右侧无产物展示区承担教程或提示词启发，会形成第二套交互心智，也会把“尚未生成任何作品”误画成一个需要被填满的产品区域。

本轮确认新的产品边界：左侧对话负责表达、追问、确认、推荐和恢复；右侧只负责展示已经生成的真实产物。新建项目或已有对话尚无真实产物时，不渲染空展示区，主工作区改为单栏对话。

## 涉及文件与关键位置

- `app/assets/components/assets-workspace-client.tsx`：工作台布局模式、分隔线及产物区的渲染门槛。
- `app/globals.css`：无产物单栏模式的宽度、居中与响应式规则；删除废弃的右侧教程样式。
- `app/assets/components/product-workspace.tsx`：移除不再使用的空产物展示组件。
- `app/assets/lib/conversation-empty-display-tutorial.ts`：删除已失去产品入口的右侧教程投影。
- `app/assets/__tests__/display-area-cases.test.tsx`：删除旧空展示区断言，保留真实产物展示矩阵。
- `app/assets/__tests__/runtime-write-capability-gating.test.tsx`：验证新建项目无展示区、无分隔线并进入单栏模式。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md`：把“无产物展示教程”改为“无产物单栏对话”的现行规则。

## 具体改法

1. 以 `selectedProduct !== null` 作为展示区唯一前端门槛；上传素材、等待确认、生成进度或对话轮次本身都不创建展示区。
2. 新建项目和已有但无产物的项目统一使用 `conversation-only-mode`：只渲染 `ConversationStart` 或 `ConversationStudio`，不渲染空产物组件和纵向分隔线。
3. 单栏对话占据主工作区，但把实际聊天表面限制在舒适阅读宽度并居中，避免把消息横向拉满。
4. 首个真实产物进入 `selectedProduct` 后，恢复现有对话 + 分隔线 + `ProductWorkspace` 双栏，不改变产物播放器、编导稿或分镜的既有视觉合同。
5. 提示词推荐继续使用 `ConversationStudio` 已有的 `suggestions` / `suggestionActions` 和 `fill_composer` 行为；新建页继续使用 `ConversationStart` 的对话建议。本轮不新增推荐接口或模型逻辑。

## 风险与取舍

- 产物首次出现时布局会从单栏切换为双栏；使用现有工作台过渡，避免引入遮罩或中间占位状态。
- 对话区若无限拉宽会降低可读性，因此只放大工作区域，聊天表面仍保持最大宽度。
- 对话详情尚未加载但摘要已恢复真实产物时，继续允许右侧只读产物出现；是否显示展示区仍取决于已有产物，而不是加载状态。
- 删除右侧教程后，教育职责完全回到对话建议；若服务端没有返回建议，不用静态右栏兜底伪造推荐。

## 验证方式

1. 单元/组件测试：新建项目无“创作起点”展示区、无分隔线，工作台使用单栏模式；真实产物展示矩阵保持通过。
2. 对话测试：已有 `suggestions` / `suggestionActions` 仍显示在 Agent 回复下方，并继续带入输入框。
3. 样式契约：桌面单栏对话居中且不横向拉满；窄屏不产生横向溢出；现有视频预览合同不变。
4. 运行 `npm run typecheck`、相关 Vitest、`npm run docs:check` 与 `git diff --check`。

## 实施与验证结果

- 新建项目与已有无产物项目统一进入 `conversation-only-mode`；DOM 中只有对话表面，不存在空产物区或“调整对话和展示区宽度”分隔线。
- 有真实产物的项目继续使用 `conversation-mode`，保留现有分隔线与 `ProductWorkspace`，没有修改播放器或产物展示合同。
- Agent 消息中的推荐表达继续通过既有 `suggestions` / `suggestionActions` 渲染；组件测试已验证点击后只填入当前输入框。
- Chromium 在 `1440×900` 和 `390×844` 验证新建项目：工作台均为单栏、只有一个直接子节点、无空展示区、无分隔线、无横向溢出和控制台错误。
- `npm run typecheck`、`npm run lint`、相关 Vitest（58 项）、`npm run test:product-stage-style`、`npm run check:video-preview-contract`、`npm run docs:check` 与 `git diff --check` 通过。
- `npm run test:display-coverage` 的 40 项组件测试通过；隔离 E2E 夹具因本机 Python 环境缺少完整依赖而未启动。系统 Python 缺少 `redis`，项目 `.venv` 缺少 `sqlalchemy`，`uv run` 又受 `openai-whisper` 构建依赖缺失阻塞。本轮未临时安装依赖；三次测试生成的一次性 SQLite 与产物目录均已通过 `e2e:cleanup` 清理。
