# Presenter 旧分类措辞退役修复

> Status: archived
> Owner: frontend
> Last verified: 2026-10-16（修复提交已进入远端及 CI 成功证据核对；文档归档）

## 背景与根因

远端 `main` CI 自 `0b18081` 起变红，`app/assets/__tests__/source-video-language-contract.test.ts` 2 项失败。

根因是我在推送前解决合并冲突时的判断失误：`docs/API.md` 与 `docs/specs/ui/video-artifact-browse-and-edit-states.md` 出现冲突，我按「取远端版本」处理，但未发现该测试把这两份文档当作契约锁定。远端版本仍用已退役的旧视频分类名指代，与测试断言相反。

- 我这一侧 `c1d2c46`：spec 无 `Presenter`、含 `不按旧视频分类分流` → 通过
- 远端 `add90aa`：spec 有 `Presenter` 2 处、缺 `不按旧视频分类分流` → 违反
- 合并后 `76cb048` 继承远端版本 → CI 红

用户已确认 `Presenter` 旧分类完全退役，因此修复方向是把措辞收敛到接口契约口径，而不是放宽测试。

## 涉及文件与关键行

- `docs/specs/ui/video-artifact-browse-and-edit-states.md`：`Presenter` 2 处（约 33 行、173 行验收项）；缺 `不按旧视频分类分流`
- `docs/API.md`：`Presenter` 1 处、`通用讲解型编导稿` 1 处
- 契约测试：`app/assets/__tests__/source-video-language-contract.test.ts`

## 具体改法

1. 用 `recommendation_mode=single_winner` 等公开接口字段替代旧分类名指代同一行为，产品行为描述不变。
2. spec 补回 `不按旧视频分类分流`，明确不再按视频类型分流。
3. 仅改含旧分类词的行，保留远端在 spec 的其余 41 行实质更新与其核验日期。
4. 不改测试断言，不动其他会话未提交的 `docs/API.md` 中 `../AGENTS.md` 引用改动。

## 风险与取舍

- 风险是措辞替换改变原意。取舍：只替换指代方式，不改条目所述的交互与边界。
- 工作区存在其他会话大量未提交改动，本次只碰上述两份文档。

## 验证方式

- L1：`npx vitest run app/assets/__tests__/source-video-language-contract.test.ts`
- L2：`npm run check:agents`（docs:check 与视频预览契约）

## 收口与归档（2026-10-16）

修复提交 `45344f8` 已包含于 `origin/main`，不再等待推送。已核对前端 `8482531` 的 [GitHub CI checks 成功记录](https://github.com/DingxinTao0417/MultiMix-Frontend/actions/runs/38875663348/job/116889991614)。原推送/CI 阻塞已经解除，本计划移入 `docs/archive/plans/`，不再作为 active 待办。下方保留当时停点用于追溯；本轮文档清理另行记录直接契约复测，不代表重新发布产品。

## 历史停点（2026-10-12）

本地修复完成并提交 `45344f8`：spec 3 处、`docs/API.md` 2 处旧分类措辞替换为公开接口字段，两文件中 `Presenter` 与 `通用讲解型编导稿` 均为 0 处；远端在 spec 的其余更新与核验日期保留。

已验证：契约测试 3 项通过、`check:agents` 通过、暂存树隔离检出验证通过（不依赖其他会话未提交改动）。`docs/API.md` 中其他会话未提交的 `../AGENTS.md` 引用改动未纳入提交。

**当时未完成**：`git push origin main` 被权限门禁按「生产发布」拒绝，未推送，因此当时远端 `main` 的 CI 仍为红。该阻塞已按上方 2026-10-16 收口记录解除。

当时待办归属：推送需用户授权执行；工作区另有未提交的 `scripts/sync-agents-md.mjs` 删除，属其他会话。此处保留当时风险，不描述当前工作区状态。
