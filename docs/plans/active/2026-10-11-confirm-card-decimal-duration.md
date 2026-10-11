# 确认卡小数时长接收修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-10-11

上游计划：`MultiMix-Backend/docs/plans/active/2026-10-11-original-source-intent-release.md`「最终核卡阻塞与前端接续」。本文件只沉淀前端侧改动。

## 背景与根因

生产后端（发布 7fa9ef74）对专用项目 asset-conversation-742d41c639b8 返回的 pending 中 `target_seconds=30.63`、`keep=0–30.63` 均正确，但产品界面确认卡的「目标时长」显示 30 秒。

最早可修复根因在前端消费合同：

- `lib/asset-mappers.ts:56` 的 `positiveIntegerValue` 要求 `Number.isInteger`；`:441` 用它接收 `duration_seconds`，合法值 30.63 被判定非法并丢弃为 `undefined`。
- `app/assets/components/confirm-card.tsx:178` 在 `durationSeconds` 缺失时回退默认 30，于是界面显示 30 秒。
- 该 `<input type="number">` 未声明 `step`，浏览器默认 `step=1`，小数值会被标记为非法输入。

后端数值正确，不得改后端时长或把 30 当可接受误差。

## 涉及文件与关键行

- `lib/asset-mappers.ts:56`（新增有限正数 helper）、`:441`-`:443`（duration 字段消费）
- `app/assets/components/confirm-card.tsx:800`-`:808`（时长输入 step）
- `app/assets/__tests__/asset-mappers.test.ts`、`app/assets/__tests__/confirm-card-render.test.tsx`（TDD）

## 具体改法

1. 新增 `finitePositiveNumberValue`：接受有限正数（含小数），拒绝 0、负数、`NaN`/`Infinity`、非数字与布尔。
2. `duration_seconds` / `duration_min` / `duration_max` 改用该 helper；`director_asset_id`、`pending_intent_version`、`count`、`reference_asset_id` 等 ID/版本/计数字段保持 `positiveIntegerValue` 整数约束。
3. 时长输入加 `step="any"`，小数不被浏览器校验拒绝或静默步进取整。
4. 不改提交链路数值：`confirm-card` 提交仅做 `durationMin`/`durationMax` 夹断，`conversation-studio`、`asset-workspace-adapter` 原样透传 `target_seconds`，不取整。

## 风险与取舍

- `presenter_project_confirmation` 的提交走后端 `PresenterDirectionConfirmationCreate.target_seconds: int`，仍只接受整数，因此 `confirm-card.tsx:241` 的 `Number.isInteger` 门继续保留，只对该路径生效。本次核卡目标 `video_parameter_confirmation` 走 `VideoParameterConfirmationCreate.target_seconds: int | float`，可接受小数。
- 该文件存在其他会话未提交的画质增强改动，本次只增改上述行，不触碰、不回滚。

## 验证方式

- L1 聚焦：mapper 对 30.63/整数/零/负数/非有限/字符串的取舍，确认卡以 30.63 渲染并提交同值，整数字段不受影响。
- L2 相关回归：确认卡渲染、参数确认、mapper、adapter 相关测试套件。
- 产品原生核卡：复用 ready v6 与专用项目 asset-conversation-742d41c639b8，核对 0–30.63 秒、保留原声、字幕开启、配音与音乐关闭；不点击制作。
