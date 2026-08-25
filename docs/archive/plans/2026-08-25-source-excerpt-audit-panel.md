# 原片摘编受控验收摘要入口

> Status: archived
> Owner: frontend
> Last verified: 2026-08-25

## 背景与根因

后端已提供受当前用户鉴权保护的 `GET /v1/video/projects/{asset_id}/source-excerpt-audit`，用于返回原片摘编的删减区间汇总与三轨一致性合同。它不返回正文，但现有工作台没有调用入口；外部直接请求没有用户 Bearer 令牌会正确返回 `401`。验收人员不应读取、导出或重放浏览器凭据。

## 涉及文件与改法

1. `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`
   - 增加窄化的 `SourceExcerptAudit` 前端类型和 `getSourceExcerptAudit(token, projectAssetId)` adapter 方法。
   - 方法只调用既有后端 endpoint，沿用现有内存 token 的 Authorization 注入；不写入、缓存或日志记录 token/响应正文。

2. `MultiMix-Frontend/app/assets/components/product-workspace.tsx`
   - 仅在已完成的 `source_excerpt` 视频工程显示“核验原片精简”显式按钮；不得自动请求，也不对普通视频、未完成工程或无 token 显示伪造结果。
   - 用户点击后只展示：来源资产数、来源窗口/保留/删减的计数与时长、是否存在安全删减、来源指纹一致性、原声/画面/字幕时间线一致性，以及稳定失败码。严禁渲染转写、口播、字幕、素材标题、URL 或指纹值。
   - 错误仅显示通用 HTTP/读取失败状态；不把错误响应正文放入页面。

3. `MultiMix-Frontend/app/assets/__tests__/source-excerpt-audit-panel.test.tsx` 与 adapter 测试
   - 覆盖仅合格工程可见、点击后请求携带 token、页面只渲染摘要字段、失败只显示稳定代码/通用错误、非原片工程不可见。

## 风险与取舍

- 入口是一次显式只读检查，不作为视频项目状态或渲染质量门，也不轮询。
- 后端继续判定所有权和完成状态；前端条件只控制可见性，不能放宽权限。
- 不改视频预览播放器、字幕、比例或工程数据；因此不触碰既有视频预览视觉契约。

## 验证方式

1. 先写失败测试，再实现最小 adapter 和面板。
2. 运行定向 Vitest、前端 typecheck、`docs:check` 与差异检查；不启动本地服务、不创建 SQLite、不调用 Provider。
3. 部署需要用户单独授权。部署后在已登录生产工作台的工程 `1276` 点击一次入口，只记录 HTTP、完成状态、计数/时长、三轨布尔结果和失败码；不输出正文或敏感内容。

## 实施证据（2026-08-25）

- 已在 `asset-workspace-adapter.ts` 增加窄化的 `SourceExcerptAudit` 映射和只读 `getSourceExcerptAudit`；它只沿用现有 token 参数发起请求，不持久化 token 或响应。
- 工作台只在已完成的 `source_excerpt` 工程显示“核验原片精简”按钮；点击前不发请求。结果面板仅显示区间计数/时长、三项布尔合同和稳定失败码；任何读取错误只显示通用失败提示。
- 新增面板回归和 adapter 请求/映射回归。验证：`npm run test -- app/assets/__tests__/source-excerpt-audit-panel.test.tsx app/assets/__tests__/asset-workspace-adapter.test.ts` 为 `46 passed`；`npm run typecheck`、`npm run docs:check` 和 `git diff --check` 通过。
- 未启动本地服务、未创建 SQLite、未调用 Provider。
- 提交 `a18413e` 已推送；Vercel 指定 team `lywgood96-1172s-projects`、project `multimix-frontend` 的 production 部署为 `READY`，且部署提交精确匹配。
- 已在生产页尝试一次受控点击，但新开页渲染为空白（可见按钮数 `0`、页面文本长度 `0`），无法呈现或点击入口；公开 URL 返回 HTTP `200` 仅说明页面可达，不能替代已登录工作台验证。未读取或重放会话凭据，也未直接调用鉴权 API。
- 生产点击核验尚未完成。待用户恢复其生产工作台会话后，对工程 `1276` 点击一次入口并只记录约定的 body-free 摘要；在此之前不得写为功能或端到端验收通过。

## 生产点击验收通过（2026-08-25）

- 用户恢复生产会话后，工程 `1276` 的入口可见并成功点击一次。面板仅展示允许的摘要：来源窗口 `26.48s`，保留 `5` 段 / `17.61s`，删减 `4` 段 / `8.87s`，安全删减、来源指纹、原声/画面/字幕时间线三项均为真，失败码为空。
- 该次请求只走页面既有内存 token 注入；没有导出、持久化或重放 token，未展示任何正文。故入口在生产中完成受控读取并正确呈现 body-free 结果。
