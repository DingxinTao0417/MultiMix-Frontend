# Presenter 旧分类措辞退役修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-10-11

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
