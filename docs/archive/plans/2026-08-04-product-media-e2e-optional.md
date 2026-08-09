# 产品媒体改为 E2E 可选覆盖

> Status: archived
> Owner: frontend
> Last verified: 2026-08-04

> Execution update (2026-08-04): 已完成。E2E 不再把产品媒体采用数量作为失败条件，仍记录采用结果并保留来源与可读性检查。

## 背景与根因

生产 E2E 的 `animated_explainer` 场景当前把“至少一镜使用产品媒体”及“两个审核产品截图都被
使用”作为硬性断言。用户已明确取消该验收条件：产品介绍视频可以由模型按分镜语义选择已保存素材、
生成画面或审核产品媒体，不能因没有采用截图而把整条视频工程判为失败。

产品媒体的来源、审核状态、artifact 引用可读性与采用后 provenance 仍是安全/一致性约束，不能随此
变更移除。此次仅取消“必须采用”的测试要求。

## 涉及文件与具体改法

1. `MultiMix-Frontend/e2e/video-pipeline-production.spec.ts`
   - 删除 `animated_explainer` 对至少一个 `product_asset` 和两个不同审核截图的硬性数量断言。
   - 保留逐镜主画面已持久化、媒体可读、asset manifest 与工程引用一致、以及任何实际采用
     `product_asset` 时的来源/provenance 检查。
2. 同文件的测试输出
   - 保留 `productPresentation` 为观测数据，说明本次是否采用产品媒体，而不把它当失败条件。
3. 相关前端 E2E 静态/契约测试与文档检查
   - 增加或调整覆盖，证明 `animated_explainer` 无产品媒体时可继续验收，产品媒体实际被采用时仍走
     现有可读性与引用一致性检查。

## 风险与取舍

- 取消的是演示偏好，不是素材安全门禁。产品界面被选中时仍必须来自审核产品媒体目录，且引用可读取。
- 因此 E2E 不再保证“每条产品介绍都展示产品截图”；这是用户明确接受的产品表达取舍。
- 不改变生产选择逻辑、素材匹配或视频工程数据契约，只调整测试验收范围。

## 验证方式

1. [x] 调整 E2E 契约覆盖：产品媒体仍被观测，但不再是 `animated_explainer` 的失败条件。
2. [x] 运行目标前端测试（6 passed）、类型检查和 lint。
3. [x] 运行文档检查。
4. [x] 未自动发起新的真实 Provider E2E；后续真实运行可以把 `productPresentation` 作为观测结果。
