# 前端全量测试遗留整改计划

> Status: archived
> Owner: frontend
> Last verified: 2026-08-05

## 背景与当前证据

2026-08-05 在一次性干净依赖环境中运行全量 Vitest：共 518 项，507 项通过、11 项失败，涉及 5 个测试文件。当前开发目录的 `node_modules` 还存在依赖入口不完整问题，直接运行 `npm test` 会提示找不到 `vitest`；该环境问题与下述代码/契约失败需要分别处理。

本计划记录待办及已获确认的执行决策。

## 2026-08-05 已确认执行决策

- 用户明确批准：视频预览外观与滚动以当前实现为准。当前 `.shadcn-prototype-video-browse` 的自然外层滚动与分镜卡阴影空间不回退为旧的 `overflow: hidden` 契约；播放器区域的当前上下间距也作为本轮视觉基准。需同步当前原型、工作台设计和独立契约测试，并以浏览器截图确认没有额外空白、双滚动条或阴影裁断。
- 用户明确要求：工程预览 iframe 失败后，播放器内提供用户可理解的“重新加载预览”操作。不得在播放器下方暴露“完整工程”等内部制作术语；重试必须重新挂载 iframe、清除失败状态，并保留分镜卡继续可见。
- 用户已于 2026-08-05 明确要求修复其余四类问题：BGM 播放地址加载、视频任务轮询、草稿预览顺序，以及历史会话/深链加载。执行时先以失败测试和当前运行时行为确认根因；对过宽的源码字符串断言，改为守住同一用户可见行为的测试，不能仅为通过测试而删除保护。

## 待办清单

## 2026-08-05 其余失败根因确认

- `MultiMix-Frontend/editor-engine/vendor/serializeProject.test.ts:160` 把 `window` stub 成 `{}`，而 `bootstrap.ts:17` 正确使用浏览器的 `window.setTimeout` / `clearTimeout` 保护媒体下载。失败发生在测试环境，真实浏览器不会缺少这两个 API；修复测试环境契约，不改运行时超时保护。
- `MultiMix-Frontend/app/assets/__tests__/agent-ui-copy.test.ts:42` 仍期待“正在准备分镜画面”，与当前已确认的 `lib/asset-mappers.ts:637` 文案“正在准备素材”不一致；同步测试到当前产品定义。
- 同一测试文件的轮询、草稿展示和会话缓存断言（约 1532、1595、1618）直接检索整份组件源码。它们分别被聊天图片上传的合法 `Promise.all`、其他分支先出现的摘要标记、以及摘要合并逻辑重排误伤；改为调用已导出的轮询/路由策略或验证局部、可观察行为，不收窄产品能力。
- `MultiMix-Frontend/app/assets/__tests__/workspace-new-conversation-routing.test.tsx:25,67` 仍绑定 `assets-workspace-client.tsx` 内部代码排版；对话详情装载策略已迁至 `app/assets/lib/conversation-detail-load-policy.ts`，而组件仍会为不在最近摘要页的深链请求详情，并在摘要延迟返回时保留已加载详情。改为测试该策略与详情合并行为。

实施顺序：先将每项测试改写为能暴露旧测试环境/旧契约的问题并观察失败（RED），再进行最小测试或 helper 调整（GREEN）；不修改经过验证的用户可见运行时行为。

### 1. 测试依赖环境

- [ ] 恢复前端锁文件对应的完整依赖安装，确保当前开发目录可以直接执行 `npm test`、`npm run typecheck` 和 `npm run lint`。
- [ ] 不提交 `node_modules` 或临时测试产物；确认依赖恢复不会改写 `package-lock.json`。

### 2. BGM 播放地址加载（1 个失败）

- [x] 排查并修复 `editor-engine/vendor/serializeProject.test.ts:153` 的 `playback_url` hydration 测试：测试模拟真实浏览器的 `window.setTimeout` / `clearTimeout`，并断言签名播放地址及 AbortSignal；运行时代码无需改变。

### 3. 执行状态文案与执行区结构（4 个失败）

- [x] 对齐 `lib/asset-mappers.ts:637` 的当前用户可见文案“正在准备素材”。
- [x] 移除对整个组件禁止 `Promise.all` 的源码字符串断言；逐任务轮询、终态刷新和失败隔离已有行为测试覆盖，不再被聊天图片上传的合法并发误伤。
- [x] 将草稿预览顺序改为最终渲染分支断言：无成片时先渲染占位预览，再渲染方案摘要。
- [x] 对齐摘要缓存断言与当前“先合并摘要、再保留已加载详情”的实现，保留真实缓存、后台重验和失败重试语义。

### 4. 视频播放器与浏览态布局契约（4 个失败）

- [x] 以当前浏览态 CSS 为本轮视觉基准，同步 `workspace-video.html`、`MULTIMIX_WORKSPACE_DESIGN.md` 和 `product-stage-style-contract.test.ts`；不改动既有白色外壳、圆角、内边距、阴影、比例或控制条契约。
- [x] 在 `video-project-preview.tsx` 内新增失败后的“重新加载预览”：重置 ready/failed/播放状态、换用新的 iframe 请求地址并再次等待 preview-state 握手；失败提示留在白色播放器画布内。
- [x] 调整 `product-preview.tsx`，不再在 iframe 失败时立即卸载播放器而丢失重试入口；下方分镜卡保持可查看和可选择。
- [x] 将 `video-browse-contract.test.ts` 由旧的“加载完整工程预览”内部术语断言改为初始预览、失败提示和“重新加载预览”的交互行为断言。
- [x] 修改前已读取 `docs/specs/ui/prototypes/current/screens/workspace-video.html`、`MultiMix-Frontend/docs/MULTIMIX_WORKSPACE_DESIGN.md` 的 `video-preview-shell-contract:v1` 及工作区播放器保护门禁。

### 5. 新建与历史对话路由（2 个失败）

- [x] 为“延迟摘要刷新不能覆盖用户主动新建对话”补充策略级回归测试。
- [x] 为“深链历史对话不在最近摘要页时仍能加载详情”补充策略级回归测试。
- [x] 将焦点恢复与已加载详情保留逻辑收敛到 `app/assets/lib/conversation-detail-load-policy.ts`，并由组件消费；测试直接覆盖策略，不能因实现搬迁而丢失竞态保护。

## 风险与取舍

- 11 个失败不等于 11 个已确认的用户功能故障，其中包含测试环境缺口、过宽的源码字符串断言和可能的真实契约偏离；处理时必须先复现用户行为再分类。
- 播放器相关问题受现行视觉契约保护，若实现确实偏离，应修实现；若契约需要变化，必须先取得用户批准并同步权威设计、原型、独立契约检查和截图基线。
- 对话竞态与深链加载即使由 helper 接管，也必须保留可观察的行为回归测试，避免把测试改绿但重新引入数据或导航一致性问题。

## 完成验证

- [x] 干净依赖环境运行 `npm --prefix MultiMix-Frontend test`：518/518 通过，且没有失败 suite。
- [x] 运行 `npm --prefix MultiMix-Frontend run typecheck`、`npm --prefix MultiMix-Frontend run lint`；`check:agents` 与 `docs:check` 待本计划文档更新后执行。
- [ ] 若改动视频播放器或浏览态布局，同时运行 `check:video-preview-contract`、`test:product-stage-style`、隔离的 `test:display-coverage` 及浏览器截图对比。
- [ ] 若改动对话状态或路由，按 `docs/authority/conversation-orchestration-rules.md` 补充聚焦回归与浏览器交互验证。
- [ ] 完成后将本计划移入 `docs/archive/plans/`，并再次运行 `docs:check`。

## 2026-08-05 视频预览执行记录

- 已在隔离依赖 worktree 运行：视频预览聚焦 Vitest 29/29、`check:video-preview-contract`、`test:product-stage-style` 和 `typecheck`，均通过。
- `test:display-components` 30/30 通过。`test:display-coverage` 的浏览器阶段没有启动：其 runner 固定生成 `runtime.sqlite3`，但当前后端 seed 安全校验只接受 `multimix-display-coverage-*` 文件名；手动启动隔离 uvicorn/Next 以复核截图又被当前执行环境的进程安全策略拒绝。两次尝试生成的临时 SQLite、素材和日志均已删除。
- `docs:check` 仅报告无关的既有 active plan `docs/plans/active/2026-08-05-openmontage-runtime-identifier-removal.md` 已完成但尚未归档；本轮未修改该计划，不能据此移动。
