# 任务脚本：非 Windows 依赖链接被视为改动、计划归档后无法收尾

> Status: active-plan
> Owner: frontend
> Last verified: 2026-10-13

负责端：Claude Code（前端 `scripts/`）。单端任务，无上下游依赖。

## 背景与根因

### 问题 1：Linux/macOS 上开工即出现未提交改动（前端 GitHub CI 持续红灯）

- 前端 CI 自 `9b07ad2` 起连续失败，`scripts/__tests__/workspace-task.test.mjs` 12 项失败，首个断言：`linked dependencies must stay ignored`，实际 `?? node_modules`。
- `scripts/workspace-task.mjs:169` `linkSharedDependencies()` 用 `symlinkSync(source, target, "junction")` 把主目录 `node_modules` 链进 worktree。Windows 上是目录联接，git 视为目录；Linux/macOS 上忽略 `"junction"` 参数，创建的是符号链接，git 把它当文件。
- `.gitignore` 第 4 行是 `node_modules/`，末尾斜杠只匹配目录，不匹配符号链接。已在 WSL（git 2.34.1）复现：`node_modules/` 下显示 `?? node_modules`，改为 `node_modules` 后干净。
- 影响不止 CI：在 Linux/macOS 上开发时，每个前端 worktree 都会显示这条改动，`task -- finish` 会因“有未提交改动”拒绝收尾。

### 问题 2：任务内归档计划后 `finish` 拒绝收尾

- `finishTask()`（`scripts/workspace-task.mjs:371`）调用 `checkWorkGuard()`，后者 `normalizePlan()` 要求登记的计划仍在 `docs/plans/active/`。
- 任务分支上把计划移到 `docs/archive/plans/` 后，合入前后都会报 `Active plan does not exist`。2026-10-12、2026-10-13 各发生一次：一次被迫拆出单独的归档任务，一次合入成功但清理阶段失败，只能 `task -- release` 手工收尾。

## 涉及文件与改法

- `.gitignore`：`node_modules/` 改为 `node_modules`，同时匹配目录与符号链接。
- `scripts/workspace-task.mjs` `linkSharedDependencies()`：创建链接后用 `git check-ignore` 确认链接被忽略；未被忽略时删除链接与新建的 worktree、释放登记并报错，提示调整目标仓库的忽略规则，不再留下一个“脏”的 worktree。
- `scripts/workspace-work-guard.mjs`：`checkWorkGuard()` 增加 `allowArchived` 选项；为真时，登记计划在 `docs/plans/active/` 找不到，但同名文件已在对应仓库的 `docs/archive/plans/` 中存在（任务 worktree 或主目录），视为有效。`begin` 与普通 `check` 行为不变，开工仍要求计划在 active 下。
- `scripts/workspace-task.mjs` `finishTask()`：以 `allowArchived: true` 调用。
- `scripts/__tests__/workspace-task.test.mjs`：
  - 测试夹具的 `.gitignore` 改为 `node_modules`，与真实仓库一致；
  - 新增：忽略规则只匹配目录时，`start` 失败且不留 worktree、分支和登记（用 `node_modules/` 夹具 + 平台判断，Windows 上联接本就被忽略时跳过该断言）；
  - 新增：任务分支归档计划后 `finish` 正常合入并清理；合入后清理中断、计划只在主目录归档时，重跑 `finish` 也能完成。
- `scripts/__tests__/workspace-work-guard.test.mjs`：新增 `checkWorkGuard` 在 `allowArchived` 为假时仍拒绝已归档计划。

## 风险与取舍

- 放宽只针对 `finish`，且要求归档文件同名存在，不接受计划被删除或改名。
- 不改用复制依赖或 `npm ci`：worktree 共享依赖是既定设计，复制会让每个任务多装几百 MB。
- `.gitignore` 改动对主目录无行为差异（主目录 `node_modules` 是真实目录，两种写法都匹配）。

## 执行记录（2026-10-13）

- 开工前 Codex 任务 `material-first-release-b1-20261013` 占用 `workspace-governance`，登记冲突；对方移除该区域后登记成功。
- Linux 复现：WSL Ubuntu 22.04 + Node v22.22.0（官方包，SHA256 校验），`workspace-task` + `workspace-work-guard` 测试修复前 12 项失败，与 CI 失败清单一致。
- 新增 4 项测试修复前失败（链接未忽略时拒绝开工、仓库忽略规则契约、归档后续跑收尾、`allowArchived` 开关）；“任务内归档后首次收尾”修复前已能通过（主目录仍有 active 计划），保留为回归。
- 修复后 Windows 与 Linux 均 40/40；变异检查：去掉 `allowArchived`、去掉 `check-ignore` 拦截、恢复 `node_modules/` 写法，各自都有测试失败。
- `lint`、`typecheck`、`test:scripts` 301/0、`check:agents` 通过。
- 偏离说明：未在 Linux 跑全量 `test:scripts`（需要装依赖）；Linux 快照里 `multimix-logo-assets`、`source-discovery-boundary` 因缺依赖无法加载，CI 上这两个文件不在失败清单里。
- 计划改动：未采用“`linkSharedDependencies` 失败后删除新建 worktree”的单独逻辑，由 `startTask` 现有回滚完成；链接在抛错前先删除，确保回滚不会进入共享依赖目录。

## 验证方式

- L1：`npm run test:scripts`，新增用例修复前失败、修复后通过。
- Linux 实测：在 WSL 中跑 `node --test scripts/__tests__/workspace-task.test.mjs`，确认原先 12 项失败全部通过。
- `check:agents`、`lint`。
- 推送后（需用户确认）看前端 GitHub CI 是否转绿。
