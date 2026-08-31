# 对话确认卡浏览器验收计划

> Status: archived
> Owner: frontend
> Last verified: 2026-08-31

## 背景与根因

已归档的 `2026-08-31-conversation-confirmation-card-consistency-remediation.md` 已修复口播清理确认卡的旧建议残留、确认目标错绑、未关联编导稿追加到对话末尾，以及视频工程完成后历史编导稿仍显示“可确认或修改”的问题。已有单元/接口回归覆盖逻辑；还需要在浏览器中验证刷新后的最终投影。

## 涉及文件与改法

- `e2e/conversation-generation-card-order.spec.ts`
  - 在现有隔离的 `/v1/**` fixture 中加入“口播清理已确认 + 视频工程已 ready + 一张未绑定历史编导稿”的最终会话。
  - 断言确认卡的旧建议不出现，历史编导稿显示已被视频工程消费，未绑定编导稿不被挂到最后一条消息下；刷新后再次断言。
  - 不调用真实后端、LLM 或素材服务；浏览器仅连接独立前端端口。

## 风险与取舍

- 该用例验证前端投影与交互可见状态；旧确认请求的 409 拒绝仍由后端定向测试覆盖，不在浏览器 fixture 中伪造后端业务执行。
- 只扩展现有对话卡片 Playwright fixture，避免修改已被其他任务占用的生产视频 E2E。

## 验证

1. 启动独立前端端口，不启动后端或创建 SQLite。
2. 执行本 Playwright 用例并保存失败诊断；通过后停止本次前端进程。
3. 重跑既有前端定向测试、后端 stale-confirmation 测试、类型检查与文档检查。

## 执行记录

- 浏览器：在独立端口 `3327` 启动仅前端实例，使用 Playwright mock `/v1/**`；未启动后端、未创建 SQLite、未访问真实用户数据。`conversation-generation-card-order.spec.ts` 2/2 通过，并在刷新后重复断言最终状态。
- 前端：确认卡/产物映射定向测试 72/72 通过，`npm run typecheck` 通过。
- 后端：`test_presenter_audio_selection.py -k cleanup_confirmation` 3/3 通过；旧确认重放仍由该接口回归覆盖。
- 文档：`npm run docs:check` 通过。本次独立前端进程已停止。
