# LLY-29 离线或 API 不可用时的运行时写能力门禁

> Status: archived
> Owner: frontend
> Last verified: 2026-08-25

## 目标

在 API 未配置或已配置但当前不可用时，用户进入上传、发送、确认生成或从素材库发起创作之前，
界面就应禁用对应入口并说明原因；不能先打开文件选择器、创建乐观对话或启动上传，再由事件处理器
报错。真实后端恢复后，用户通过现有重试路径即可恢复操作；未配置
`NEXT_PUBLIC_API_BASE_URL` 时继续明确提示需要配置并重启前端。

本计划只处理前端运行时写能力门禁，不修改后端 API、健康协议、认证协议或生成流水线。

## 权威依据

- Linear `LLY-29`：负责人 Dingxin Tao、优先级 High、Work type 为用户可见系统功能。开工门禁时状态为 Todo；总调度取得 claim 后已切换为 In Progress。
- `MultiMix-Frontend/docs/specs/ui/runtime-data-source-and-offline-empty-state.md`：未配置后端时不得提供创建、保存、上传和生成操作；失败状态只能重试真实接口。
- `MultiMix-Frontend/docs/MULTIMIX_WORKSPACE_DESIGN.md`：生产运行时只消费真实后端，失败与未配置不得回退演示数据。
- `MultiMix-Frontend/docs/API.md`：`AssetsWorkspaceClient` 是唯一状态容器，子组件通过 props 消费状态和回调，adapter 仍是唯一后端边界。
- `MultiMix-Backend/docs/authority/development-change-coordination.md`：前端专属计划放在前端 `docs/plans/active/`，代码写入前登记 area、path、contract 与 issue claim。

## 开工基线（2026-08-25，历史快照）

- Frontend 分支为 `main`，`HEAD=f7ba8750f91ade54ac90c3c6e552173b2e0294b5`；基于本地已有远端跟踪引用，`HEAD...origin/main` 为 `0 0`，工作区在创建本计划前 clean。本次没有 fetch、pull 或切换分支。
- `work:guard status` 使用显式工作区根 `/Users/tao/Desktop/MultiMix` 返回 `[]`；这是 claim 登记前的历史快照，不代表当前 registry。
- `assets-workspace-client.tsx` 已有 `unconfigured | loading | ready | error` 对话加载状态，但在渲染时仍无条件向 `ConversationStart`、`ConversationStudio` 和 `LibraryWorkshop` 传入上传/发送/创作 handler。
- `ConversationStart` 的文本框、文件按钮和发送按钮只依据 handler 是否存在来禁用；拖放同样只检查上传 handler。
- `ConversationStudio` 的 `canSend` 只依据 `onSendMessage` 与 `readonly`；确认卡、Agent 任务、提交型建议、附件按钮和 composer 共用这个不完整判定。
- `LibraryWorkshop` 有自己的加载错误态，但上传和详情中的创作按钮仍只依据 handler 是否存在；多项后端写操作只在点击后才失败。
- 主壳中的上传与发送 handler 保留了末端防御，但拒绝发生在用户已经触发交互之后；新对话发送还会在请求前创建乐观对话。

## 收口状态（2026-08-25）

- Linear 已由总调度切换为 In Progress；实现与第一轮审查修正均已完成。
- 总调度第二轮代码审查 PASS，并独立复跑聚焦测试 18/18 与 typecheck；三张聚焦 PNG 已逐张检查通过。
- development claim `lly-29-runtime-write-capability-gating` 在实现与审查期间由 `codex-lly-29-execution-window` 持有，issue 为 `LLY-29`，contract 为 `state/runtime-write-capabilities`；active 路径最终 check 通过后已正常释放。

## Development scope 与 claim

- Areas:
  - `runtime-write-capability-gating`
  - `offline-empty-state`
- Expected paths:
  - `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`
  - `MultiMix-Frontend/app/assets/components/conversation-start.tsx`
  - `MultiMix-Frontend/app/assets/components/conversation-studio.tsx`
  - `MultiMix-Frontend/app/assets/components/library-workshop.tsx`
  - `MultiMix-Frontend/app/assets/lib/runtime-write-capabilities.ts`（新增纯能力模型）
  - `MultiMix-Frontend/app/assets/__tests__/runtime-write-capability-gating.test.tsx`（新增聚焦测试）
- Shared contract: `state/runtime-write-capabilities`
- Active plan: `MultiMix-Frontend/docs/plans/active/2026-08-25-lly-29-runtime-write-capability-gating.md`
- Merge order: `LLY-29 runtime capability gate -> focused UI QA -> dispatcher review/commit -> LLY-31 accessibility consolidation`

## 明确不在范围内

- 不修改 LLY-10 的生成进度卡、阶段文案、步骤数量、耗时展示、轮询或后端计时链路。
- 不实现 LLY-31 的通用 Dialog、FocusScope、键盘事件隔离或登录文案整改；本任务只为禁用原因提供最小、稳定的可访问文本。
- 不修改 `ProductWorkspace`、视频预览受保护链路、生成任务卡或后端 API/健康协议。
- 不新增探活 endpoint，不用定时器轮询健康状态，不把业务校验、Provider 失败或生成失败一律误判为全局离线。
- 不修改 Linear，不 commit、不 push、不 deploy，不接触生产环境。

## 设计：单一运行时写能力契约

### 1. 纯能力模型

在 `runtime-write-capabilities.ts` 定义小型纯模型，供主壳和三个子组件共用。预期形状：

```ts
type RuntimeWriteAvailability =
  | "checking"
  | "available"
  | "unconfigured"
  | "unavailable";

type RuntimeWriteCapabilities = {
  availability: RuntimeWriteAvailability;
  canUpload: boolean;
  canGenerate: boolean;
  canPersist: boolean;
  reason: string | null;
  recovery: "retry" | "restart" | null;
};
```

具体命名可在 TDD 中按现有风格微调，但契约必须保持以下语义：

- 只有 API 已配置、token 可用且最近一次权威连接检查成功时，三个能力才为 `true`。
- `unconfigured`：能力全部关闭，原因逐字说明配置 `NEXT_PUBLIC_API_BASE_URL` 后重启；不提供虚假的即时恢复按钮。
- `checking`：认证或首次真实请求尚未完成，能力暂时关闭，避免在连接结果未知时提前写入。
- `unavailable`：能力全部关闭，显示“后端暂时不可用”及真实重试入口；成功重试后转回 `available`，无需刷新整页。
- 非连接类业务错误（校验失败、生成 Provider 失败、普通 4xx）不把整个工作台永久降为 `unavailable`；401 继续走既有统一认证失效流程。

### 2. 状态所有权与恢复

`AssetsWorkspaceClient` 继续作为唯一状态容器：

- 初始值由 `isBackendEnabled()`、token 和首次对话摘要请求共同决定。
- 对话摘要成功后标记 `available`；即使页面先显示缓存摘要，后台刷新连接失败也必须关闭写能力，同时保留缓存内容只读浏览。
- 对话加载失败分支的“重新加载”仍只重试真实接口；成功后恢复能力。
- 已进入写 handler 后遇到 `API_CONNECTION_ERROR` 时，除了保留现有错误/对账行为，还要把后续写能力标记为 `unavailable`；不能在这一步新增第二次写请求。
- `LibraryWorkshop` 的真实列表重试成功/连接失败通过窄回调回报主壳，使库内“重新加载”也能恢复同一能力状态；读取缓存本身不能伪造后端已恢复。
- 已经处于发送中的请求仍保留“停止生成”；能力降级只阻止新写操作，不伪造取消或改写已有任务状态。

### 3. 组件消费规则

主壳向 `ConversationStart`、`ConversationStudio`、`LibraryWorkshop` 下传同一个
`RuntimeWriteCapabilities`，不再用“handler 是否存在”隐式表达运行时能力。末端 handler 防御继续保留，
作为竞态和编程错误的第二道保护。

`ConversationStart`：

- `canUpload=false` 时，两个文件按钮、隐藏 input、拖放与失败附件重试都不能触发上传 callback。
- `canGenerate=false` 时，textarea、发送按钮和长视频创作入口不可提交；建议卡可以继续填充文本，但不能绕过发送门禁。
- 在 composer 附近显示稳定的 `role="status"` 原因；禁用控件通过 `aria-describedby` 关联该原因。

`ConversationStudio`：

- `canSend` 同时要求 `canGenerate`、handler 存在且对话非只读。
- 上传按钮、拖放与附件重试额外要求 `canUpload`。
- 确认卡、Agent 任务恢复、提交型建议及普通 composer 都消费 `canGenerate`；仅打开面板或填充文本的只读操作可以继续。
- 离线原因与“参考样例只读”使用不同文案；连续错误 live-region 的通用整改留给 LLY-31。

`LibraryWorkshop`：

- 顶部上传入口消费 `canUpload`，禁用时不会调用主壳 handler 或打开文件选择器。
- “用于创作”“生成视频”“重新生成”“拆成短视频”“加入对话”等创作入口消费 `canGenerate`。
- 网页入库、公开素材保存、重新解析、重试处理和删除等后端变更消费 `canPersist`；复制、浏览详情等纯本地/只读操作保持可用。
- 当前库为 `unconfigured/error` 时继续显示原有真实空/错误状态；能力原因可见且不依赖 hover 才能理解。

## TDD 实施顺序（仅在 Linear 进入 In Progress 后执行）

- [x] 先新增 `runtime-write-capability-gating.test.tsx`，覆盖纯模型与真实组件，运行并确认当前代码 RED；不得先改组件或测试期望绕过失败。
- [x] 纯模型测试：`unconfigured/checking/unavailable` 全部关闭，`available + token` 全部开启；rerender 或状态转换后能力可恢复。
- [x] `ConversationStart`：即使传入可调用 handler，禁用态点击、Enter、drop 和文件 input 均不调用上传/发送；原因可由 role 查询；恢复态重新可用。
- [x] `ConversationStudio`：禁用态不创建 pending exchange、不调用发送/上传；确认与提交型建议不可执行；发送中的停止按钮不被错误禁用；恢复态重新可用。
- [x] 审查补充：消息内/消息外 generation retry、主执行 retry、Agent action retry 在 unavailable 时不可执行；available 后恢复；运行中的 stop/cancel 保持可用。
- [x] `LibraryWorkshop`：禁用态上传与详情创作/持久化按钮不可执行，浏览仍可用；恢复态 handler 可被调用。
- [x] 主壳集成：API 未配置时入口在交互前禁用；首次真实请求返回连接错误时不进入乐观发送/上传；点击真实重试并成功后同一页面恢复能力。
- [x] 最小实现能力模型、主壳状态与子组件 props；保留现有 handler 末端校验，不改 adapter 或后端协议。
- [x] 运行聚焦回归，确认现有聊天附件格式拒绝、IME Enter、资源库加载/性能与长视频素材入口在在线状态不回退。
- [x] 运行全量静态与测试门禁，并完成离线、不可用、恢复三个 UI 状态的本地截图验收。
- [x] 总调度第二轮代码审查 PASS，并完成聚焦测试、typecheck 与三张聚焦 PNG 的独立复核。

提交、Linear 最终证据回链及后续状态变更仍由总调度完成；本执行窗口不声称已 commit、push、deploy 或修改 Linear。

## 聚焦测试矩阵

| 场景 | 预期 |
| --- | --- |
| API 未配置 | 发送、上传、确认生成和库内创作/持久化入口在用户操作前禁用；不打开 chooser，不调用 adapter；文案提示配置并重启 |
| API 已配置、首次请求进行中 | 写入口暂时关闭，显示连接中原因，不创建乐观对话 |
| API 连接错误且无缓存 | 保留现有错误态和真实“重新加载”，写入口关闭 |
| API 连接错误但有真实摘要缓存 | 缓存对话可浏览，写入口仍关闭，不把缓存当健康证明 |
| 发送/上传过程中连接丢失 | 当前请求走既有失败/对账路径，后续新写入口关闭，不修改任务进度卡 |
| 非连接类业务失败 | 仅显示该操作错误，不全局禁用其他写入口 |
| 重试成功 | 同一页面恢复上传、发送、确认和库内创作，不需要整页刷新 |
| API 未配置后补环境变量 | 文案明确必须重启；不承诺浏览器运行时动态读取构建环境变量 |

## 验证命令

在每个代码阶段边界先运行 `work:guard check --token <token>`，最终至少执行：

```bash
npx vitest run app/assets/__tests__/runtime-write-capability-gating.test.tsx
npx vitest run app/assets/__tests__/chat-video-attachment-rejection.test.tsx app/assets/__tests__/composer-ime-submit.test.tsx app/assets/__tests__/library-workspace-state.test.tsx app/assets/__tests__/library-workshop-performance.test.tsx app/assets/__tests__/long-form-library-entry.test.tsx
npm run typecheck
npm run lint
npm run test
npm run docs:check
npm run check:agents
npm run build
git diff --check
```

UI 验收使用隔离的本地前端/测试后端，不连接生产：

- 截图 1：未配置 API 的 `ConversationStart`，上传与发送禁用且原因可见。
- 截图 2：API 运行时不可用的已有对话或资源库，缓存内容可浏览、写入口禁用、真实重试可见。
- 截图 3：同一会话重试成功后的恢复状态，上传/发送或库内创作入口重新启用。

## 冲突与串行边界

- LLY-10 当前为 In Progress，属于 `soft_conflict`：目标相关但本计划不修改生成进度卡、阶段文案、计时或其后端链路。若实际实现需要触碰这些区域，立即停止并扩展远端范围/重新 claim，不能顺手修改。
- LLY-31 当前为 Todo，与本任务共享 `conversation-start.tsx`、`conversation-studio.tsx` 和 `library-workshop.tsx`，必须在 LLY-29 审查/提交后串行开始。LLY-29 只添加当前门禁所需的最小状态说明，不提前做通用可访问性重构。
- 开工前本机 work registry 为空；当前已由本任务持有上述精确 claim，最近一次 check 无冲突。Linear Related 与上述合并顺序仍是跨电脑协调依据。

## 开工停止点（历史门禁）

本计划落盘并取得 LLY-29 claim 后立即停止。只有总调度明确通知 Linear 已进入
`In Progress`，才执行上述 TDD、产品代码修改、验证与截图；Todo 阶段不得提前写产品代码。

当前已越过该门禁并完成总调度第二轮代码审查；按本次收口指令释放 claim 并归档计划。

## 执行记录（2026-08-25，总调度第二轮审查 PASS）

- 第一轮 RED：`npx vitest run app/assets/__tests__/runtime-write-capability-gating.test.tsx` 因共享能力模块尚不存在而按预期失败（1 failed suite / 0 tests）。
- 第一轮 GREEN：聚焦门禁测试为 12/12；既有聊天附件、IME、资源库状态/性能和长视频入口回归为 23/23。
- 第一轮审查修正 RED：新增 retry 门禁回归后为 4 failed / 13 passed；失败分别对应消息内/消息外 generation retry、主执行 retry 与 Agent action retry 在 unavailable 时仍可见。
- 第一轮审查修正 GREEN：聚焦测试 18/18；生成卡、执行时间线、轮询、视频操作和 Agent action 相关回归合计 101/101。新增主壳集成回归还验证了运行中 cancel 连接失败会关闭后续写能力。
- 第一轮全量门禁：typecheck、lint、89 files / 687 tests、docs/check、check:agents、视频预览契约、production build 与 `git diff --check` 均通过。
- 审查修正后全量门禁：typecheck、lint、89 files / 693 tests、docs/check、check:agents、视频预览契约、production build 与 `git diff --check` 均通过。
- 隔离本地 UI：显式清空 API/Supabase 环境变量验证未配置态；另用仅监听 `127.0.0.1` 的可控 stub API 验证持续故障与真实“重新加载”恢复，没有连接生产。
- 截图：
  - `/Users/tao/Desktop/MultiMix/.artifacts/lly-29/01-api-unconfigured.jpg`
  - `/Users/tao/Desktop/MultiMix/.artifacts/lly-29/02-runtime-unavailable.jpg`
  - `/Users/tao/Desktop/MultiMix/.artifacts/lly-29/03-retry-recovered.jpg`
- 第一轮审查要求的聚焦 PNG（500×360，文字可直接阅读）：
  - `/Users/tao/Desktop/MultiMix/.artifacts/lly-29/review-2/01-api-unconfigured-focused.png`
  - `/Users/tao/Desktop/MultiMix/.artifacts/lly-29/review-2/02-runtime-unavailable-focused.png`
  - `/Users/tao/Desktop/MultiMix/.artifacts/lly-29/review-2/03-retry-recovered-focused.png`
- 总调度第二轮代码审查 PASS；独立复核结果为聚焦测试 18/18、typecheck 通过，三张聚焦 PNG 逐张检查通过。
- development claim 已通过 `work:guard end` 正常释放，未删除或手工改写 registry。
- 本执行窗口不提交；commit、push、deploy、Linear 最终证据回链与状态变更仍由总调度负责。
