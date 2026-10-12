# N1 + B 实施交接

> Status: current
> Owner: frontend
> Last verified: 2026-10-12

任务清单、改法与验证以 [实施计划](2026-10-11-topbar-navigation-and-segment-annotation.md) 为准，本文只记录任务环境与历史问题。

## 1. 任务环境

| 项 | 值 |
| --- | --- |
| 任务 | `topbar-nav-segment-annotation`，owner `claude-uiux-n1`，由 `task -- start` 于 2026-10-12 建立 |
| 分支 | `claude/topbar-nav-segment-annotation`，基于前端 `main` `8870b48` |
| worktree | `MultiMix-Frontend/.worktrees/topbar-nav-segment-annotation` |
| 功能区 | `workspace-shell`、`video-editor` |
| 合并 | 全部完成后 `task -- finish --token <token>` 快进合入本地 `main`，不推送 |

令牌只保存在主仓库被忽略的 `.tmp/claude-n1-handoff/task-start.json`，不得提交或输出。

## 2. 历史问题

- **旧手工 worktree。** 2026-10-11 曾手工建立 `.worktrees/topbar-nav` 与分支 `claude/topbar-nav-segment-annotation-20261011`。
  提交流程改造上线后，`task -- start` 只能新建 worktree，故重新开工并把未提交的 T1、T3 改动迁入本 worktree；
  旧 worktree 无任何提交，迁移后删除。
- **stash 误操作。** 排查测试失败时曾用共享 stash 栈二分定位，把视频清晰度任务未提交的 `product-preview.tsx`
  改动误收入栈；已原样归还主工作区，其他 stash 未触碰。今后二分定位改用 `git diff > patch` 与 `git checkout -- <file>`。
- **守卫嵌套 worktree 缺陷（未转交成功）。** 改造后的 `work:guard` 在 `<repo>/.worktrees/<task>` 里找不到只存在于
  该 worktree 的计划文件（`localCheckoutRoot()` 解析到主工作区根）。`task -- start` 不受影响，因为它要求计划先在主目录；
  `task -- finish` 已按任务 worktree 查找计划。曾向改造负责会话发送报告，因两端权限模式不同未送达，待用户转达。

## 3. 仍待用户确认

- 品牌 mark 渐变圆底是否改单色（V3 规范决策 12）。
