# 保留视频E2E：输入身份与恢复边界

> Status: active-plan
> Owner: frontend
> Last verified: 2026-10-19（历史分离，未重新执行真实E2E）

## 当前合同

原65行根因、两轮TDD及2026-09-22实施记录已[完整归档](../../archive/plans/2026-09-22-retained-video-e2e-input-contract-history.md)。现行消费者仍为scripts/e2e-run-lifecycle.mjs、scripts/run-video-pipeline-production-e2e.mjs及其环境/生命周期契约测试，本轮不改运行器。

- --resume先只读校验保留run-state及其manifest；未显式传入的videoType/inputProfile从冻结清单恢复，不回落为普通新运行默认档案。
- 显式传值与清单冲突、清单缺失或字段非法时，在服务启动和供应商调用前失败关闭。该只读预检不获取运行所有权、不写状态或SQLite；其它manifest身份和源文档指纹校验继续有效。
- 普通新运行的默认策略保持；源文档不能只凭旧本地路径恢复，必须按当前指纹核验真实内容。
- 保留任务只允许当前明确列举的供应商/传输可恢复失败（含provider_invalid_json）发起公开retry；quality_rejected、未知internal_error不能靠字符串匹配变为可重试。失败事件、当前尝试、无结果资产、归属与输入身份仍须一致。

## 未闭合验证与接续

原运行20260921-full-acceptance-idea-r6及两次109项离线通过是当时记录，不代表该运行现在仍存在、可直接恢复或已完成产品L3。原文“下一步重试”保留为历史，不作为自动执行授权。

若继续验收，先按[当前测试范围规则](../../../../MultiMix-Backend/docs/authority/test-scope-and-cost-control.md)核对完整输入、来源/模型/提示/代码指纹及最早失效阶段，再从公开恢复边界执行；真实质量失败按当前停止条件处理。新服务须使用独立端口，数据库和保留运行的处理遵守根AGENTS，不擅自删除用户保留数据。

本轮未启动运行器、服务或数据库，未调用真实Provider，也未新增浏览器/生产验收结论。
