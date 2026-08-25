# LLY-31 统一前端模态框、键盘和读屏可访问性

> Status: archived
> Owner: frontend
> Last verified: 2026-08-25

## 目标

统一工作台现有弹层的键盘与焦点生命周期，隔离弹层打开时的背景交互，并修复分镜卡嵌套按钮、
连续异步错误公告和登录标签不准确的问题。实现必须保留现有视觉方向、可访问名称、
`aria-current` / `aria-pressed` 语义和业务行为，不触碰视频生成进度或后端链路。

本计划只负责 LLY-31 的前端可访问性收口；commit、push、Linear 证据回链、状态变更和最终验收由
总调度窗口负责。

## 权威依据

- Linear `LLY-31`：负责人 Dingxin Tao、优先级 Medium、Work type 为用户可见系统功能；开工门禁时仍为 Todo。
- `MultiMix-Frontend/docs/MULTIMIX_WORKSPACE_DESIGN.md`：库详情使用居中模态弹窗，浏览与对话行为保持既定产品分层。
- `MultiMix-Frontend/docs/specs/ui/agentic-workbench-design.md` 与 `docs/specs/ui/prototypes/current/`：V3 当前交互和视觉基准。
- `MultiMix-Frontend/docs/specs/ui/storyboard-cards-and-material-picker.md`：分镜卡与换素材窗口的现行交互契约。
- `MultiMix-Frontend/docs/API.md`：组件边界、认证能力和测试数据边界。
- `MultiMix-Backend/docs/authority/development-change-coordination.md`：active plan、精确 claim、冲突和范围扩大门禁。
- `MultiMix-Backend/docs/qa/linear-issue-completion-evidence.md`：用户可见功能需提供 Linear 截图证据。

## 开工基线（2026-08-25）

- Frontend 位于本地 `main`，总调度已 fresh fetch 并确认 `main...origin/main = 0/0`；本窗口复核时工作区 clean。
- Linear 状态为 Todo，15 个 Expected paths、4 个 area、2 个 shared contract 均已登记；无附件，scope expansion 评论已记录。
- `work:guard status --workspace-root /Users/tao/Desktop/MultiMix` 在 claim 前返回 `[]`。
- 规范名路径 `MultiMix-Frontend` / `MultiMix-Backend` 当前不存在；可按授权创建只指向小写仓库的临时符号链接。
- LLY-29 已 Done/pushed；LLY-10 为已划定边界的 soft conflict。

## 当前缺口复核

- `AssetPicker`：仅监听 Escape；无共享初始焦点、Tab/Shift+Tab 圈定、背景隔离或关闭后焦点恢复。
- `VoiceoverDialog`：仅监听 Escape，且忙碌期间阻止关闭；没有其余完整焦点生命周期。
- `LibraryWorkshop`：条目详情、公开素材搜索、读取网页资料三个具名 `aria-modal` 弹层均无统一焦点管理；背景仍可被键盘访问。
- `SegmentCards`：父 `<li role="button">` 处理 Enter/Space；内部“修改配音/换素材”只阻止 click 冒泡，键盘事件会触发父卡。
- `ConversationStart` / `ConversationStudio`：发送错误为条件渲染普通段落；连续相同异步错误不能稳定触发读屏公告。
- 登录表单的 input、校验、Supabase 和本地后端认证都只支持邮箱，可见标签及权威原型仍写“邮箱或手机号”。
- 已有 `AssetPicker aria-pressed`、侧边栏 `aria-current`、编辑器现有 `aria-pressed` 与所有 dialog name 均已存在，不重复实现且必须防回退。

## Development scope 与 claim

### Areas

- `dialog-focus-management`
- `keyboard-interaction-accessibility`
- `async-error-announcements`
- `auth-copy-accuracy`

### Expected paths

- `MultiMix-Frontend/app/assets/components/asset-picker.tsx`
- `MultiMix-Frontend/app/assets/components/voiceover-dialog.tsx`
- `MultiMix-Frontend/app/assets/components/library-workshop.tsx`
- `MultiMix-Frontend/app/assets/components/segment-cards.tsx`
- `MultiMix-Frontend/app/assets/components/conversation-start.tsx`
- `MultiMix-Frontend/app/assets/components/conversation-studio.tsx`
- `MultiMix-Frontend/app/multimix-app.tsx`
- `MultiMix-Frontend/docs/specs/ui/prototypes/current/screens/login.html`
- `MultiMix-Frontend/e2e/pdf-video-quality.spec.ts`
- `MultiMix-Frontend/e2e/video-pipeline-production.spec.ts`
- `MultiMix-Frontend/app/assets/lib/use-dialog-focus-management.ts`（新增共享焦点生命周期）
- `MultiMix-Frontend/app/assets/__tests__/accessibility-interactions.test.tsx`（新增聚焦交互测试）
- `MultiMix-Frontend/app/assets/__tests__/asset-picker.test.tsx`
- `MultiMix-Frontend/app/assets/__tests__/voiceover-dialog.test.tsx`
- `MultiMix-Frontend/app/assets/__tests__/presenter-segment-cards.test.tsx`

### Shared contracts

- `state/dialog-focus-lifecycle`
- `ui/keyboard-and-live-region-semantics`

### Merge order

`LLY-29 runtime gate (Done) -> LLY-31 accessibility foundation -> dispatcher review/commit`

## 设计

### 1. 共享 Dialog 焦点生命周期

新增 `use-dialog-focus-management.ts`，由 AssetPicker、VoiceoverDialog 和 LibraryWorkshop 三类弹层共同消费：

- 打开时捕获当前触发元素，等待弹层挂载后把焦点放到显式 initial target；未提供时落到首个可用控件，再兜底到 dialog 容器。
- 在 dialog 内枚举当前可见、可用的原生/显式可聚焦元素；Tab 在末项回到首项，Shift+Tab 在首项回到末项。
- Escape 走调用方的单一关闭函数；VoiceoverDialog 忙碌时继续拒绝关闭，不能绕过既有任务保护。
- 弹层打开期间对 dialog 外的页面分支应用可恢复的 `inert` 与 `aria-hidden` 隔离；清理时只恢复本 hook 自己写入前的状态，避免覆盖既有属性。
- 关闭或卸载后把焦点恢复到仍连接且可聚焦的原触发元素；触发点已移除时安全跳过，不把焦点抛到 body。
- 共享逻辑支持严格模式 effect 清理和回调更新；不得为三个组件复制不同版本。

三类弹层保持既有 mask 点击语义、`role="dialog"`、`aria-modal="true"` 和可访问名称：

- AssetPicker：初始焦点、循环 Tab、Escape、mask 关闭、背景隔离、触发点恢复；候选 `aria-pressed` 保持。
- VoiceoverDialog：同一生命周期；busy 时 Escape、mask、关闭按钮都继续不可关闭，任务结束后恢复正常。
- LibraryWorkshop：条目详情、公开素材搜索、读取网页资料都接入同一 hook；打开公开搜索/网页录入时优先聚焦首个输入，详情优先聚焦关闭按钮或 dialog。

### 2. SegmentCards 嵌套键盘事件

- 保留整卡 Enter/Space 选择和现有选中视觉，不把内部业务按钮改成非按钮元素。
- 内部“修改配音”“换素材”在 keydown 层完整阻止 Enter/Space 冒泡，但不阻止按钮自身原生激活。
- 测试分别覆盖 Enter、Space，只调用内部动作且父卡 `onSelect` 为 0 次；整卡自身仍可用 Enter/Space 选择。

### 3. 稳定异步错误公告

- ConversationStart 与 ConversationStudio 始终保留稳定 alert/live region 节点，而不是只在错误存在时挂载普通段落。
- 每次发送、附件或确认错误都更新可公告内容；连续相同错误也必须产生可被读屏识别的新公告周期，同时页面只显示当前错误。
- 既有 runtime write `role="status"`、附件进度和消息内错误卡保持原语义，避免重复朗读或把普通状态升级为 assertive alert。
- 不修改 generation progress 卡、步骤文案、步骤数量、耗时、轮询或后端计时链路。

### 4. 登录能力与标签一致

- 应用登录/注册标签只声明“邮箱”，保留 `type="email"`、`autocomplete`、校验和现有认证调用。
- 同步当前权威 `login.html` 的标签和空值提示；不新增手机号认证能力。
- 同步两条生产类 Playwright 流程的邮箱定位器，不改变其环境、账号或业务步骤。

### 5. 语义防回退

- 测试明确断言每个 dialog 仍有可访问名称、`role="dialog"` 和 `aria-modal`。
- AssetPicker 可选候选继续暴露 `aria-pressed`；现有导航 `aria-current` 和其他已正确切换语义不因重构移除。
- 不用 `role="presentation"`、自制键盘点击或隐藏文本伪造支持能力。

## TDD 实施顺序（仅在 Linear 进入 In Progress 后）

- [x] 先新增/扩展聚焦测试，确认当前实现对初始焦点、Tab 圈定、恢复、背景隔离、嵌套按钮和连续错误公告为 RED。
- [x] 实现共享 dialog hook 的最小 GREEN，再接入 AssetPicker 与 VoiceoverDialog。
- [x] 将 LibraryWorkshop 三类弹层接入共享 hook，覆盖各自触发点和初始焦点。
- [x] 修复 SegmentCards 内部按钮键盘冒泡，保留父卡选择行为。
- [x] 实现 ConversationStart / ConversationStudio 稳定连续错误公告。
- [x] 校准应用、当前登录原型和两条 E2E 的邮箱标签。
- [x] 运行聚焦与相关回归后，再运行全量前端门禁。
- [x] 在隔离本地环境完成纯键盘、可访问性树和截图验收；不连接生产。

## 聚焦测试矩阵

| 场景 | 预期 |
| --- | --- |
| AssetPicker / VoiceoverDialog 打开 | 焦点进入弹层，Tab/Shift+Tab 循环，背景不可聚焦 |
| Escape / mask / 关闭按钮 | 仅允许的路径关闭；焦点恢复到原触发点 |
| Voiceover busy | Escape、mask、关闭按钮均不关闭；任务结束后恢复关闭能力 |
| Library 三类弹层 | 每个均具名、圈定焦点、隔离背景并恢复各自触发点 |
| SegmentCards 内部按钮 Enter/Space | 只执行内部动作，不选择父卡 |
| SegmentCards 父卡 Enter/Space | 继续选择对应分镜 |
| 连续不同/相同发送错误 | 每一次均更新稳定 alert/live region 并可被读屏宣告 |
| 登录表单 | 可见和可访问标签均为邮箱；原型与 E2E 定位一致 |
| 既有选中/当前语义 | `aria-pressed` / `aria-current` / dialog name 不回退 |

## 验证命令

每个代码阶段边界先运行 `work:guard check --token <token>`，最终至少执行：

```bash
npx vitest run app/assets/__tests__/accessibility-interactions.test.tsx app/assets/__tests__/asset-picker.test.tsx app/assets/__tests__/voiceover-dialog.test.tsx app/assets/__tests__/presenter-segment-cards.test.tsx
npx vitest run app/assets/__tests__/composer-ime-submit.test.tsx app/assets/__tests__/runtime-write-capability-gating.test.tsx app/assets/__tests__/library-workspace-state.test.tsx app/assets/__tests__/conversation-detail-loading.test.tsx
npx playwright test e2e/pdf-video-quality.spec.ts e2e/video-pipeline-production.spec.ts --list
npm run typecheck
npm run lint
npm run test
npm run check:agents
npm run build
git diff --check
```

生产依赖型 E2E 不在无授权环境实际连接生产；至少用 `--list` 验证选择器文件可加载，并由总调度决定是否在获批隔离环境执行完整流程。

## 隔离本地键盘、可访问性树与截图验收

- 使用独立前端端口和一次性本地测试数据/可控 stub；不得占用开发者端口、连接生产或读取生产凭据。
- 纯键盘逐一打开 AssetPicker、VoiceoverDialog、库详情、公开素材搜索、网页读取弹层，记录初始焦点、正反向循环、Escape 和焦点恢复。
- 在浏览器可访问性树检查 dialog name、modal、alert/live region、`aria-pressed` 和 `aria-current`；验证背景节点在弹层期间不可交互。
- 截图至少覆盖一个素材/配音弹层、一个库弹层、连续错误公告和邮箱登录标签；敏感信息必须清除。
- Linear 截图上传、Completion evidence 更新与 Done 复核由总调度完成。

## 冲突与明确不在范围内

- LLY-10 为 `soft_conflict`：本计划只改 ConversationStudio 的 composer 错误公告语义；禁止修改 generation progress 卡、阶段文案、步骤、耗时或后端计时链路。
- 不修改视频预览受保护链路、播放器契约、编辑器、后端认证/API、数据库、部署配置或生产环境。
- 不扩展手机号登录，不做全站视觉重设计，不重构无关组件，不新增生产依赖。
- 若实际实现需要第 16 个路径、新 area 或新 contract，立即停止；先更新 Linear 和本计划，释放旧 claim 后按完整范围重新登记。

## 收口状态

- 总调度代码审查 PASS；未发现阻止提交的问题。
- 总调度 fresh fetch 确认 Frontend `main...origin/main = 0/0`。
- 总调度独立复跑聚焦测试 20/20 与 `npm run typecheck`，结果均通过。
- 用户已授权总调度执行 commit、push 与 Linear 更新；本执行窗口只负责释放 claim、归档计划和清理临时符号链接，不执行远端操作。

## 执行记录（2026-08-25）

- 聚焦 RED：4 个文件 / 20 个测试中 9 项按预期失败，覆盖 dialog 焦点、嵌套按钮、连续错误和邮箱标签。
- 聚焦 GREEN：4 个文件 / 20 个测试全部通过；相关回归 8 个文件 / 54 个测试全部通过。
- 全量门禁：typecheck、lint、93 个文件 / 708 个测试、check:agents、docs、视频预览契约、production build 与 diff check 通过。
- Playwright `--list` 成功发现两条生产类 E2E 文件中的 3 个测试；未连接生产执行完整流程。
- 隔离验收使用一次性 SQLite、清空外部 provider 环境变量、独立 3337/3338/8337 端口和应用内浏览器；临时进程、数据库与构建目录已清理。
- 浏览器确认：五类 dialog 均具名；初始焦点、Tab/Shift+Tab、Escape、背景 inert/aria-hidden 精确恢复和触发点恢复通过。
- 浏览器确认：连续两次相同附件错误均保持单一 assertive alert；邮箱 input 的 name/type/autocomplete 为 `邮箱` / `email` / `email`。
- 浏览器确认：当前对话保留 `aria-current="page"`，AssetPicker 候选在选择前后为 `aria-pressed="false"` / `"true"`。
- 截图目录：`/Users/tao/Desktop/MultiMix/.artifacts/lly-31/`，共 5 张 PNG，已逐张检查。
