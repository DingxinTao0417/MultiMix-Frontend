# 取消生成任务的状态提示收口

> Status: qa
> Owner: frontend
> Last verified: 2026-10-13

## 范围与结果

用户确认将归档会话留下的两份前端改动验证后提交到本地main，不推送。本任务只接管`app/assets/components/asset-generation-job-card.tsx`与`app/assets/__tests__/asset-generation-job-card.test.tsx`的现存增量，不改其它前端文件、生成合同或播放器。

原普通任务卡以terminal作为完成摘要信号，取消任务的阶段可全部结束，但默认或调用方传入的完成文案仍会误显示“内容已生成，可查看”。现存修复让cancelled状态优先显示“本次生成已停止”，对应参数化测试覆盖两种文案输入。取消状态没有被改成成功，没有生成或采用任何产物。

## 本地验证

- 保留main旧组件、放入新增测试：两种取消场景均按预期失败，确认原组件仍有误导提示；见[红灯证据](../../../MultiMix-Backend/docs/qa/evidence/2026-10-13-cancelled-card-and-stash-retirement/frontend-red.json)。
- 放入两份现存改动后：任务卡6项、相邻进度合同27项，共33项通过、0失败；见[回归证据](../../../MultiMix-Backend/docs/qa/evidence/2026-10-13-cancelled-card-and-stash-retirement/frontend-green.json)。
- 两个指定文件的eslint通过，未改实现或测试来绕过失败；代码原字节与主目录获准增量一致。
- L1/L2只支持取消任务的提示及直接进度合同；本轮没有浏览器、后端服务、模型、数据库或付费E2E，不声明完整产品验收。

## 提交与其它改动

修复提交66c29884c711ae9b46edc96e2470fb7d0fae5961只包含两个指定文件及本QA，已由task finish --keep快进合入本地main，无冲突；合入后两文件干净且Git内容指纹匹配该修复。其余四份前端代码、UI探索与临时资料共54条保护路径指纹不变。本次终态记录随后在同一任务树提交并由原生finish收尾，实际最终提交及占用清理见会话终态和[跨仓收口记录](../../../MultiMix-Backend/docs/qa/2026-10-13-cancelled-card-and-stash-retirement.md)。用户授权终点是本地main，无远端推送或发布。
