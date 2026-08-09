# 前端三套换素材入口单轨收口实施计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-17

## 背景与根因

后端本地 `main` 已删除 `asset-suggestions`、`replace-options` 和素材候选 v2 flag，唯一生产链路是：

- `GET /v1/video/projects/{asset_id}/segments/{segment_id}/material-candidates`
- `POST /v1/video/projects/{asset_id}/segments/{segment_id}/recompose`

前端三个“换素材”入口虽然已经能调用统一候选接口，但仍保留旧版本代码：

- `app/assets/lib/asset-workspace-adapter.ts:237,942-975` 暴露并实现 `loadSegmentMaterialOptions`，继续调用已删除的 `asset-suggestions`。
- `app/assets/lib/asset-workspace-adapter.ts:985-988` 把统一接口的 404 当作 v2 flag 关闭，并返回 `v2Disabled`。
- `app/assets/lib/use-segment-material-candidates.ts:82-96` 在 404 后回退旧接口。
- `editor-engine/vendor/api.ts:77-93` 仍包含 `replace-options` 客户端，且 `:124-143` 保留 disabled 分支。
- 工作台、FilmStrip 和 ReplacePanel 在候选缺少 `candidate_id` 时仍会提交 `asset_id`。
- `docs/API.md` 与素材引用权威文档仍描述过渡接口和双提交方式。

这不是可接受的降级：当前后端已经没有旧路由，继续保留前端 fallback 只会把真实 404 转成另一组 404，也违反用户已确认的“新实现是唯一版本，回滚依赖 Git/部署版本”原则。

## 目标与边界

- 三个入口只读取 `material-candidates`，只通过 `recompose` 提交服务端签发的 `candidate_id`。
- 所有可选择的本地和公共候选都必须携带 `candidate_id`；当前正在使用的不可选项可以没有。
- 404 表示工程或分镜不存在，按真实错误展示，不再解释为功能开关或触发旧接口。
- local 先返回、public 后加载；公共 provider 失败只影响公共分组，不影响本地候选。
- 删除旧客户端函数、类型、测试、文案和权威文档中的过渡描述。
- 后端 `recompose.replace_material` 同步移除 `asset_id` 兼容输入，避免一套接口保留两种版本语义。
- 不改变播放器外壳、MG overlay、上传入口、job 轮询和 timeline dirty 二次确认。

## 涉及文件与具体改法

### 前端实现

- `MultiMix-Frontend/app/assets/lib/asset-workspace-types.ts`
  - 删除 v2/legacy 注释与 `v2Disabled`。
  - `assetId` 仅保留为来源展示字段，不再作为提交标识。
- `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`
  - 删除 `loadSegmentMaterialOptions` 接口和实现。
  - 统一候选接口对所有非 2xx（包括 404）抛出真实错误。
  - `SegmentMaterialSelection` 收紧为必填 `candidateId`；recompose body 只写 `candidate_id`。
- `MultiMix-Frontend/app/assets/lib/use-segment-material-candidates.ts`
  - 删除 404 fallback；local 失败进入 `localError`，不继续 public 请求。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`
  - 候选缺少 `candidateId` 时显示错误，不提交 `asset_id`。
- `MultiMix-Frontend/app/editor/FilmStrip.tsx`
  - 只提交 `candidate_id`；缺失时进入可见错误态。
- `MultiMix-Frontend/editor-engine/vendor/api.ts`
  - 删除 `MaterialOption`、`replaceOptions`、`disabled` 契约。
  - 候选 404 按错误抛出；recompose selection 只接受 candidate ID。
- `MultiMix-Frontend/editor-engine/vendor/ReplacePanel.tsx`
  - 删除 disabled 分支与 `source_asset_id` 提交 fallback。

### 后端实现与文档

- `MultiMix-Backend/app/api/video_orchestration.py`
  - `SegmentRecomposeRequest` 删除 `asset_id`。
  - `replace_material` 必须提供 scoped `candidate_id`，本地素材同样先由候选接口签发。
- `MultiMix-Backend/app/tests/test_segment_recompose.py`
  - 将旧 `asset_id` 成功案例改为拒绝案例；保留 candidate scope、过期、worker 资产化与失败保护覆盖。
- `MultiMix-Backend/README.md`、`MultiMix-Frontend/docs/API.md`、`MultiMix-Frontend/docs/DEPLOYMENT.md`、`docs/authority/asset-understanding-and-segment-referencing.md`
  - 统一改为单轨接口、candidate-only、API/worker 同镜像、远程 ArtifactStore、Redis 和 readiness 要求。
- `docs/plans/active/2026-07-16-openmontage-material-search-backend-migration.md`
  - 记录前端单轨清理、上线前验证和实际偏差。

## TDD 顺序

1. 先修改/新增测试，使其要求：404 不回退、生产代码无旧 endpoint、三个入口只提交 candidate ID、后端拒绝 `asset_id`。
2. 运行定向测试确认新断言先失败。
3. 最小修改类型、adapter、hook 和三个入口，使定向测试通过。
4. 更新权威文档和部署手册，运行 docs check。
5. 运行前端 typecheck、lint、完整 Vitest、build、check:agents；后端运行候选/recompose/可靠性定向回归、ruff 和 compileall。

## 风险与取舍

- 前后端必须同窗口发布；旧前端接新后端或新前端接旧后端都不属于支持状态。
- 删除 `asset_id` 输入会让未升级的客户端失败，这是已确认单轨切换的预期代价；回滚使用完整 Git/部署版本，不在代码里保留 fallback。
- 候选 TTL 到期或 query fingerprint 改变时，用户需要刷新候选；不能绕过 candidate scope 直接提交素材 ID。
- 公共 provider 故障不影响 local，但 local endpoint 本身 404/5xx 必须明确报错，不能静默展示旧素材库结果。
- 本轮不操作 Railway/Vercel，不写生产环境变量，不执行真实 provider 消耗配额的 preflight；只完成代码和可本地验证的上线前置条件。

## 验证方式与完成标准

- 定向前端测试：adapter、统一候选 hook、AssetPicker 及相关入口。
- 静态搜索：前端生产代码中不存在 `asset-suggestions`、`replace-options`、`v2Disabled`、候选接口 disabled fallback。
- 后端定向测试：统一候选签发本地/公共 candidate；recompose 接受 scoped candidate，拒绝 `asset_id`、任意 URL、过期和跨作用域候选。
- `npm --prefix MultiMix-Frontend run typecheck`
- `npm --prefix MultiMix-Frontend run lint`
- `npm --prefix MultiMix-Frontend run test`
- `npm --prefix MultiMix-Frontend run build`
- `npm --prefix MultiMix-Frontend run check:agents`
- 后端 `ruff check app`、`python -m compileall -q app` 和相关 pytest 通过。
- 未执行的生产动作、真实 provider preflight、队列排空、蓝绿/维护窗口、真实账户冒烟必须在最终结果中明确列为外部上线步骤，不能宣称已经上线。

## 2026-07-17 执行记录

- 已删除前端 `loadSegmentMaterialOptions`、`v2Disabled`、候选 404 fallback 和 vendor `replaceOptions`；静态搜索确认三个生产入口不再引用旧 endpoint。
- 工作台、FilmStrip、ReplacePanel 与后端 recompose 均改为 candidate-only；`asset_id` 只保留在素材/工程数据中，不再作为换素材命令输入。
- TDD 证据：旧实现下前端 2 个新断言失败、后端 legacy `asset_id` 拒绝断言失败；最小修改后前端定向 18 passed、后端 recompose 23 passed。
- 前端完整验证：Vitest 290 passed、typecheck、production build、docs check、agent check 和播放器契约通过；lint 0 error、9 条既有 `<img>` 性能 warning。
- 新增 operator-only provider preflight CLI；不挂 HTTP healthcheck，不在本地验证中调用真实 provider。readiness 进一步要求“配置的、policy 允许的、存在 adapter 且具备对应 key 的自动采用 provider”，避免无关 key + 被禁 provider 组合误报 ready。
- 生产发布、真实 provider preflight、队列排空、Railway/Vercel 同窗口切换和真实账户冒烟仍需平台权限与用户另行批准，本计划不把这些外部动作标为完成。
