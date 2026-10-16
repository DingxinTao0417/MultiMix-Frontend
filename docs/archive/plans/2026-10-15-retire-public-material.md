# 退役公共素材：前端影响清单与清理顺序

> Status: completed
> Owner: frontend
> Last verified: 2026-10-16

## 背景与根因

- 用户 2026-10-15 明确要求：先不考虑公共素材，后续也去掉。
- 公共素材是「stock provider 在已保存素材未命中后兜底」的旧设计（后端权威规则 `asset-understanding-and-segment-referencing.md:466`、`mg-overlay-automation-and-rendering.md:153`），现已被「用户上传，或由 AI 生成」取代。
- 按「旧设计与旧逻辑清理门禁」，不能只在界面上藏起入口；要追踪全部调用方，迁移后同轮删除。本计划只负责前端侧，后端 stock provider 与接口由 Codex 处理。

## 执行授权变更（2026-10-15）

- 用户当次明确要求：后端公共素材代码退役「直接在 Claude Code 里做」，不再交给 Codex。依据 `agent-collaboration-division.md` 的分工是默认规则，本任务由用户授权例外；后端改动仍在 Claude Code 任务分支提交、跑后端 pre-push 钩子，并在交接文档中注明已由 Claude Code 执行。
- 用户同时确认顺序：先做公共素材代码退役（前后端），编导阶段生成的退役与四种做法新能力放到之后，单独立计划、单独定预算；工作台改版（深色播放台、探索稿转正式原型）排在两者之后，开工前先确认外壳色值。
- 编导提示词链路（10-11 定为 Codex 专属）若在公共素材退役中被触及，只删除公共素材相关字段与分支，不改编导语义；超出此范围先停下询问。

## 执行顺序（跨端顺序门禁）

| 步骤 | 负责端 | 上游 | 状态 |
| --- | --- | --- | --- |
| P1 后端停止产出 `public_asset`、公共候选和搜索接口，并明确存量数据的读取方式 | backend / Claude Code（用户授权） | 本计划与交接说明 | [x] 已发布，用户已确认 |
| P2 前端删除公共素材入口与展示，迁移到「你的素材 / AI 生成」两类来源 | frontend / Claude Code | P1 达 `[~]` | [x] 已发布，用户已确认 |
| P3 前端清理类型、映射、测试与文档残留，并证明旧行为不能再被触发 | frontend / Claude Code | P2 | [x] 已发布，用户已确认 |
| P4 历史作品（已含公共素材的旧工程）的读取与展示约定 | 两端 | P1 | [x] 已发布，用户已确认 |

P2 起才登记 `workspace-shell` 与 `asset-library` 开发占用；本轮不改任何前端代码，只做设计沉淀、文档与原型。

## 影响清单（2026-10-15 检索结果）

生产代码（`app/`、`lib/`，不含测试）：

| 文件 | 内容 | 退役做法 |
| --- | --- | --- |
| `app/assets/components/asset-picker.tsx:161-171` | 素材选择器里的「公共素材」分组、加载中、空态、源不可用提示 | 删除整个分组，只保留我的素材 |
| `app/assets/components/library-workshop.tsx:947,1070-1087,1169,1817-1872` | 资源库里的「公开素材搜索」入口、弹层、搜索与保存入库 | 删除入口、弹层、相关状态和请求 |
| `app/assets/components/product-preview.tsx:116,1137,1183-1205` | 「自动补 N 个公共素材」、非关键镜头的公共素材建议卡与「尝试搜索公共素材」按钮 | 删除计划摘要字段和整张建议卡 |
| `app/assets/components/assets-workspace-client.tsx:3655` | 「第 N 镜尝试搜索公共素材」指令 | 删除该分支 |
| `app/assets/components/source-ref-block.tsx:59` | 兜底来源标成「公共素材」 | 改为按新来源类型显示 |
| `app/assets/components/conversation-start.tsx:35` | 起始页能力胶囊里的「公开素材」 | 删除该项 |
| `app/assets/lib/use-segment-material-candidates.ts:119,146` | 单镜素材候选里的公共来源加载与报错 | 删除公共分支，只读本地候选 |
| `app/assets/lib/asset-workspace-types.ts:85,149` | `public_asset` 联合类型成员 | 类型收窄，须待 P1 |
| `app/assets/lib/asset-workspace-adapter.ts:1371` | `public_material_import` 工作流标记 | 随历史数据约定（P4）处理 |
| `lib/api.ts:288,611-680` | `PublicSourceRead`、`PublicMaterialCandidate`、候选响应的 `public` 通道及 `scope: "public"` | 删除类型与对应请求函数，须待 P1 |
| `lib/asset-mappers.ts:771-776,1086,1129,1193-1225` | `public_asset` 映射、`isFallback`、「公共素材已验证并用于工程」等文案 | 删除映射与文案，历史数据按 P4 处理 |
| `app/legal/terms/page.tsx:61-62`、`app/legal/privacy/page.tsx:47` | 条款与隐私政策里的公共素材检索、Pexels/Unsplash 披露 | 属法律文本，须用户确认措辞后再改；若后端确实不再连接这些第三方才可删 |

测试（13 个文件，约 41 处）：`asset-picker`、`asset-mappers`、`product-preview`、`use-segment-material-candidates`、`library-media-presentation`、`accessibility-interactions` 等，需随 P2/P3 同步改写。保留能证明「我的素材」「生成画面」仍可用的案例，并新增「界面中不再出现公共素材入口」的案例；不得只把期望值改成通过。

文档：`docs/` 下约 37 个文件含「公开素材」「公共素材」字样。

- 当前有效文档：`MULTIMIX_WORKSPACE_DESIGN.md`（第 220、231、239、608 行）、`specs/ui/agentic-workbench-design.md`（第 130、133 行）、`storyboard-cards-and-material-picker.md`、`video-artifact-browse-and-edit-states.md`、`API.md`、`DEPLOYMENT.md`、`prototypes/current/`。随 P2/P3 修订。
- 探索稿（`explorations/` 下的第 1–3 轮视觉探索）：属历史探索，不改。
- 本轮已改：画布优先探索稿 03、04、05 三页。

## 用户已确认的事项（2026-10-15）

1. **条款与隐私政策**：同步删除公共素材检索与 Pexels/Unsplash 披露。已确认，但属法律文本变更，见下方「法律文本变更须知」，P2 一并执行。
2. **历史作品**：已含公共素材的旧视频按「历史素材」只读展示并标注来源，不删除用户历史数据。
3. **后端排期**：已写交接文档 `MultiMix-Backend/docs/plans/active/2026-10-15-retire-public-material-and-director-suggestion-handoff.md`，由 Codex 登记占用后处理。前端在 P1 达 `[~]` 前不动代码。

## 法律文本决定（2026-10-16，用户确认）

- 生效日期：`LEGAL_VERSION = "2026-10-16"`、`LEGAL_EFFECTIVE_DATE = "2026 年 10 月 16 日"`。尚未推送，实际以发布当天为准，发布时可再调。
- 老用户：**要求重新同意**新版条款。这需要新增登录后的同意门（读取 Supabase `user_metadata.legal_consent_version`，低于现行版本时拦截，用户同意后写回），属账号流程改动（`account-auth` 功能区），另立计划 `2026-10-16-legal-reconsent-gate.md` 单独实施；本轮只改文本与版本号。
- 风险：本轮合入后、同意门上线前，老用户仍按旧版同意记录使用。两者应同一次发布，发布前须核对。

## 法律文本变更须知

- 涉及 `app/legal/terms/page.tsx` 第 6 节「第三方服务与公共素材」和 `app/legal/privacy/page.tsx` 第 3 节。
- 删除的前提是后端确实不再连接 Pexels/Unsplash；在 P1 完成前删除，会出现文本与实际不符，须等 P1。
- 条款变更后，`app/legal/legal-content.ts` 的 `LEGAL_VERSION` 与 `LEGAL_EFFECTIVE_DATE` 需随之更新。该版本号会随注册写入用户同意记录，升版后新注册用户记录新版本，老用户记录不变；是否要求老用户重新同意由用户另行决定。
- `app/legal/__tests__/legal-content.test.ts` 引用该版本号，需同步核对。

## 第二轮：现行文档全量修订（2026-10-15，用户要求）

用户要求检查全部文档，删掉或按最新设计修改遗留的旧设计与旧权威。本轮只改文档，不改代码。

### 判定口径

- **改**：现行规则、规格、原型、API 与部署说明、仍在执行的 active plan 中描述「应当如何」的条文。
- **不改**：`docs/archive/`、`docs/qa/` 下带日期的测试记录与 `issue-test-records/`、探索稿，以及 active plan 中的历史结果描述；它们是证据，改写会破坏可追溯性。
- **整份过时的 active plan**：主题本身是公共素材（如 `2026-09-27-public-original-first-selection.md`（已归档）），标记为已被替代，后续由所属端归档，本轮不移动后端计划。

### 三类旧设计

1. 公共素材：作为画面来源、候选、兜底、搜索、计数、确认选项、配置的全部条文。
2. 编导阶段生成并让用户比较采纳：关键帧建议/采纳、编导内候选预览、关键帧组展示。保留「先生成图片、用户满意后再做视频」这一用户选定的做法。
3. 讲解型/口播型/真人原视频型：已由 `source_video` 术语迁移与五层架构处理，抽查后确认现行文档只剩对照表、迁移计划和真实接口字段名，本轮不改。

### 影响文件

- 前端：`MULTIMIX_WORKSPACE_DESIGN.md`、`specs/ui/agentic-workbench-design.md`、`specs/ui/storyboard-cards-and-material-picker.md`、`specs/ui/video-artifact-browse-and-edit-states.md`、`specs/ui/generated-image-review-layout.md`、`API.md`、`DEPLOYMENT.md`、`prototypes/current/` 中带公共素材的屏。
- 后端权威：`asset-understanding-and-segment-referencing.md`、`conversation-orchestration-rules.md`、`video-project-confirmation-consistency.md`、`mg-overlay-automation-and-rendering.md`、`mg-animation-and-effects-design.md`、`mvp-video-quality-gates.md`。
- 后端规格与 QA 标准：`specs/flux-image-generation-product-contract.md`、`specs/commerce-video-example-taxonomy.md`、`qa/project-review-standard.md`。
- 后端 active plan：`2026-09-21-first-release-capability-readiness.md` 中的现行条目；三份公共素材主题计划加「已被替代」说明。
- 工作区根：`AGENTS.md` 中「stock provider 只能在 no_asset_hit 后兜底」一条。

### 风险

- 文档先于代码：代码里公共素材和编导内生成仍在运行。每处改写都注明「代码待退役」并指向交接文档，避免读者以为能力已删除。
- 后端权威文档由 Codex 维护，本轮属协作规则的「纯文档可直接改」，改后在交接文档中列出改动位置，由 Codex 核对。
- `AGENTS.md` 属根仓库规则，须单独提交。

### 执行结果（2026-10-15）

- [x] 后端权威 6 份：素材理解与分镜引用（文首新增 2026-10-15 总述，4.3 状态枚举、第 5–6 节候选与替换、第 7–12 节测试与验收全部去掉公共素材，关键帧建议改为四种做法）、对话编排、视频工程确认（计数字段 `public_material_fill_count` 退役）、两份 MG 规则、MVP 质量门。
- [x] 后端规格与标准：FLUX 图片契约、商品视频样例分类、项目审查标准、展示区自动化覆盖（CASE-02 改为待复测）、动画效果基准；资料到成片 QA 加历史注。
- [x] 后端 active plan：首发能力计划 5 处现行条目、素材用途统一计划第 9 条、导演语义审查计划 1 处；两份公共素材主题计划标「已被替代」。
- [x] 前端：工作台设计、智能体工作台视觉规范、分镜卡与选择器、视频产物浏览状态、生成图片布局（重写为单镜确认）、API、部署说明。
- [x] 现行原型：删除「素材源管理」屏（`admin-sources.html`），六屏入口与 README 同步；起始页能力胶囊、资源库「公开素材搜索」按钮、视频工作台「兜底素材」标记全部移除。
- [x] 工作区根 `AGENTS.md`：「stock provider 兜底」一条改为现行规则。
- [x] 未改（历史证据）：`docs/archive/`、带日期的 QA 记录与 `issue-test-records/`、探索稿、两份已替代计划正文、样本来源记录（如黄金基线中的 Pexels 授权核验）。
- [x] 第三类旧类型（讲解型/口播型/presenter）：不属于本计划，已移交 `MultiMix-Backend/docs/plans/active/2026-10-11-source-video-terminology-migration.md` 继续推进；本计划只记录抽查结论。

### 验证

- 修订后重新检索三类关键字，现行规则类文档中不再出现作为当前设计的表述。
- `npm --prefix MultiMix-Frontend run check:agents`。

## P2/P3 执行结果（2026-10-16）

- 逐镜候选只请求 `scope=local`：`use-segment-material-candidates`、换素材窗口、剪辑器 `ReplacePanel` 均删除公共分组、加载中、源不可用提示、“换一批”分页；后端合入后这三处原本会因 `scope=public` 返回 422 报错。
- 删除逐镜“尝试/继续搜索公共素材”“确认采用这项素材”与对应 `search_public`/`select` 动作，以及后端已删除的 `director-scene-public-search/select` 调用。
- 删除失败卡“重新寻找该镜素材”按钮与 `videoSceneReplacement` 通道；`failure_action` 联合类型去掉 `replace_scene_asset`（后端读取时已把历史值改为 `modify_script`）。对话发送函数中该位置参数保留为 `_retiredSceneReplacement` 占位，避免位置参数错位。
- 删除资源库“公开素材搜索”弹层，以及后端从未存在的 `/assets/public-search`、`/assets/public-import`、`/assets/public-sources`、`/admin/public-sources/*` 调用；删除对应 200 行样式与已删原型屏的 322 行素材源管理样式。
- 起始页能力胶囊去掉“公开素材”；确认卡忽略旧卡片里的 `public_stock` 选项；编导稿摘要去掉“自动补 N 个公共素材”。
- 历史作品：已持久化的公共画面计为“N 个历史素材”“历史素材仅供查看”；来源标签“公共素材”改为“历史素材”；逐镜状态 `candidate_confirmed` 显示“这一镜使用历史素材，仅供查看”；资源库中已导入的公共视频保持可播放。
- 法律文本：条款第 6 节与隐私政策第 3 节删除公共素材检索及 Pexels/Unsplash 披露，跨境提示去掉“素材服务”；`LEGAL_VERSION` 升为 `2026-10-16`。**老用户重新同意门未在本轮实现**，见上方法律文本决定。
- 文档：`API.md`、`DEPLOYMENT.md` 中“退役中，随后端 P1 删除”改为“已删除”；现行原型剪辑器屏“兜底素材”改为“待补素材”。
- 测试：删除只验证公共行为的用例；把以公共素材为夹具的用例改为本地素材；新增反向用例（换素材窗口与逐镜操作无公共入口、候选只请求 local、适配器无公共方法、资源库无公开素材搜索、旧确认卡不展示 `public_stock`、法律文本无图库披露）。
- 验证：`tsc --noEmit` 无错误；`npm run lint` 0 问题；`npm run build` 通过；前端全量 vitest 只剩 1 项失败，且该项在未改动的 `main` 上同样失败（`main` 共 2 项既有失败，与本任务无关）。

## 风险与取舍

- 若先删前端而后端仍返回 `public_asset`，旧数据会进入未知来源分支，须先定 P4。
- 仅把入口藏起来不算退役；P3 必须证明相关入口、状态、类型与文案均已移除。
- 本计划不授权清理探索稿，也不授权改动法律文本。

## 验证方式

- P3 收口：检索 `app/`、`lib/` 不再出现公共素材相关生产代码；新增界面测试证明入口不存在。
- 相关测试通过后，再按需要跑 `test:display-coverage`。
- 本轮文档变更后运行 `npm --prefix MultiMix-Frontend run check:agents`。

## 收口（2026-10-16）

- 用户 2026-10-16 在生产浏览器中确认：老账号登录看到同意页、同意后进入工作台且不再重复出现；新注册账号不重复出现同意页；换素材窗口只剩自己的素材与上传入口。
- 生产：后端五个服务 `812630b3`、前端 `8482531`；生产库 `users` 已补两列；Railway 四个服务的 `MULTIMIX_PEXELS_API_KEY`、`MULTIMIX_PIXABAY_API_KEY` 已删除并读回确认。
- 发布教训见 `MultiMix-Backend/docs/authority/production-release-verification.md`「发布记录与教训（2026-10-16）」。
