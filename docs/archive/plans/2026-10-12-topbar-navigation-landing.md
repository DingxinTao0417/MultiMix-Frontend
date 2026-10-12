# 顶栏导航与分镜批注式修改：合入 main 收口

> Status: archived
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

## 完成结果（2026-10-12）

- 新任务 `topbar-nav-landing` 合入旧分支后只有一处冲突：两边都在 `video-version-comparison.test.ts` 末尾追加了测试块，两块都保留。产品代码自动合并，清晰度与本任务的功能均完整保留。
- 合入前检查：typecheck、lint、`check:video-preview-contract`、`test:product-stage-style` 通过；单元测试 1773/1773；隔离 `test:display-coverage` 42 项通过，另 3 项（CASE-14 图片导出与品牌包、case-10、case-11 刷新恢复）在干净 `main` 上同样失败，与本任务无关。`check:agents` 唯一报错是后端一份已完成未归档的计划，归后端负责。
- `task -- finish` 快进合入本地 `main` 为 `2d7ec8b`；首次清理因工作目录被占用（EBUSY）未完成，重跑后清理完成。未推送。

## 事故记录：共享依赖被清空

- **现象：** 合入后清理旧工作目录时，前端主目录 `node_modules` 被清空（19:44–19:45），主目录及两个链接到它的工作目录无法运行。代码、提交和他人未提交改动未受影响，线上不受影响。
- **原因：** 由本会话手写的批量清理命令造成（先拆 `node_modules` 目录联接、再 `git worktree remove`）。联接未被可靠拆除时，删除工作目录会顺着联接删除共享依赖里的文件。命令中的「依赖完好」检查在删除之后才执行，只拦住了后续步骤。具体是哪一步未逐一复现确认。
- **修复：** 用户同意后在前端主目录 `npm ci`（锁文件与 `main` 一致，825 个包），恢复为 507 个顶层包；esbuild 与 unrs-resolver 本机二进制可用。复验 `main`：typecheck、lint、两项播放器契约通过，单元测试 1776/1776；两个链接工作目录依赖可解析。
- **改进：** 带共享依赖联接的工作目录只用 `task -- finish` 清理，它先确认联接已拆再删目录；需手工清理时逐步执行，每步核实联接已拆、共享依赖完好后才进入下一步。剩余的对比用工作目录已按此方式清理。

## 收尾

- 已删除：已并入 `main` 的旧分支（`git branch -d`）、对比用临时工作目录、3 个浏览器测试运行目录。
- 本计划归档后，本任务在工作区内不再有进行中的分支、工作目录或占用。
