# 历史视频失败通知与成片下载验收

> Status: active-plan
> Owner: frontend
> Last verified: 2026-09-26

**2026-10-13文档库存核对：** 本计划保持未完成，Owner仍为frontend。下文61项测试和L3失败是2026-09-26历史结果，本轮没有重新测试；公开素材质量拦截后未形成新工程或MP4，下载UI未验收。本轮仅保全并收口文档，素材生成细节、质检以及后续产品复测由对应会话独立处理，不在本计划内自动启动新模型调用、付费、部署或代码修改。

## 背景与已确认根因

四镜断点复测的当前视频任务 `video-job-fa29fd6ea959` 与工程 asset 35 均已完成，原始导出 `video-export-a7a1bf038b91447c8210` 也返回 completed、915 帧和文件质量 pass。但工作台浏览器出现历史失败任务的通知，持续遮挡右上角“导出视频”按钮，第二次点击超时，没有保存 MP4。失败截图与公开任务状态分别保存在前端 `test-results/video-pipeline-production/20260923-opening-rhythm-r1/attempt39-parse-aware-json/`；不能把历史通知中的 22.3 秒误归因于本轮成功任务。

`app/assets/components/assets-workspace-client.tsx:324-357` 会收集所选对话所有历史 execution anchor 与旧产物的 `latest_job_public_id`；`1330-1345` 将这些 job 在每次挂载时加入轮询；`1409-1424` 首次观察到已失败的旧任务也调用 `toast.error`。历史失败卡片应保留，但打开对话不应把历史终态再次冒充刚发生的错误。`app/layout.tsx:15` 的通知位于右上角，恰好覆盖工作台右上角导出按钮。下载脚本 `test-results/.../attempt39-parse-aware-json/export_from_workbench.mjs:120-135` 只等按钮 enabled，没有处理已完成导出后页面上仍显示的旧通知。

## 改法与取舍

1. 对视频任务保留现有持久化状态轮询、历史失败卡片、当前任务失败即时提醒。增加一次会话内的“观察到运行中或由本页主动重试”记录，只有这类任务从活动态变为失败时才弹即时 toast；首次载入就已处于失败终态的历史任务只更新卡片，不弹 toast。首次载入就已成功的任务也不产生额外提醒。新任务若在第一次轮询前已失败，卡片仍展示真实失败与重试入口；避免为了提示而重新播放旧失败。
2. 验收脚本保持产品原生操作：确认**当前**工程和导出公开状态均 completed 后，如页面仍有不相关通知，用其可见关闭按钮正常关闭，再点击下载；若当前任务本身失败，仍立即停止，不能用关闭通知绕过失败。记录通知文本/数量与下载动作证据，避免无条件强制点击或直读内部产物。
3. 不调整视频时长门、后端任务状态、Sonner 全局层级或通知持续时间；这些不是已证实的根因。

## 涉及文件与验证

- `app/assets/components/assets-workspace-client.tsx:815-823,1330-1480,1610-1625`：通知资格与重试生命周期。
- `app/assets/__tests__/agent-ui-copy.test.ts:190-265,700-1060`：先 RED 后 GREEN，覆盖历史 failed 首见不通知、运行中转 failed 通知、明确重试后失败通知、终态只提示一次。
- `test-results/video-pipeline-production/20260923-opening-rhythm-r1/attempt39-parse-aware-json/export_from_workbench.mjs:120-135`：当前任务成功核验后关闭无关通知，正常点击下载，记录结果；该文件是隔离验收脚本，不改产品 API 或内部数据。
- 先跑聚焦前端测试、类型/静态检查与脚本自测；再按 `test-scope-and-cost-control.md` 记录 L3 复用四镜源 checkpoint、最早失效阶段及外部调用预算，经产品公开 replay 与工作台复测下载、MP4 时长和逐镜画面。一次性 SQLite 仍为 `MultiMix-Backend/.tmp/visual-choice-l3/runtime.sqlite3`，事前通知并在结束清理。

风险：旧任务在页面打开时刚好失败，若未观察到运行中，可能没有 toast，但真实失败仍留在对应任务卡片；这比把多年前的失败重新弹出更符合状态归属。验收中的历史通知可能来自多个旧任务，脚本仅在当前任务已公开确认成功后处理，不屏蔽新的真实失败。

## 实施与本轮验收状态

前端通知逻辑已按上述方案最小修改：首次加载就失败的旧任务不弹即时 toast；本页观察到运行中的任务及主动重试任务仍可在失败时提醒，终态后清理资格。先 RED 后 GREEN，聚焦 61 项通过，TypeScript typecheck、聚焦 ESLint、docs check 通过。隔离下载脚本在核对当前工程/导出 API 均 completed 后才通过通知关闭按钮清理页面遮挡，不使用强制点击；脚本语法和等待逻辑自测通过。

attempt40 的 L3 范围与 80 次预算记录在 `test-results/video-pipeline-production/20260923-opening-rhythm-r1/attempt40-historical-notice-download/test-scope-record.json`。同一源四镜的公开 replay job `asset-generation-job-dbac29d5a89540ebbcba17c1f37ae29e` 在编导资产保存前 `quality_rejected`：第 2 镜公开素材搜索得到 30 个原始候选，但预览核验的 9 个样本为 7 个 `mismatch`、1 个 `analysis_unavailable`、1 个画幅不兼容。目标视觉条件包含可见白色包子、竹蒸笼、连续蒸汽、暖色逆光，并排除人脸/手和现代不锈钢器具；实际候选缺少其中的主体或动作，部分出现禁用元素。两条查询为 `steaming baozi in bamboo steamer close up` 与 `hot dumplings rising steam macro shot`。这轮没有形成编导 asset、工程或 MP4，也没有进入下载 UI 验收。62 次 LLM 观察低于预算 80。隔离后端/前端和一次性 SQLite/素材副本均已停止、清理，源 checkpoint 未改变。

已确认的是“当前过细的必要画面条件与搜索结果不匹配，预览核验无法给出可放行候选”；尚不能断言任意候选在放宽某个条件后就适合发布，也不能把 1 次 `analysis_unavailable` 当成内容不相关。按质量失败门停止自动修复和复测。后续若获用户确认，应从生成侧区分表达必需的主体/动作与审美偏好，用真实可执行的来源能力约束镜头设计；当公开素材仅缺次要审美元素时交由模型选相关性最高且画质合格的 `partial`，真正缺核心主体、出现禁用元素或画质不可发布仍拒绝，并在无公共素材可用时向用户明确提供改镜头、生成图像等产品能力内选项。先写非早餐样本 TDD，再从仍有效断点恢复产品验收，禁止为包子样本单独放宽门槛。
