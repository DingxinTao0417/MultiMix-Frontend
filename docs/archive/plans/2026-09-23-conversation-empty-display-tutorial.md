# 对话中无产物展示区：创作扫盲层

> Status: archived
> Owner: frontend
> Last verified: 2026-09-23

## 背景与根因

已有项目的对话正在推进、但当前没有可选中产物时，`assets-workspace-client.tsx:3461` 复用 `EmptyProductWorkspace`。该组件此前同时服务新建页与对话空态，内容为完整三阶段起始引导，不能区分“刚新建项目”和“用户已在持续对话但尚无结果”的语境。

前一版探索曾尝试把目标、资料与待确认事项并列成多张数据卡，但这会让右侧像状态仪表盘，也容易在没有可靠结构化数据时冒充理解结论。用户已确认对话空态应承担教程/扫盲作用，而非展示上下文摘要。

## 目标与范围

- 仅在已存在对话、`selectedProduct` 为空时，把右侧展示区改为安静的“创作扫盲层”；新建项目的创作起点保持不变。
- 画面只包含一个抽象画布、一个三步路径与一句当前教程提示；不显示用户文本回显、素材数量、进度百分比、待办看板、按钮或第二输入入口。
- 教程提示只消费确定性的界面状态：待确认计划、已明确带入资料、一般需求澄清；不从聊天文字、标题或文件名猜测用户意图。
- 不改后端 API、对话编排、确认卡、任务状态或产物选择逻辑。

## 涉及文件与关键行

- `app/assets/lib/conversation-empty-display-tutorial.ts`：集中定义确定性阶段优先级和对应教程内容，供容器与展示组件复用；不消费消息正文。
- `app/assets/components/assets-workspace-client.tsx:858`、`3461`：依据当前会话的结构化确认计划和显式资料上下文，向空展示组件传递有限教程阶段；新建页显式使用起始变体。
- `app/assets/components/product-workspace.tsx:164`：将空展示组件拆为 `start` 与 `conversation` 两种表现，消费统一阶段内容；对话变体不读取或显示消息正文。
- `app/globals.css:1152`、`4236`：为对话教程变体增加限定样式和当前步骤高亮，保留新建变体既有视觉与窄屏行为，不能影响真实产品、视频播放器或滚动面。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:363`：沉淀“无当前产物时的右侧教程层”规则和禁止项。
- `app/assets/__tests__/display-area-cases.test.tsx`：覆盖三种确定性教程状态、无用户回显/操作和新建变体未回归。
- `e2e/display-area.spec.ts`：复跑既有新建页空态浏览器验证与桌面截图，保证本次拆分变体不影响已确认的创作起点。

## 具体改法

1. 定义三种对话教程阶段：
   - `brief`：默认，说明“先说清给谁看、想达到什么效果”；
   - `materials`：当前对话存在显式上下文资料，说明资料会优先作为内容和画面依据；
   - `confirmation`：当前会话有状态为 `pending`、`awaiting_confirmation` 或 `awaiting_selection` 的结构化计划，说明确认关键选择可减少返工。
   优先级为确认 > 资料 > 默认需求。
2. 新建页传 `variant="start"`，保持现有“创作起点”文案和画面；已有对话的 `selectedProduct === null` 传 `variant="conversation"` 与确定性阶段。
3. 对话变体使用统一标题、单句提示、三步路径和抽象画布；只高亮对应步骤。所有视觉画布均 `aria-hidden`，可访问文本用明确标题、路径列表和“本轮提示”表达。
4. 不根据消息文本生成摘要，也不把当前资料、确认卡或下一步建议复制到右侧。所有确认、建议、输入和恢复动作仍留在对话列。
5. 为阶段选择与渲染写单测；运行类型、文档、真实隔离浏览器验证并截图。若 E2E 需要一次性数据库，使用 display-coverage 运行目录，并在执行前告知路径、用途和清理策略。

## 风险与取舍

- 右侧若展示聊天内容或“已理解”的总结，会与对话列重复并夸大前端可知事实；本次只解释流程，不总结用户。
- 对话中已有真实产物、执行进度、确认卡或失败恢复时，现有真实展示/卡片优先，本教程层不覆盖它们。
- 教程阶段只是 UI 提示，不得被用于路由、生成、确认、素材匹配或任何后端判断。

## 验证方式

1. Vitest：验证确认/资料/默认三种阶段的准确文案与高亮步骤，验证不存在用户文本、素材数量、按钮或假进度；验证新建变体不回归。
2. 运行 `npm run typecheck`、`npm run docs:check` 和相关 display-area E2E。
3. 若启动 display-coverage，使用 `~/Desktop/multimix-test-results/e2e-runtime/display-coverage/conversation-empty-display-tutorial-20260923/runtime.sqlite3`；完成后自动删除运行目录及 SQLite，并停止本次 8493/3493 进程，绝不连接 Supabase 或占用 3117/3200。

## 实施结果

- 已新增 `conversation-empty-display-tutorial.ts`，把“待确认计划 → 已带入资料 → 普通澄清”收敛为确定性优先级；教程内容不读取消息正文。
- `EmptyProductWorkspace` 现区分新建会话的 `start` 与已有对话无产物时的 `conversation` 变体。对话变体仅显示一个抽象画布、三步创作路径和一句“本轮提示”，没有按钮、输入框、资料统计、假进度或聊天回显。
- 已在工作台设计文档中固定该展示边界，并以 Vitest 覆盖三个教程状态、无伪造信息与新建变体；2026-09-23 通过相关 Vitest 109 项、`npm run typecheck`、`npm run docs:check` 和隔离 display-coverage E2E（1 项）。本次运行的 SQLite 和 8493/3493 进程均已清理。
