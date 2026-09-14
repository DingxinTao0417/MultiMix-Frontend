# MultiMix 公开上线 UI/UX 收口实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-14

> **For agentic workers:** REQUIRED SUB-SKILL: use `executing-plans` to implement this plan task by task. This workspace forbids Subagents without separate user approval, so implementation stays in the current session.

**Goal:** 在保留现有三栏工作台、暖白品牌语言和视频播放器契约的前提下，统一菜单、对话与展示区的层级和反馈，使桌面端达到公开上线所需的清晰度、一致性与可恢复性。

**Architecture:** 不重做信息架构。把共用的确认交互、状态语义和视觉 token 收敛为小型公共组件与公共样式；页面组件只提供对象名称、影响说明和动作回调。导航搜索只筛选已加载项目，不引入新的服务端搜索接口；展示区根据已知创作意图输出阶段化空态。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest、Testing Library、现有 CSS token 与 Lucide 图标。

## 背景与根因

2026-09-14 公开上线 UI/UX 评审确认了 11 项问题，证据见 `MultiMix-Backend/docs/qa/2026-09-14-ui-ux-public-launch-review.md`。根因不是单个页面配色，而是后续功能分别增加了按钮、状态、空态与浏览器原生确认，组件语义没有一起收口；早期设计文档对“完成态是否保留渐变”等规则也存在冲突。

用户已批准以下方向：

- 桌面端先完成完整创作流程；手机端本轮只保证登录、查看结果与基础导航可用，不扩成完整移动剪辑器。
- 已确认卡改为中性摘要；普通选中态使用单色；渐变集中在待确认和 AI 活动态。
- 继续沿用对话驱动创作、四个资源库、右侧单作品展示和现有播放器外壳。

## Global Constraints

- 播放器继续使用白色外壳、`1px solid #eae7e1`、`20px` 圆角、`7px` 内边距、双层阴影、`44px` 播放按钮、`16px` 图标和 `3px` 渐变进度轨。
- 不改变视频比例、素材引用、生成确认、费用或历史版本保护等业务契约。
- 普通用户界面不得出现环境变量名、组件名、Provider、内部候选 ID 或实现状态名。
- 必要正文和操作文字在白底达到至少 4.5:1；浅灰仅用于非必要辅助信息。
- 不伪造资源缩略图、生成进度、作品预览或状态；缺少真实媒体 URL 时使用内容类型图标。
- 不新增一级文案/图片/视频切换，不修改后端 API 或数据库。
- 正式法律文本、协议版本和同意记录继续由跨端计划 `MultiMix-Backend/docs/plans/active/2026-09-13-billing-payment-and-credit-readiness.md` 负责；本计划不创建未经法务或经营负责人确认的协议内容。
- 不自动提交、合并、推送或部署。

## 文件边界

- `app/components/confirmation-dialog.tsx`：应用内确认弹窗，只负责焦点、取消与明确确认。
- `app/multimix-app.tsx`、`app/styles/login-shell.css`：注册成功/失败分离与登录可读性。
- `app/assets/components/assets-workspace-client.tsx`：项目搜索与公开故障文案。
- `app/assets/components/conversation-studio.tsx`：项目资源入口的图标、数量与可点击表达。
- `app/assets/components/project-resources-drawer.tsx`：资源层级、图标行和应用内确认。
- `app/assets/components/library-workshop.tsx`、`app/assets/components/product-workspace.tsx`、`app/editor/VoiceoverEditor.tsx`、`app/editor/FilmStrip.tsx`：把删除、放弃修改、全片换声和覆盖式重组确认接入同一应用弹窗。
- `app/assets/components/confirm-card.tsx`：参数字段去重与完成态摘要。
- `app/assets/components/product-workspace.tsx`：阶段化空态、完整标题提示和展示区公开文案。
- `app/assets/components/library-workspace-state.tsx`、`app/assets/components/generated-image-gallery.tsx`、`app/assets/lib/runtime-write-capabilities.ts`：移除工程语言。
- `app/assets/components/library-workshop.tsx`：将未连接状态中的环境变量说明改为用户可执行提示。
- `app/globals.css`：上述组件的公共视觉规则；不触碰受保护的播放器选择器。
- `docs/specs/ui/agentic-workbench-design.md`、当前工作台原型：同步已批准的完成态与渐变纪律。
- `CLAUDE.md`、`AGENTS.md`：将旧视频库分类同步为当前权威的单一“视频工程”分类；`AGENTS.md` 由同步脚本生成。
- `scripts/run-display-coverage.mjs`：将脚本解析后的隔离端口显式传给 Playwright，避免默认端口运行到最终 API 断言时得到 `undefined` URL。

## Task 1：固化公共状态与文案契约

**Files:**

- Modify: `app/assets/__tests__/agent-ui-copy.test.ts`
- Modify: `app/assets/__tests__/confirm-card-render.test.tsx`
- Modify: `app/assets/__tests__/library-workspace-state.test.tsx`
- Modify: `app/assets/__tests__/runtime-write-capability-gating.test.tsx`
- Modify: `app/assets/__tests__/product-stage-style-contract.test.ts`

**Produces:** 对注册通知、公开故障文案、确认卡去重、完成态中性边框、展示区两行 header 和项目搜索建立失败测试。

- [x] 在静态文案测试中禁止 `NEXT_PUBLIC_API_BASE_URL`、`资源库组件`、`冻结的对应关系` 和展示区 `Markdown /`。
- [x] 在确认卡渲染测试中断言待确认参数的比例、时长和配音各只有一处可见当前值，确认后只保留紧凑摘要。
- [x] 在样式契约测试中断言 `.confirmed` 使用中性边框和无渐变背景，待确认卡继续使用 AI 渐变。
- [x] 运行聚焦测试并确认旧实现失败：`npm --prefix MultiMix-Frontend exec vitest run app/assets/__tests__/agent-ui-copy.test.ts app/assets/__tests__/confirm-card-render.test.tsx app/assets/__tests__/library-workspace-state.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx app/assets/__tests__/product-stage-style-contract.test.ts`。

## Task 2：修复公开入口与公开文案

**Files:**

- Modify: `app/multimix-app.tsx:250-400`
- Modify: `app/styles/login-shell.css:50-170`
- Modify: `app/assets/lib/runtime-write-capabilities.ts:31-63`
- Modify: `app/assets/components/assets-workspace-client.tsx:2940-2980`
- Modify: `app/assets/components/library-workspace-state.tsx:40-55`
- Modify: `app/assets/components/library-workshop.tsx:805-825`
- Modify: `app/assets/components/generated-image-gallery.tsx:185-205`

**Produces:** 成功、错误和恢复提示互不混用；普通界面只告诉用户发生了什么与下一步。

- [x] 注册需要邮箱验证时清空密码、切回登录态并通过 `role=status` 展示成功通知，不再写入错误状态。
- [x] 将登录说明、忘记密码和底部必要文字提升到可读文字色，并补充键盘 focus 样式。
- [x] 将未连接、加载失败与图片应用提示改成用户语言，保留重试或联系管理员入口。
- [x] 协议入口在正式法律页面交付前明确标为尚未开放的发布依赖；不生成虚假链接或法律正文。
- [x] 运行 Task 1 的文案和登录相关测试。

## Task 3：收口项目导航、资源抽屉与确认弹窗

**Files:**

- Create: `app/components/confirmation-dialog.tsx`
- Create: `app/components/__tests__/confirmation-dialog.test.tsx`
- Modify: `app/assets/components/assets-workspace-client.tsx:600-740, 2930-3050`
- Modify: `app/assets/components/conversation-studio.tsx:1020-1055`
- Modify: `app/assets/components/project-resources-drawer.tsx`
- Modify: `app/assets/__tests__/project-resources-drawer.test.tsx`
- Modify: `app/assets/__tests__/conversation-project-resources.test.tsx`
- Modify: `app/assets/components/library-workshop.tsx`
- Modify: `app/assets/components/product-workspace.tsx`
- Modify: `app/editor/VoiceoverEditor.tsx`
- Modify: `app/editor/FilmStrip.tsx`
- Modify: `app/editor/__tests__/voiceover-editor.test.tsx`
- Modify: `app/globals.css:490-660, 3070-3300`

**Produces:** 可键盘操作的本地项目搜索、明确的项目资源入口、统一资源行和覆盖当前工作台确认场景的应用内确认。

- [x] `ConfirmationDialog` 接收 `open/title/description/confirmLabel/tone/onCancel/onConfirm/busy`，Escape 和取消不产生副作用，关闭后由调用方恢复焦点。
- [x] 项目列表加入带清除按钮的搜索框，按标题进行不区分大小写的本地筛选；无结果显示“没有找到匹配项目”。
- [x] 项目资源入口增加资源图标、总数和右箭头，并提供 hover/focus 反馈。
- [x] 抽屉分类、使用范围和“添加素材”分成三个视觉层级；资源行展示内容类型图标、标题、状态和紧凑操作。
- [x] “移出项目”和“永久删除源文件”改用应用内确认弹窗；危险动作保持红色且不降低历史引用保护。
- [x] 资产库删除、放弃未保存文案、全片换声、保护内容删除与覆盖式重组也接入同一弹窗；产品代码不再调用浏览器原生 `confirm`。
- [x] 测试取消、确认、失败、空态、有资源、长标题和搜索无结果。

## Task 4：收口对话确认卡与展示区层级

**Files:**

- Modify: `app/assets/components/confirm-card.tsx:150-450`
- Modify: `app/assets/components/product-workspace.tsx:150-185, 1360-1450`
- Modify: `app/assets/__tests__/confirm-card-render.test.tsx`
- Modify: `app/assets/__tests__/display-area-cases.test.tsx`
- Modify: `app/assets/__tests__/product-workspace-video-actions.test.tsx`
- Modify: `app/globals.css:2430-2530, 7790-7830, 8915-8980, 9330-9750`

**Produces:** 一套可编辑参数、紧凑完成摘要、可辨认标题和与当前产物类型一致的空态。

- [x] 参数确认卡在有比例/时长/配音控件时，不再先重复渲染对应摘要行；来源、费用、素材与保护信息继续显示。
- [x] 已确认卡改为中性 hairline、较小内边距和最多三行默认摘要；待确认卡和真实运行态继续使用渐变。
- [x] `EmptyProductWorkspace` 使用不要求用户重复选择产物类型的阶段提示；在后端提供权威产物意图字段前，不从自由文本猜测类型。
- [x] 展示区 header 在窄列中稳定分为标题状态行和操作行；标题保留 `title`/可访问完整文本，按钮保持现有 30px 合同。
- [x] 将 `Markdown / 待确认` 等展示信息改为“编导稿 · 待确认”等用户语义；技术详情留在详情抽屉。

## Task 5：同步设计依据与原型

**Files:**

- Modify: `docs/specs/ui/agentic-workbench-design.md:20-100`
- Modify: `docs/specs/ui/prototypes/current/screens/workspace-copy.html`
- Modify: `docs/specs/ui/prototypes/current/screens/workspace-video.html` only if shared non-player header/state markup requires it
- Modify: `docs/MULTIMIX_WORKSPACE_DESIGN.md` only where a conflicting current rule remains
- Modify: `CLAUDE.md`
- Regenerate: `AGENTS.md`

**Produces:** 一份无冲突的完成态、选中态和 AI 活动态规则；原型与实现使用同一组件语义。

- [x] 明确渐变用于待确认、生成和 AI 输入入口；完成态使用中性边框，选中态使用单色。
- [x] 明确 30px 只适用于展示区顶部紧凑操作，普通主操作继续满足舒适点击目标。
- [x] 将项目搜索、资源入口、两行作品 header、阶段化空态和中性完成卡同步到当前原型。
- [x] 不修改播放器外壳、媒体画布比例和控制条合同。
- [x] 删除 agent 指南中的旧视频子分类，以“视频工程”为唯一正式分类，并运行同步检查。
- [x] 运行 `npm --prefix MultiMix-Frontend run docs:check`、`npm --prefix MultiMix-Frontend run check:video-preview-contract` 和 `npm --prefix MultiMix-Frontend run test:product-stage-style`。

## Task 6：回归与视觉验收

**Files:**

- Create: `artifacts/qa/ui-ux-remediation-20260914/` 下的本地截图证据（不提交二进制，除非用户另行要求）
- Modify: 本计划的执行记录与勾选状态

**Produces:** 修改前后可核对的桌面端证据和残余风险清单。

- [x] 运行受影响的 Vitest 聚焦套件、`npm run typecheck`、`npm run lint`、`npm run docs:check`。
- [x] 修正隔离展示区脚本的默认端口透传并复跑失败用例；该修正只影响测试环境，不改变产品运行配置。
- [x] 运行 `check:video-preview-contract`、`test:product-stage-style` 和隔离的 `test:display-coverage`；如需启动 E2E，提前告知一次性 SQLite 路径与端口，并在 `finally` 清理。
- [x] 在 1280×720 与 1440×900 核对项目搜索、资源抽屉、确认卡、长标题、阶段化空态、错误提示和键盘焦点。
- [x] 核对手机登录与结果查看；完整移动创作和剪辑继续留在本轮范围外。
- [x] 逐项记录通过、失败和未验证内容；不得用 lint 或类型检查替代浏览器结论。

## 风险与取舍

- 项目搜索只覆盖当前已加载的项目；当前一次已加载 50 个项目，首轮足够，服务端搜索应在规模继续增长时单独设计。
- 项目资源 API 没有稳定的缩略图 URL 字段，本轮使用真实内容类型图标，不拼接或猜测媒体地址。
- 当前对话数据没有覆盖所有空态的权威产物意图字段，本轮使用与文案、图片、视频都成立的阶段提示；后续增加结构化字段后再细分空态，不从用户自由文本做关键词猜测。
- 正式协议页由计费与上线准备计划统一负责，本轮只能修成功/错误反馈和可读性；协议未上线仍是公开发布阻塞项。
- 展示区 header 改为响应式两行会增加少量高度，但能保住作品身份和操作可用性。
- 当前两仓都有用户或其他会话的未提交改动；只修改计划列出的文件，任何重叠变化都先停下核对。

## 验收标准

- 11 项评审问题中，UI-01、UI-03 至 UI-10 在本轮实现中有直接修复或验证；UI-02 的成功反馈完成，正式协议入口明确记录为外部计划依赖；UI-11 通过规范同步收口。
- 关键普通文字对比度至少 4.5:1；确认、取消、Escape、错误恢复和焦点返回有测试。
- 50 个相似项目下可按标题快速筛选；项目资源入口可辨认，抽屉层级清楚。
- 同一参数在待确认卡里只出现一次；完成卡不再表现成运行态。
- 明确提出文案、图片或视频需求后，展示区不再要求用户重新选择产物类型。
- 作品长标题在窄展示区仍可识别，操作按钮不溢出。
- 用户主界面不出现本计划禁止的工程语言。
- 受保护播放器合同检查继续通过。

## NOT in scope

- 正式服务条款、隐私政策、付费、退款和发票文本及同意版本记录：由既有计费上线计划负责，并需要法务或经营负责人确认。
- 完整移动端创作与剪辑：需要独立导航和面板切换设计。
- 全局跨库搜索、服务端项目搜索、资源缩略图 API：本轮没有必要改接口。
- 后端生成质量、支付、基础设施与生产部署：不属于本次前端 UI 收口。

## 执行记录

- 2026-09-14：用户批准推荐方向并要求开始实施；计划建立，待开发占用登记与失败测试。
- 2026-09-14：六项任务完成。注册成功改为独立成功通知；公开错误文案移除工程术语；项目搜索、项目资源入口和资源抽屉完成层级收口；浏览器原生确认全部替换为应用内确认；确认卡去重并将完成态改为中性；展示区长标题、两行操作区、阶段空态与公开元数据完成收口；当前设计规范、原型和 agent 指南已同步。
- 2026-09-14：最终验证通过：TypeScript 类型检查、ESLint、187 个聚焦 Vitest 用例、agent/docs/player 合同、product-stage style 合同，以及隔离展示区 E2E（15 passed，1 skipped）。E2E 使用的临时 SQLite 和本地进程均已清理。
- 2026-09-14：视觉证据保存在工作区 artifacts/qa/ui-ux-remediation-20260914/，覆盖 1280×720、1440×900、项目搜索、资源抽屉、390×844 结果页与登录页。正式协议页面及同意版本仍由计费上线计划负责，是公开发布前的外部依赖；完整移动剪辑不在本轮范围。
