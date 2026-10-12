# 清晰度前端未提交改动迁移与本地收口

> Status: active-plan
> Owner: frontend
> Last verified: 2026-10-12

## 背景与根因

主目录 main 留存画质任务的前端实现，阻止 topbar-nav-segment-annotation 快进合并。用户当次明确授权 Codex 接手前端迁移、验证、窄路径提交与本地合并。功能尚有效，不采用废弃撤回路线。

## 归属与范围

- product-preview.tsx 的 clarity_media 播放来源、VideoClarityReview 与缓冲期分镜跳转属于本任务；video-version-comparison.ts 的 clarity 比较及其测试同属本任务。
- conversation-studio.tsx 的 ClarityProcessingNotice、library-workshop.tsx 的审查入口、confirm-card.tsx 的确认合同，以及 adapter、types、lib/api.ts、lib/asset-mappers.ts 的清晰度投影同属本任务。
- video-clarity-* 组件、类型、展示辅助、CSS 与三份测试属于本任务。e2e/display-area.spec.ts 的 document 请求过滤是本任务展示验证修正。
- 混合文件 asset-workspace-types.ts、lib/asset-mappers.ts 中 referenceAssetIds / estimatedWaitSeconds 及 asset-mappers.test.ts 的多素材确认测试属于其他任务，必须留在主目录且不纳入本提交。
- asset-generation-job-card 及测试、tsconfig、媒体缺口文档和其他未跟踪文件不属于本任务。
- 对方分支的 videoVersionReuseScope、其余镜头复用提示、顶栏及批注保留不动；本任务先合入，对方在自己的分支处理后续组合冲突。

## 方法与风险

1. 确认对方已释放实际占用；用原生 task start 创建 frontend worktree。仅迁移自己的23个源码/测试文件与本计划。
2. 保存主目录各文件字节备份、HEAD、所有脏路径哈希、自己的增量与应留下的他人增量。按 hunk 分离三个混合文件，不能整文件覆盖。
3. worktree 完成聚焦/相关离线验证、类型、lint、原生离线展示检查与构建。不改变受保护播放器外壳，不执行付费模型、部署或推送，收费增强保持关闭。
4. 窄路径提交，逐文件核对主目录未发生漂移后，仅撤去自己的已备份增量；混合文件保留他人增量，新文件只撤去已迁移的本任务副本。
5. task finish 快进本地 main；核对文件干净与他人字节一致。任何漂移、冲突或验证失败停止对应阶段并报告，不能删除别人的锁或改测试掩盖失败。

备份目录：C:/Users/24566/Desktop/multimix-test-results/video-clarity/frontend-migration-20261012。备份保留至对方后续合并核验，便于回溯，不纳入仓库。

## 验证

- L1/L2：清晰度组件/展示/研发状态、版本比较、预览、映射、确认与相关消费测试。
- typecheck、lint、test:fast、build；check:agents、check:video-preview-contract、test:product-stage-style。
- 隔离 test:display-coverage，使用一次性 SQLite 与独立8299/3219端口，finally 清理，不连接 Supabase 主库。实际运行前通知精确测试库路径。
- 检查提交只含本任务增量，主目录 index 为空，其他改动保持。离线结果不能代表真实增强质量或完整画质任务完成。

## 清单

- [x] 归属核对、备份与 worktree 迁移。
- [x] 离线验证与窄路径提交。
- [ ] 主目录副本处理、原生本地合并与最终核验。

## 验证中修正

- 原 main 预览组件的下载/导出94项全通过；迁移候选新增审查请求使4项有序全局 fetch 夹具失败（共享 Response 正文被审查读取、或额外请求违反零下载断言）。在 product-workspace-video-actions.test.tsx 单独 mock 审查读取，与已有独立电影审查 mock 同边界；审查组件自身 API/权限测试仍覆盖该请求。保持下载断言与产品实现不变。新增此测试文件到占用，按相关L2重新验证。
- check:agents 的 docs:check 因主目录后端已完成 lint handoff 未归档失败；属于原有文档分类问题，不夹带后端文档修改。播放器独立合同与样式检查通过。

- 展示首轮因合成版本不存在于真实后端，清晰度读取返回409，被版本对比用例的无控制台错误断言拦截。与其既有 feedback 合成夹具一致，为本用例补同身份 not_reviewed 投影，并断言没有合格审查结论；不全局忽略409，不改后端身份门。品牌包下载的独立失败须基线验证，不改变该断言。首轮验收遇失败后已停止后续测试，finally停止进程，原生cleanup删除一次性库。

## 验证结果（本次迁移）

- 6份聚焦：164 passed；下载/导出：94 passed。test:fast 全体 Vitest 1758 passed、demo 8 passed、脚本296 passed/1 skipped，层级重叠不累计。typecheck、lint、build、独立播放器与样式合同通过。
- 首轮完整展示43组件通过，浏览器运行遇品牌包和合成版本审查夹具失败后停止，不能称完整46项通过。品牌包失败在原main预览下复现，保留失败；合成审查夹具修正后 CASE-07 浏览器5 passed/1 skipped（恢复专项默认跳过），43展示组件通过。主目录后端已完成 lint handoff 未归档导致 check:agents 的 docs:check 失败，非本次前端修改。
- 三轮测试库与本轮8299/3219进程均清理。源码无真实模型/GPU/收费/部署操作。证据日志、补丁与他人哈希保全在备份目录。
