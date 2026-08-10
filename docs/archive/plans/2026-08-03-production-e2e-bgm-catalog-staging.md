# 生产视频 E2E 的 BGM 清单隔离配置修复

> Status: archived
> Owner: frontend
> Last verified: 2026-08-03

## 背景与根因

真实 PDF E2E `2026-08-03-pdf-manifest-diagnostics-8352` 已通过编导和素材清单阶段，但在视频工程读取 BGM 清单时失败。运行器把 `VIDEO_PIPELINE_EXPECT_BGM=false` 解释为“不验收 BGM”并不暂存目录，但编导模型仍可能输出 `bgm_plan.enabled=true`，后端因而读取一个从未写入隔离 ArtifactStore 的默认路径。

`EXPECT_BGM=false` 必须同时约束本次编导请求为无背景音乐，让后端不会选择 BGM；它仍只用于 E2E 场景，不能改变生产后端的用户选择语义。若 `EXPECT_BGM=true`，运行器继续使用已审核目录；本地缺失审核目录时应明确启动失败，而不是伪造目录。

## 涉及文件与具体改法

1. `MultiMix-Frontend/e2e/video-pipeline-production.spec.ts:470-485`
   - 当 `VIDEO_PIPELINE_EXPECT_BGM=false` 时，在同一真实用户指令中明确要求无背景音乐和 `bgm_plan.enabled=false`，不改变其他编导、证据或素材要求。
2. `MultiMix-Frontend/scripts/run-video-pipeline-production-e2e.mjs:648-655`
   - 仅在 `EXPECT_BGM=true` 时暂存审核 BGM 目录；`false` 时传递空 catalog 配置，由无 BGM 编导稿避免后端加载。
3. `docs/plans/active/2026-08-03-product-media-catalog-role-contract.md`
   - 记录该轮已经越过素材清单；产品媒体角色的最终验收等待 BGM 测试配置修复后重跑。

## 风险与取舍

- 该开关只用于没有本地审核目录的 E2E 场景；`EXPECT_BGM=true` 继续覆盖真实 BGM 目录和音频质量，不以测试禁用替代生产能力。
- 若模型仍违反无 BGM 指令并启用音乐，测试应失败关闭并暴露该契约偏离，不能伪造或静默选择音乐。

## 验证方式

- 对运行器做静态检查与现有生产 E2E 启动路径检查。
- 使用同一 PDF、审核截图、独立 SQLite 与端口重跑 E2E；验收为 `EXPECT_BGM=false` 下不再出现 BGM manifest 加载，且不强制断言音乐成品。

## 执行清单

- [x] 固定“不验收 BGM 必须请求无音乐编导稿”的契约。
- [x] `EXPECT_BGM=false` 时请求无 BGM 并不暂存目录。
- [ ] 完成静态、文档检查和真实 PDF E2E（最近一轮在进入 BGM 前因前置编导调用的 `invalid_json` 停止，未能验收本计划）。
