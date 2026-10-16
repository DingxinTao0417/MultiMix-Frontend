# 产品设计文档去冗余与旧原型清理

> Status: archived
> Owner: frontend
> Last verified: 2026-10-16（文档与引用核对；不代表产品 E2E 验收）

## 背景与根因

用户在本会话确认执行已审查的清理清单，并确认导航以工作台设计中 2026-10-14 的决定为准：资源库四入口在导航面板顶部横排展示。旧探索原型、未完成 HTML 和无引用图片仍保留在设计树中；视觉规范第 78 行仍重复过期的单列导航规则；两份专项规范与主设计/API 重复；一份已完成修复计划仍声明等待推送和 CI 转绿。

基线：前端 `d68435a`、后端 `17ef28f3`，两仓工作区干净。仅修改前端文档与静态原型入口，不修改产品代码、后端、素材数据、播放器视觉合同或有效 QA 证据，不提交、推送或部署。

## 涉及文件与具体改法（行号为变更前）

- `docs/specs/ui/prototypes/explorations/`：删除 `2026-07-08-round1-visual-style/`、`2026-07-08-round2-space-model/`、`2026-07-08-round3-workbench-options/`、`2026-09-24-conversation-empty-template-options/`、`2026-10-10-uiux-directions/`。前四组是已选定/替代的历史方案；最后一组只有未完成样式。合计 24 个文件。
- `docs/specs/ui/prototypes/current/assets/start-goal-story.webp`：删除无引用图片；与上项合计 25 个文件、416775 字节。
- `docs/specs/ui/prototypes/current/index.html:38`、`prototypes/explorations/README.md:9–17`、`docs/specs/ui/agentic-workbench-design.md:10,14,78,125`：移除已删除目录的入口，保留决策摘要和 Git 历史追溯方式。导航组件只保留视觉规则，行为链接到工作台设计第 3、4 节；仍保留的选型注明历史属性，补充 active plan 使用的 canvas 全站方案入口。
- 原专项文件 conversation-loading-and-reply-motion.md（原位于 docs/specs/ui/，本轮删除）：将全部有效要求和验证案例合并进 `agentic-workbench-design.md` 的动效章节。保留历史骨架与助手等待的区别、真实阶段边界、500ms/300ms/1.6s、减弱动态效果及失败恢复。
- 原专项文件 runtime-data-source-and-offline-empty-state.md（原位于 docs/specs/ui/，本轮删除）：将数据状态、操作门禁、认证错误、fixture 隔离及验证案例合并进 `docs/API.md` 架构章节。保留所有独有规则，不迁移过期示例布局为新产品承诺。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:11–31,561–598`：产品定位引用唯一总纲，保留本页独有的原视频上传/确认交互；运行时与后端技术边界引用 API 的合并章节、环境变量及扩展边界，保留章节锚点。§14 和播放器外壳合同逐字保留。
- `docs/archive/plans/2026-07-12-conversation-loading-reply-motion-implementation.md:34`、`2026-08-25-lly-29-runtime-write-capability-gating.md:19`：仅补充新权威位置，保留历史记录性质，不留失效链接。
- `docs/plans/active/2026-10-11-presenter-category-retirement-wording.md:42–50`：修复提交 `45344f8` 已进入 `origin/main`，已核对 `8482531` 的 CI 成功。更新当前状态后移动到 `docs/archive/plans/`，保留原停点作为历史；本轮再跑原契约测试。
- `docs/README.md`：更新视觉/动效和运行时数据规则的入口说明。本计划完成验证后移入 `docs/archive/plans/`。

## 风险与取舍

- 删除历史方案减少本地浏览材料；用户已批准清理，原始文件仍可从 Git 基线恢复，不新增重复备份。
- 合并时可能漏掉唯一约束：迁移后逐条对照原文；保留验证案例，不改测试期望来适配遗漏。
- 删除后可能产生断链：同轮更新当前入口和直接引用，扫描两仓引用与原型 HTML/CSS 资源。
- 不删除整个 explorations/current 目录；保留 canvas 全站方案、三组 10 月 11 日探索、品牌规范、视频专项规格、当前屏幕与有效测试证据。
- 不解决本轮以外的产品交互歧义或实现问题，不把文档核对声明为功能验收。

## 任务与完成口径

1. [x] 设计落盘、精确范围开发占用及基线指纹；文档检查通过。
2. [x] 删除 25 个旧文件并修复入口；本地原型链接和文档检查通过。
3. [x] 规范合并、导航口径修正和旧计划归档；要求迁移对照及相关契约测试通过。
4. [x] 最终 diff/引用/保留文件指纹核对、必要检查和计划归档，释放开发占用。

每完成一项立即按工作区固定格式报告进度。阶段边界运行 work claim check；发现晚到改动停止覆盖并核对。

## 验证方式

测试层级 L1/L2（文档结构与直接契约），外部供应商调用 0。运行 `npm run docs:check`、`npm run check:agents`、`npm run test:product-stage-style`，以及 `npx vitest run app/assets/__tests__/source-video-language-contract.test.ts`。原型扫描检查 HTML 的 href/src/poster 与 CSS url；扫描已删除路径的剩余引用，逐字核对播放器合同与所有保留的原型屏幕/资源。运行 `git diff --check` 和前后端 Git 状态检查。

本轮没有产品运行代码、路由、依赖或媒体画布变更，不启动 E2E/UI 服务、不建 SQLite、不执行付费生成或生产操作；离线检查只能证明本次文档整理及直接契约。

## 执行记录

- 已取得 `product-design-doc-cleanup-20261016` 开发占用，精确登记上述文档、删除目录和归档目标；无占用冲突。已保存全部 tracked docs 的临时 SHA-256 基线，阶段 1 的 docs:check 与占用 check 通过。
- 阶段 2：删除前逐文件核对指纹，无晚到修改；已删除上述 25 个文件（416775 字节）与五个目录。同步移除当前原型历史入口、视觉规范旧引用，探索索引保留当前方案与历史属性。docs:check、原型 HTML/CSS 本地引用扫描及占用 check 通过。
- 阶段 3：两份旧专项规范的独有规则与验收案例已迁入视觉规范 §6.1/API §1.4；保留数据/认证/操作门禁、fixture 隔离和全部动效边界，删除原文件。导航以 2026-10-14 确认的顶部横排为准；主设计定位和技术边界改为引用，旧分类措辞修复计划归档。修复清理计划对已删除文件的误引用后，docs:check、原契约测试 3/3、diff --check 和占用 check 通过。
- 最终核对：40 份保留的当前原型屏幕/资源、canvas 全站原型、产品总纲、品牌与视频专项规格指纹不变；主设计 §8.3 视频产物和 §14 内部流水线逐字不变。18 处新增/更新 Markdown 链接及章节锚点有效，原型 69 处 HTML/CSS 本地引用无缺失；删除路径只保留在本清理历史记录中。
- L1/L2 结果：docs:check（约 1.1 秒）、check:video-preview-contract、test:product-stage-style、原视频语言契约 3/3（Vitest 约 0.1 秒）和 diff --check 通过；前后端各自 agent 薄入口检查通过。无外部供应商调用，无付费、数据库、进程或生产变更。
- 已有检查阻塞：check:agents 在工作区根 `CLAUDE.md` 处失败（缺少独立 `@AGENTS.md` 导入行、按脚本计 61 行超限、重复 5 个规则章节）。根 agent 文件不在本轮修改范围；未为让检查通过而改写它们。文档与播放器检查已独立执行通过，不将总入口检查报告为通过。本轮不修复此独立指南问题，也不运行与文档清理无关的应用构建/完整 E2E。
- 阶段 4 收口：已确认 27 个文件删除、8 个现有文件更新、1 份旧计划归档与本清理记录新增；其余 tracked docs 与基线一致，无暂存或无关改动，后端保持干净。本计划已归档，开发占用已释放；所有变更保留为前端未提交修改，未推送或部署。临时基线随收尾清理。
