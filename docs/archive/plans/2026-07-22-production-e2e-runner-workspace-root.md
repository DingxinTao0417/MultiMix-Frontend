# 生产视频 E2E Runner 工作区根路径修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-22

## 背景与根因

`MultiMix-Frontend/scripts/run-video-pipeline-production-e2e.mjs` 将 `frontendRoot` 的上两级目录当作 `workspaceRoot`。当前实际布局为 `<workspace>/MultiMix-Frontend`，因此上两级是 Desktop 而非工作区。runner 随后把默认源文档、canonical 后端虚拟环境和 BGM 曲库错误解析为 `C:\Users\24566\Desktop\...`，在任意数据库或服务启动前失败。

`MULTIMIX_BACKEND_ROOT` 只能覆盖部分后端运行目录，不能纠正 `canonicalBackendRoot` 的 BGM stage 路径；不能通过复制、软链接或临时伪造曲库绕过该问题。

## 涉及文件与关键位置

- `MultiMix-Frontend/scripts/run-video-pipeline-production-e2e.mjs:17-22`：工作区、默认后端和默认源文档路径。
- `MultiMix-Frontend/scripts/__tests__/video-pipeline-production-workflow.test.mjs`：新增静态工作区根路径契约。

## 具体改法

1. 先在 workflow contract test 中断言 runner 从 `frontendRoot` 上一级取得 workspace root，并据此派生 `MultiMix-Backend` 与 `MultiMix-商业计划.md`。
2. 运行该静态测试，确认旧的 `"..", ".."` 路径导致 RED。
3. 将 workspace root 改为 `path.resolve(frontendRoot, "..")`；保留显式 `MULTIMIX_BACKEND_ROOT`、`PYTHON` 和 `VIDEO_PIPELINE_SOURCE_DOCUMENT` 覆盖能力。
4. 运行静态测试、lint 和文档检查后，重跑已获用户批准的隔离完整视频 E2E；不得变更原始已审核截图、曲库审核门或生产功能代码。

## 风险与取舍

- 仅修测试 harness 的默认路径，不改变产品路径、部署配置或运行时存储。
- 环境变量覆盖仍可支持 worktree；默认值改为当前工作区的真实相对结构。
- E2E 继续使用一次性 SQLite、ArtifactStore、独立端口和 finally 清理。

## 验证方式

- RED/GREEN：`node --test scripts/__tests__/video-pipeline-production-workflow.test.mjs`。
- `npm --prefix MultiMix-Frontend run lint`、`npm --prefix MultiMix-Frontend run docs:check`。
- 完整生产 E2E：使用已审核的 `artifacts/approved-product-media/1.png` 与 `2.png`，验证六分镜、产品素材采用、BGM、字幕/旁白、重组与 MP4 契约。

## 测试副作用核对（2026-07-22）

`NEXT_DEV_DIST_DIR=.next-video-pipeline-<run-id>` 确实会使 Next 自动改写 `tsconfig.json` 和 `next-env.d.ts`。runner 已有快照和恢复逻辑，但 r4 显示其顺序不安全：当残留 Next 子进程占用临时构建目录时，`fs.rmSync(.next-video-pipeline-<run-id>)` 会在 `finally` 中先抛错，后面的 `restoreFiles(workspaceSnapshots)` 因而未执行。

修复为在 finally 中先恢复两份受控配置，再进行可能失败的临时目录清理，并在清理循环结束后再次恢复同一快照，覆盖 Next 子进程退出收尾的晚到写入；静态测试固定两次恢复的顺序。恢复只覆盖运行器启动前已快照的明确文件，不处理其他用户路径。

## 实施与验证结果（2026-07-22）

- 默认工作区根已修正为 `path.resolve(frontendRoot, "..")`；静态 RED/GREEN 通过。
- 已审核产品截图 r6 生产 E2E 完整通过，runner 自然收束后确认 SQLite、ArtifactStore、隔离 Next 构建均不存在，后端/前端端口均无监听。
- r6 还暴露了 Next 的晚到配置写入；已补第二次恢复与静态契约。该最后的恢复顺序由静态测试覆盖；当前工作区受控配置已恢复为运行前内容。
