# 保留视频 E2E 的输入合同恢复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-09-22

## 背景与根因

保留运行 `20260921-full-acceptance-idea-r6` 的清单记录了 `videoType=explainer` 与 `inputProfile=explainer_idea_only`。恢复入口此前仅要求调用者重新提供视频类型，未恢复输入档案；缺省值因此变为 `explainer_default`，将本应无源文档的任务改为读取默认商业计划，并在清单校验中表现为 `sourceDocument` 指纹差异。该失败发生在任何服务启动或供应商调用之前。

这是恢复配置没有以保留清单为权威的问题，不是应通过手工补环境变量绕过的问题。恢复模式必须能够重建保留任务的语义输入合同，并在调用者显式提供与清单冲突的值时 fail closed。

## 具体改法

1. `scripts/e2e-run-lifecycle.mjs`：增加只读的保留 run-state 查询接口。它只校验 run ID、保留状态和状态文件，不获取运行所有权、不写入状态，也不触碰 SQLite。
2. `scripts/run-video-pipeline-production-e2e.mjs`：在解析恢复命令后通过只读接口读取 run-state 所指向的 `run-manifest.json`，以清单的 `videoType` 和 `inputProfile` 作为未显式传入时的默认值。
3. 对显式传入且与清单不同的 `VIDEO_PIPELINE_VIDEO_TYPE` 或 `VIDEO_PIPELINE_INPUT_PROFILE` 立即报出稳定、明确的恢复合同错误；正常新建运行维持现有默认行为。
4. 调整帮助文本，说明 `--resume` 会恢复这两项已冻结的输入身份。
5. `scripts/__tests__/video-pipeline-production-env-contract.test.mjs`：新增静态合同回归，证明恢复入口读取清单、使用冻结档案、拒绝冲突覆盖，且普通运行仍保留默认档案策略。

## 风险与取舍

- 清单缺失、字段缺失或字段不合法时不猜测输入，而是明确失败；现有 `assertResumeManifest` 继续校验其余身份字段。
- 本次不把本地源文档路径写入清单；对需要源文档的档案仍保留原有指纹校验，避免将临时路径作为可恢复内容。

## 验证

- L1：新增恢复配置合同测试。
- L2：运行 E2E runner 的环境合同测试与脚本语法检查。
- L3：复用保留运行、数据库和确认状态；输入身份恢复后从编导生成重试。记录原始 run ID、恢复的 profile、重新运行范围与失败回退点。



## 实施记录（2026-09-22）

- 新增只读保留状态查询，恢复预检可读取已有运行清单而不取得任务所有权、不写状态、不检查或修改 SQLite。
- 恢复时未传入的视频类型与输入档案现在从清单恢复；显式传入但与清单冲突时 fail closed。普通新运行、质量基线的显式选择要求和其余 manifest 指纹检查保持不变。
- TDD 先新增恢复合同测试并在旧实现失败；实现后环境合同与生命周期回归共 109 项通过，`docs:check` 和开发占用复核通过。下一步从同一保留任务重试 L3。



## 第二次恢复补充（2026-09-22）

### 根因

恢复预检已正确恢复原输入合同，但在进入产品 API 前，测试运行器用一份旧的失败码白名单决定是否可发起用户可见的 retry。白名单没有 `provider_invalid_json`，而该码已由 worker 定义为“供应商结构化输出失败，可直接重试”；同时白名单误含 `quality_rejected` 与 `internal_error`，两者不是供应商可恢复失败。

### 具体改法

1. `scripts/run-video-pipeline-production-e2e.mjs`：重试授权仅允许明确的供应商/传输失败码，包括 `provider_invalid_json`；移除 `quality_rejected` 与 `internal_error`。仍须校验失败事件和 job 的失败码一致、没有结果资产、身份未变，之后才由公开 retry API 执行。
2. `scripts/__tests__/video-pipeline-production-env-contract.test.mjs`：覆盖供应商结构化失败可恢复、质量拒绝和未知内部错误不可恢复，避免今后新增失败分类时扩大重试面。

### 风险与验证

- 该白名单只决定保留 E2E 是否可复用同一用户已确认任务，不改变产品 worker 的失败分类或 API 授权；不在此处实现“错误字符串包含 provider 即可重试”的模糊规则。
- L1/L2：运行更新的环境合同与生命周期回归、文档检查。
- L3：在输入身份已验证不变的保留运行上，从现有 `provider_invalid_json` 失败恢复。若 API 或质量门返回新的失败，立即停止。



### 实施记录（2026-09-22）

- 保留 E2E 重试授权现在只允许明确的供应商/传输失败码；新增 `provider_invalid_json`，移除 `quality_rejected` 与 `internal_error`。失败事件、当前尝试、无结果资产、身份与输入完整性校验仍是重试前置条件。
- TDD 先让新的白名单合同失败；环境合同与生命周期回归 109 项、`docs:check` 和占用复核通过。下一步以同一保留任务运行公开重试。

