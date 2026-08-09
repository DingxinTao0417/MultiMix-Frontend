# 公共素材候选与最终采用展示修复

> Status: archived
> Owner: frontend
> Last verified: 2026-08-01

## 背景与根因

展示覆盖 CASE-03 的种子数据只记录了 `asset_reference.status=no_asset_hit`，表示没有命中用户已保存素材；它没有记录公共候选或最终主画面来源。前端映射因此不会生成公共素材来源摘要，但 E2E 却断言“基于 3 个公共素材生成”。该断言与权威素材状态不一致。

同时，`MultiMix-Frontend/lib/asset-mappers.ts` 将 `material_resolution.fill_status=public_candidate` 与最终 `primary_visual.source_type=public_asset` 共用“公共素材生成”文案，混淆了编导稿候选与工程内已验证、已持久化的最终素材。

## 涉及文件与关键位置

- `MultiMix-Frontend/lib/asset-mappers.ts`：分镜状态映射与 `sourceSummaryForAsset`。
- `MultiMix-Frontend/app/assets/lib/asset-workspace-types.ts`：分镜展示模型。
- `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`：候选与最终公共素材摘要回归。
- `MultiMix-Frontend/e2e/display-area.spec.ts`：CASE-03 浏览器断言。
- `MultiMix-Backend/app/tests/fixtures/display_coverage/seed.py`：CASE-03 权威 `material_resolution` 种子。

## 具体改法

1. 在前端分镜展示模型中保留来自 `material_resolution.fill_status` 的确定性状态。
2. 来源摘要按权威字段区分：
   - `public_candidate` 只显示“公共素材候选”；
   - `primary_visual.source_type=public_asset` 才显示“基于 … 公共素材生成”。
3. 将 CASE-03 的三段分镜都种成 `public_candidate`，同时保持 `asset_reference.status=no_asset_hit`，以证明它们不是用户保存素材。
4. 更新单元与 E2E 断言，覆盖候选展示、不把未填充状态误报为公共素材、以及最终公共素材仍可按采用状态展示。

## 风险与取舍

- 旧数据缺少 `material_resolution` 时不推断公共素材，宁可少展示，也不把“未命中”误说成“公共素材已采用”。
- 本次不改变素材选择、公共搜索或视频工程生成，只修正展示模型和测试种子。

## 验证方式

1. 运行前端素材映射单测，验证候选、最终采用、未填充三种状态。
2. 运行 `npm --prefix MultiMix-Frontend run typecheck`。
3. 用隔离临时 SQLite 运行 `npm --prefix MultiMix-Frontend run test:display-coverage`，确认 9 个浏览器场景通过并由脚本清理临时数据库、产物和进程。
