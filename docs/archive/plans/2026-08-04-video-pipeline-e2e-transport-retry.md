# 视频流水线 E2E 可恢复连接重试

> Status: archived
> Owner: frontend
> Last verified: 2026-08-04

> Execution update (2026-08-04): 已完成。MG 终态轮询对单次传输异常复用既有 poll 重试，持续故障仍按原超时失败。

## 背景与根因

真实 Provider E2E `e2e-product-media-optional-20260804-01` 在等待 MG job 终态时，一次
`GET /v1/assets` 出现 `ECONNRESET`，该 poll 回调没有捕获传输异常，Playwright 立即中止。后端日志
显示此前和随后同一接口持续返回 200，因此这是一次可恢复的测试传输抖动，而不是已确认的业务失败。

同一 E2E 中其他长轮询已经把传输异常返回为 `transport-error:*`，由 poll 在既有总超时内继续重试。
MG 终态轮询应使用同一策略：持续故障仍会在 15 分钟上限失败，不能被静默吞掉。

## 涉及文件与具体改法

1. `MultiMix-Frontend/e2e/video-pipeline-production.spec.ts`
   - 为等待 MG job 终态的 `/v1/assets` 请求添加与其他 poll 一致的 `try/catch`。
   - 单次异常返回可见 `transport-error:*` 状态，让既有 `expect.poll` 间隔重试；HTTP 非 2xx、MG 全部失败
     和超时的原有失败语义不变。
2. `MultiMix-Frontend/scripts/__tests__/video-pipeline-production-env-contract.test.mjs`
   - 增加静态契约，确保 MG 终态轮询保留传输异常的可恢复返回，而非一次异常直接抛出。

## 风险与取舍

- 只容忍测试连接抖动，不把业务错误转为成功。若服务持续不可用，poll 会按原 15 分钟上限失败并显示
  `transport-error`。
- 不改后端、MG dispatcher 或生产错误处理；本次仅修复 E2E 的不一致重试行为。

## 验证方式

1. [x] 已加入契约用例，并确认旧 MG 轮询缺少传输保护。
2. [x] 运行目标 Node 契约测试（7 passed）、类型检查和 lint。
3. [x] 运行文档检查。
4. [x] 未自动再次调用真实 Provider；获得用户明确确认后才用完整 E2E 验证。
