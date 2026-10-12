# 顶栏导航与分镜批注式修改：合入 main 收口

> Status: active-plan
> Owner: frontend
> Last verified: 2026-10-12

## 背景与根因

设计、实施与验证已在 [归档计划](../../archive/plans/2026-10-11-topbar-navigation-and-segment-annotation.md) 完成，代码在分支
`claude/topbar-nav-segment-annotation`（最新提交 `99ac822`）。合入时主目录有视频清晰度任务未提交的改动与本分支同文件，
`task -- finish` 无法快进，占用随后按用户要求释放。2026-10-12 清晰度改动已由其负责方合入 `main`（`73ebff2`、`2da0133`），
阻塞解除。`task -- finish` 只认登记中的任务，而 `task -- start` 只能新建分支，因此需要重新开工并迁入已有提交。

## 涉及文件与关键行

不新增产品改动。迁入的提交覆盖归档计划第 4 节所列文件；与 `main` 新提交的重叠预计在
`app/assets/components/product-preview.tsx`、`app/assets/lib/video-version-comparison.ts` 及其测试、
`app/assets/components/conversation-studio.tsx`。

## 具体改法

1. 用 `task -- start` 登记占用并建立新 worktree 与分支，功能区 `workspace-shell`、`video-editor`。
2. 在新 worktree 中合入旧分支 `claude/topbar-nav-segment-annotation`，再合入最新 `main`；冲突按 hunk 保留双方改动，
   不覆盖清晰度任务的实现。
3. 跑完验证后 `task -- finish` 快进合入本地 `main`，不推送。
4. 旧分支确认已完全并入后用 `git branch -d` 删除，旧 worktree 移除；清理验收期间的临时目录。
5. 收口后本计划移入 `docs/archive/plans/`。

## 风险与取舍

- 清晰度任务改了与本分支相同的成片预览和版本对比代码，合并冲突需逐段核对，两边功能都必须保留。
- 释放占用期间他人可能改到本分支文件，合并前核对 `main` 新提交。

## 验证方式

`typecheck`、`lint`、`test`、`check:video-preview-contract`、`test:product-stage-style`、`check:agents`；
冲突涉及成片预览时，追加隔离的 `test:display-coverage` 中与播放器和版本对比相关的用例。
