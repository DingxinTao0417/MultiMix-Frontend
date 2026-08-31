# 视频 E2E 帮助命令安全修复

> Status: archived
> Owner: frontend
> Last verified: 2026-08-30

## 背景与根因

`scripts/run-video-pipeline-production-e2e.mjs --help` 没有解析帮助参数。脚本在识别参数前读取配置、
创建 E2E lifecycle，并可能创建一次性 SQLite 与 artifact 目录；本次核对因此产生了一次失败后保留的
临时 run。它没有触发 Provider 或生成候选，但帮助命令本身不应产生任何运行副作用。

## 涉及文件与具体改法

- `MultiMix-Frontend/scripts/run-video-pipeline-production-e2e.mjs`：在任何环境读取、端口校验、lifecycle 或
  子进程动作前处理 `--help` / `-h`；仅输出用法、核心环境变量与安全说明，并以成功状态退出。
- `MultiMix-Frontend/scripts/__tests__/video-pipeline-production-env-contract.test.mjs`：新增子进程级回归，
  以隔离的环境调用 `--help`，断言退出成功、输出用法、且给定的 E2E runtime 根目录没有被创建。

## 风险与取舍

- 只新增显式帮助分支，不改变正常 E2E、resume、recompose 或 Provider 调用行为。
- 测试不启动前后端、不创建数据库、不使用环境密钥；它以临时、尚不存在的 runtime 根目录证明无副作用。
- `--help` 只说明如何启动真实 E2E，不暗示可以在未授权情况下调用真实 Provider。

## 验证方式

1. 先新增子进程测试并确认在当前实现上失败（会因缺少运行前置配置而失败）。
2. 最小实现帮助短路后，确认该测试通过且临时 runtime 根目录仍不存在。
3. 运行完整 `video-pipeline-production-env-contract` Node 测试、`docs:check`、`typecheck` 与 work claim 校验。

## 当前执行记录（2026-08-30）

- 测试先行：新增的帮助命令测试在旧实现上如预期失败，旧脚本继续进入 E2E 前置流程并因缺少 Python
  解释器失败；测试 `finally` 已按运行器规则清理其唯一的临时 run。
- 最小实现后：`node --test scripts/__tests__/video-pipeline-production-env-contract.test.mjs` 为 `40 passed`；
  帮助命令退出成功且未创建匹配的 E2E runtime 目录。
- `npm run typecheck`、`npm run docs:check` 通过。没有启动 Provider、前后端服务或真实 E2E 流程。
