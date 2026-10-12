# 顶栏导航（N1）与分镜批注式修改（B）实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-10-12

## 1. 背景与根因

2026-10-11 的 UI/UX 与定位契合度审查（`docs/specs/ui/prototypes/explorations/2026-10-11-uiux-positioning-review/`）确认：
已确认定位「把需求做成视频，再像给同事提意见一样把它改好」的后半句没有被界面表达。根因是两处实现：

- **逐镜修改入口默认不可见。** `app/globals.css` 曾把 `.shadcn-prototype-segment-actions` 设为
  `display: none`，只在悬停或焦点时显形。非技术商家不会猜到要悬停。（T1 已修复，未提交）
- **增量执行价值不可见。** 只重做受影响镜头的能力真实存在，但界面只说「已更新」。

侧栏方面，资源库四张卡（各 `min-height: 54px`，含卡面、阴影和彩色图标底座）是侧栏最抢眼的区域，
但资源库只是查找与复用工具。用户最终选择不做弱化，而是**整体移除左侧常驻导航**。

审查中「版本对比埋得过深」一项，实施时复核撤回：入口本已常驻在浏览态顶部，出现条件正确。

## 2. 已确认的决策

见 `docs/specs/ui/agentic-workbench-design.md` 第 10 节决策 10、11。要点：

- **N1**：移除桌面 264px 常驻侧栏，工作区改全宽双栏。导航改为页面头部常驻「当前项目名 ▾」，
  点击打开浮层面板。切换器显示需处理项目数。AI 后台状态迁入头部右侧。⌘K / Ctrl+K 打开同一面板。
- **B**：分镜卡动作常驻；新增「说这镜」绑定对话焦点；可核对时显示重做 / 复用范围。

**未获批准、本计划不执行：** 品牌 mark 改单色（决策 12，待确认）；操作系统级独立窗口。

## 3. 现有架构与复用点

实施前已核实，以下能力**已存在**，本计划复用而不重造：

| 能力 | 位置 | 本计划如何复用 |
| --- | --- | --- |
| 导航触发器注入三个页面头部 | `assets-workspace-client.tsx:3879` `navigationSlot`，注入 `conversation-studio.tsx:1287`、`conversation-start.tsx:264`、库顶栏 `:4303` | 把 slot 内容从「展开侧边栏」图标换成项目切换器，三个页面同时生效 |
| 浮层导航的遮罩、Escape、焦点隔离、焦点归还 | `:897–912` `narrowNavigationOpen` + `useDialogFocusManagement`；`globals.css` `@media (max-width:1180px)` 内 `.shadcn-prototype-navigation-surface[role="dialog"]` | 去掉 `isNarrowViewport` 限定，桌面同样走浮层 |
| 项目状态数据 | 后端 `project_state.code`，前端 `conversation.projectState`（`asset-workspace-adapter.ts:1120`） | 直接计数，后端无需改动 |
| 分镜焦点随消息发给后端 | `:865` `clickedSceneFocus`，`:3145` 发送时带 `selectedSceneId`，`:4517` 点分镜卡时设置 | 「说这镜」复用同一状态，后端接口无需改动 |
| 输入框预填 | `conversation-studio.tsx:1090` 监听 `multimix:composer-prepare` 事件 | 「说这镜」派发该事件预填文案 |
| 两版分镜差异计算 | `video-version-comparison.ts` `compareVideoVersionSegments` | 复用范围在其上确定性推导 |

**结论：本计划全部为前端工作，后端接口与数据契约不变。**

## 4. 任务分解

总 7 项。T2 已撤回。

### T1 分镜卡动作常驻 ✅（已完成，提交 A）

- `app/globals.css`：动作条改常驻；新增 `button.annotate` 及 `.active` 态；文字列预留 `padding-right: 232px`。
- `app/assets/components/segment-cards.tsx`：新增 `annotatingId` / `onAnnotate` props 与「说这镜」按钮。
- 已验证：typecheck、lint、`check:video-preview-contract`、`test:product-stage-style`。

### T3 复用范围条 ✅（已完成，提交 A）

- ✅ `app/assets/lib/video-version-comparison.ts`：`videoVersionReuseScope()`，无变化或任一侧无分镜时返回 `null`。
- ✅ 4 项测试，该文件 21 项全通过。
- ✅ `product-preview.tsx` 浏览态在播放器与分镜摘要之间渲染范围条，无可信依据时不渲染。

### T4 「说这镜」焦点绑定 ✅（已完成，提交 B `60c6c49`、`40321c7`）

**实际做法与原设计的差异：** 没有在发送后统一清除普通「点分镜跳转」设置的焦点，而是新增一个只记录「说这镜」的绑定状态，只解除它。普通点分镜卡的现有行为保持不变，避免改动已依赖它的流程。绑定在后端接受消息、手动清除、切换项目或产物时解除。`segment-annotation.test.tsx` 共 4 项，其中切换解除用例在去掉解除逻辑时会失败。


**改法：**

1. `product-preview.tsx` 浏览态的 `<SegmentCards>` 传入 `onAnnotate` 与 `annotatingId`，
   向上透传到 `product-workspace.tsx`，再到 `assets-workspace-client.tsx`。
2. 在 `assets-workspace-client.tsx` 处理 `onAnnotate`：
   - 调用 `setClickedSceneFocus`，与现有 `onSelectSegment`（`:4517`）写入同一状态。
   - 派发 `multimix:composer-prepare`，`utterance` 为「第 N 镜：」，让用户接着写。
3. `annotatingId` 由 `clickedSceneFocus[displayProduct.backendAssetId]?.sceneId` 推导，不新建状态。
4. 输入框上方显示「正在说第 N 镜 ×」提示条，点 × 清除焦点。
5. **解除规则：**
   - 发送后：在 `:3325` 附近发送成功分支删除 `clickedSceneFocus[selectedBackendAssetId]`。
   - 产物更新：已有，`:4467`。
   - 切换产物 / 切换项目：在对应 handler 中删除。
   - 手动：提示条的 ×。

**风险：** 发送后清除焦点是**行为变更**。现状是点分镜卡设置的焦点会在发送后保留。
需先写测试锁定现状，再判断：普通点分镜卡（跳转预览）的焦点是否也应在发送后清除。
倾向于统一清除，避免「上一句改了第 2 镜，下一句全片修改仍被绑在第 2 镜」。
若测试显示现有行为是被依赖的，改为只清除「说这镜」触发的焦点，并在本文档记录取舍。

**测试：** 新增 `segment-annotation.test.tsx`
- 点「说这镜」后输入框值为「第 N 镜：」，提示条出现，按钮 `aria-pressed=true`。
- 发送时请求带 `selected_scene_id`。
- 发送后、切换产物、点 × 后提示条消失，下一次发送不带 `selected_scene_id`。
- 无写入能力时（`canGenerate=false`）不显示「说这镜」。

### T5 项目切换器与浮层面板 ✅（提交 C `06d5313`）

**改法：**

1. 新建 `app/assets/components/project-switcher.tsx`：
   - 按钮：当前项目名（无项目时为「新建项目」）+ `▾` + 角标。
   - 角标数 = `conversations.filter((c) => projectListStateLabel(c.projectState) !== null).length`。
     直接复用 `assets-workspace-client.tsx:173` 的 `PROJECT_LIST_STATE_LABELS`
     （`script_review` 待确认、`generating` 生成中、`needs_attention` 需处理），
     保证角标与列表里显示状态文字的项目完全一致，不另写一套枚举判断。为 0 不渲染。
   - 角标的无障碍名称：「N 个项目需要处理」。
2. `navigationSlot`（`:3879`）在所有视口都渲染 `<ProjectSwitcher>`，不再只在窄屏渲染。
3. 浮层面板内容：复用现有 `<aside>` 内的新建项目按钮、项目搜索、最近项目列表、资源库入口，
   **不复制一份**，而是让同一个 `<aside>` 只以浮层形态出现。
4. 资源库四项改为文字行，去掉彩色图标底座与卡面阴影。
5. 账户区（头像、创作档案、退出登录）保留在面板底部。

**测试：** 更新 `sidebar-project-navigation.test.tsx`
- 删除「libraries as the approved two-column utility grid」断言（`:31`），改为文字行断言。
- 新增：角标数与需处理项目数一致；为 0 时不存在。
- 保留：最近 8 条、搜索覆盖全集、三种状态文字。

### T6 AI 后台状态迁入头部与 ⌘K ✅（提交 C `06d5313`）

1. `<AiBackgroundStatus>`（`:4282`）从 `<aside>` 移到三个页面头部右侧，无任务时整条隐藏。
   紧凑形态：「● AI 后台工作中」胶囊，点击展开现有说明文字。
2. 全局监听 `keydown`：`(event.metaKey || event.ctrlKey) && event.key === "k"` 打开面板。
   输入框、文本域内也生效，但须 `preventDefault` 防止浏览器默认行为。
3. 面板打开时聚焦搜索框。

**测试：** ⌘K 与 Ctrl+K 均能打开；Escape 关闭后焦点回到触发前的元素。

### T7 移除左侧常驻导航 ✅（提交 C `06d5313`；浏览器验收与截图基线 `d7ca0c8`）

1. `globals.css:146` 外壳 `grid-template-columns: 264px minmax(0,1fr)` 改为 `minmax(0,1fr)`。
2. 删除 `sidebar-collapsed`、`sidebar-expanded` 在桌面上的布局规则与 52px 折叠轨（`:4000` 起）。
   折叠轨整体退役，不留开关。
3. `@media (max-width:1180px)` 内的浮层规则提升为全局规则。
4. `isNarrowViewport` 仅保留给仍需区分宽窄的逻辑（如对话区宽度），不再控制导航形态。
5. 删除 `sidebarState` 中只服务于常驻栏的 `"collapsed"` 分支及其持久化。
6. 清理只被常驻栏使用的 CSS 选择器，按旧逻辑退役规则同轮删除，不留死代码。

**风险：** 这是本计划影响最大的一步。`product-draft-navigation.test.tsx` 已锁定
「未保存草稿时切换项目要确认」与「拒绝离开时恢复导航」，必须保持通过。

**测试：**
- `product-draft-navigation.test.tsx` 全部通过。
- 新增：桌面宽度下不存在常驻 `aside`，工作区占满宽度。
- 1280–1920px 无横向溢出。

### T8 同步文档、原型与截图基线 ✅（提交 D）

1. `docs/MULTIMIX_WORKSPACE_DESIGN.md` 第 3、4 节改写为新结构，删除顶部「方向变更」提示。
2. `docs/specs/ui/agentic-workbench-design.md` 第 4、5.1 节改写，决策 10、11 的「实施中」改为已落地。
3. `docs/specs/ui/prototypes/current/screens/` 七屏中含侧栏的全部更新：
   start、workspace-copy、workspace-video、library、editor、admin-sources。login 不含侧栏，不改。
4. 截图基线：`e2e/display-area.spec.ts-snapshots/` 现有 6 张均为播放器外壳截图，
   本计划不改播放器，**预期不需要更新**。若因页面宽度变化导致差异，先确认是布局正常变宽而非外壳变化，
   再用 `--update-snapshots` 更新，并在本文档记录原因。
5. `npm run docs:check`。

## 5. 执行顺序与提交切分

| 顺序 | 任务 | 提交 | 理由 |
| --- | --- | --- | --- |
| 1 | T1 + T3 | 提交 A | 风险低、已基本完成、独立可用 |
| 2 | T4 | 提交 B | 引入新交互，单独可回滚 |
| 3 | T5 + T6 + T7 | 提交 C | 三项改的是同一个导航外壳；分开提交会让外壳先后出现「侧栏 + 切换器并存」等中间形态，没有可独立验收的意义。合并为一次结构改动，单独可回滚 |
| 4 | T8 | 提交 D | 文档与原型收口 |

每个提交前跑第 6 节的检查。按根 `AGENTS.md`「任务分支与合并门禁」与前端「提交代码」流程执行：用 `task -- start` 建立的任务 worktree 内窄路径暂存并提交，提交无需加锁；全部完成后用 `task -- finish --token <token>` 快进合入本地 `main`，不推送。

## 6. 验证方式

**每次提交前：**

```bash
npm --prefix MultiMix-Frontend run typecheck
npm --prefix MultiMix-Frontend run lint
npm --prefix MultiMix-Frontend run test
npm --prefix MultiMix-Frontend run check:video-preview-contract
npm --prefix MultiMix-Frontend run test:product-stage-style
```

**提交 C、D 前追加：**

```bash
npm --prefix MultiMix-Frontend run test:display-coverage
npm --prefix MultiMix-Frontend run docs:check
```

`test:display-coverage` 使用独立端口 8299 / 3219 与一次性 SQLite，执行前需告知用户临时库路径，结束后清理。

**测试层级：** 全程 L1 / L2，不涉及付费链路。

**全量测试基线：** 工作区存在非本任务的脏文件，全量 `npm run test` 可能出现非本任务失败。
每次失败先在干净基线复现，确认是否由本任务引起，再处理。**禁止用共享 stash 栈做二分定位**，
改用 `git diff > patch` 与 `git checkout -- <file>`。

## 7. 风险与取舍

- **被动感知损失。** 项目状态不再扫一眼可见，角标只告诉「有 N 件」，不告诉是哪几件。用户选型时已知悉。
- **换项目从 1 次点击变 2 次。** ⌘K 部分抵消。
- **T4 发送后清除焦点是行为变更。** 处理方式见 T4。
- **T7 删除折叠轨与 `sidebarState` 持久化。** 用户若曾设置折叠偏好，升级后失效且无需迁移，因为常驻栏已不存在。
- **与主工作区隔离。** 本任务在独立分支与 worktree 中开发，见交接文档第 1 节。
  主工作区里视频清晰度任务对 `product-preview.tsx`、`video-version-comparison.ts` 等文件的在途改动，
  与本分支互不干扰；合并回 `main` 时若同一文件出现冲突，在本分支按 hunk 解决，不得覆盖对方改动。
- **不得靠调淡文字实现弱化。** 正文对比度 ≥ 4.5:1。
- **播放器外壳合同 v1 不受影响**，严禁顺带改动。

## 8. 开工方式

2026-10-12 提交流程改造上线后，本任务按新流程重新开工：

1. 本计划先单独提交到前端 `main`，因为 `task -- start` 要求计划文件已在主目录可见。
2. 用 `task -- start` 登记占用并建立 worktree `MultiMix-Frontend/.worktrees/<task>` 与分支 `claude/<task>`，
   功能区取固定清单中的 `workspace-shell` 与 `video-editor`。
3. 把旧手工 worktree `.worktrees/topbar-nav` 中已完成、未提交的 T1、T3 改动迁入新 worktree，
   旧 worktree 与其空分支 `claude/topbar-nav-segment-annotation-20261011`（无任何提交）随后删除。
4. 迁入后合并最新 `main`，按 `add90aa` 后的新文档结构重写两份设计文档中的决策记录。

## 9. 范围外

- 品牌 mark 改单色（待确认）。
- 操作系统级独立窗口。
- 手机端完整创作流程（用户确认桌面优先，窄屏仅保证可看）。
- 资源库四库页面本身的浏览体验。
- 生成态极光、打字光标、实时引用亮框。

## 10. 完成结果（2026-10-12）

- 全部 7 项完成（T2 复核后撤回）。提交：`8870b48` 计划，`91a4a10` T1+T3，`60c6c49`、`40321c7` T4，`06d5313` T5–T7，`d7ca0c8` 浏览器测试与截图基线，提交 D 文档与原型。
- **与原设计的偏离，均已在执行中确认：**
  - T4 只解除「说这镜」自身的绑定，普通点分镜卡跳转的既有焦点行为不变。
  - T5–T7 合并为一次提交：三项改的是同一个导航外壳，拆开会产生没有独立验收意义的中间形态。
  - 对话页的切换器不重复显示项目名（头部已有），避免 521px 窄屏下标题只剩约 26px。
  - 项目列表加载失败的提示与「重新加载」移到页面头部，面板关闭时也可见。这是去掉侧栏后发现的回归。
- **播放器截图基线：** 用户 2026-10-12 当次明确批准。展示区变宽，播放器按既有规则从约 434×280 放大到约 560×350，外壳 CSS 未改动。win32 与 ci-win32 已更新；darwin 基线需在 macOS 上重新生成，**本次未更新**。
- **验证：** typecheck、lint、`check:video-preview-contract`（含 13 项自检）、`test:product-stage-style` 通过；单元测试 1729/1729；隔离 `test:display-coverage` 中本任务引起的 5 项回归全部修复，复跑通过。
- **与本任务无关、在干净 `main` 上同样失败的既有问题：** `CASE-14 exports distinct original and branded images`、`case-10-required-media-optional-compile-failed`、`case-11-non-retryable-reframe-failed`。另有 `product-draft-navigation`、`runtime-write-capability-gating` 各一项在全量并发下偶发失败，单独运行稳定通过。
- **遗留待用户确认：** 品牌 mark 是否从渐变改为单色（V3 规范第 8 节）。
- **未转交成功的跨任务问题：** 改造后的 `work:guard` 在 `<repo>/.worktrees/<task>` 嵌套布局下找不到只存在于 worktree 的计划文件（`localCheckoutRoot()` 解析到主工作区根）。曾发给改造任务负责会话，因权限模式不同未送达，需用户转达。

## 11. 追加：产品内品牌标记改为黑白单色（用户 2026-10-12 确认）

**背景与根因：** 品牌规范 2.2 已确认 LOGO 主版本为黑白极简、不使用紫青渐变，但产品内的品牌标记（工作台头部切换器、导航面板、登录页、重置密码页）仍是渐变圆底配白色线稿，规范第 10 节当时把这些界面排除在 LOGO 任务之外。用户在本任务中确认改为黑白单色，此项不再是待确认事项。

**改法：**
- 产品内品牌标记统一使用已交付的 badge 黑色版字形（`public/brand/multimix-logo-badge-black.svg`）：`#151515` 圆角底板 + 反白 `M + 前进箭头`。依据：这些位置都是 `≤48px` 的小尺寸场景，规范 2.4 规定该尺寸使用 badge；底板本身即对比来源，不再加阴影或半透明底板。
- 产品代码不再内联旧的简化 M 线稿，改为一个共享组件，工作台与登录页共用同一字形，避免再次分叉。
- 删除只服务于旧渐变圆底的样式（含无人使用的 `.shadcn-prototype-admin-brand-mark`）。
- 7 个当前原型的 `.brand-mark` 同步改为黑白 badge。
- 品牌规范第 10 节同步更新：工作台导航与登录页的品牌标记已纳入，favicon 与播放器 UI 仍在范围外。

**渐变纪律：** 品牌标记不是「AI 正在参与」时刻，改为单色后与 V3 规范第 2 节的渐变纪律一致；AI 后台状态胶囊等真正的 AI 时刻保留渐变。

**验证：** 契约测试锁定共享组件被工作台与登录页使用、源码中不再有渐变圆底品牌标记；typecheck、lint、单元测试、播放器两项视觉契约；浏览器核对头部与登录页渲染。
