# LLY-36 修复 Node 25+ 下 Vitest 被全局 Web Storage 污染

> Status: archived
> Owner: frontend
> Last verified: 2026-08-18

## 背景与根因

- Node 25+ 在进程全局提供实验性 `localStorage` / `sessionStorage`。未传入 `--localstorage-file` 时，读取 Node 自带的 `localStorage` 会警告并返回不可用值。
- 当前 `vitest.config.ts`（`test` 配置约第 20 行）让测试默认运行于 Node；需要 DOM 的测试以文件注释切换到 jsdom。Vitest 4 的 jsdom 全局注入会保留已存在、但不在其覆盖名单内的 Node Web Storage 属性，故这些测试获得的是 Node 的 `localStorage`，而不是所属 jsdom 窗口的存储。
- BGM 面板通过 Sheet 进入 `useOverlayOpenChange`，使 Zustand persist 的 `keybindings-store` 在 `openOverlay` 时调用该错误存储；2026-08-18 在 Node v26.5.0 下默认入口实测 `bgm-panel.test.tsx` 7/7 失败，错误为 `Cannot read properties of undefined (reading 'setItem')`。这不是 BGM 产品逻辑或浏览器内持久化行为的问题。

## 计划存放位置说明

- 本前端任务计划放在 `MultiMix-Frontend/docs/plans/active/`：前端 `docs/README.md` 规定前端专属整改存于此处，且 `work:guard` 仅接受此前端路径或后端对应路径。
- 工作区根 `docs/` 仍是根 AGENTS.md 的文档地图，但当前 `npm run docs:check` 将其报告为 retired。该既有文档治理冲突不在 LLY-36 范围内；不迁移、删除或修改根文档树来掩盖检查失败。

## 涉及文件与关键位置

- `vitest.config.ts`：为所有 jsdom 测试注册一个测试前置脚本；不改变默认 Node 测试环境。
- `test-support/vitest-jsdom-web-storage.ts`（新增）：仅当 Vitest 已创建 jsdom 窗口时，以该窗口的独立 `localStorage` 和 `sessionStorage` 覆盖 Node 同名全局，并在该测试文件完成后恢复原有描述符。
- `test-support/__tests__/vitest-jsdom-web-storage.test.ts`（新增）：运行时契约，验证默认 `npm test` 入口下 jsdom 测试可读写隔离的浏览器语义存储，而非 Node 的失效 Web Storage。
- `app/editor/__tests__/bgm-panel.test.tsx`：作为真实回归验证对象，不修改 BGM 产品测试或产品逻辑。

## 具体改法

1. 在 Vitest 的 `setupFiles` 注册最小测试运行时适配层。
2. 适配层检测 `globalThis.jsdom?.window`。仅在 jsdom 环境存在时保存当前 `localStorage` / `sessionStorage` 的属性描述符，随后定义访问器，直接返回此测试环境所属 jsdom window 的 storage。
3. 使用 Vitest `afterAll` 在该测试文件结束时恢复原描述符，避免影响同一 worker 后续的 Node 环境；不设置 `NODE_OPTIONS`，不使用共享 `--localstorage-file`。
4. 新增 jsdom 契约测试，断言两个 storage 都能写入、读回，且全局 storage 与 jsdom window 的 storage 是同一对象。修复前该测试在 Node 25/26 会因 Node storage 不可用而失败。

## 风险与取舍

- 只覆盖 Vitest 已创建 jsdom 的测试文件；默认 Node 测试环境保持 Node 语义和现有性能，不全局切换为 jsdom。
- 同时修复 `sessionStorage`，因为它与 `localStorage` 同样是 Node 25+ 新增、且同样会被 Vitest 的保留规则漏掉的浏览器 Web Storage 表面。
- 不改 Zustand persist、keybindings store、Sheet 或 BGM 面板，浏览器生产环境仍由浏览器原生存储提供持久化。
- `next-env.d.ts` 是用户既有改动，必须逐字节保留；不提交、合并、推送、部署或变更 Linear 状态。

## TDD 与验证矩阵

1. 修复前：`npm --prefix MultiMix-Frontend run test -- app/editor/__tests__/bgm-panel.test.tsx` 复现 7/7 失败（已在 Node v26.5.0 实测）。
2. 先新增 jsdom Web Storage 契约测试；在未注册适配层的当前代码下应失败。
3. 添加最小测试环境适配后，运行：
   - `npm --prefix MultiMix-Frontend run test -- app/editor/__tests__/bgm-panel.test.tsx`（7/7）
   - `npm --prefix MultiMix-Frontend run test -- test-support/__tests__/vitest-jsdom-web-storage.test.ts`
   - `npm --prefix MultiMix-Frontend run test`
   - `npm --prefix MultiMix-Frontend run typecheck`
   - `npm --prefix MultiMix-Frontend run lint`
   - `npm --prefix MultiMix-Frontend run check:agents`（预期可能继续暴露既有根 `docs/` retired 冲突，单独报告）
   - `git -C MultiMix-Frontend diff --check`
4. 在每个阶段边界运行 `work:guard check --token <token>`；验证和只读审查完成后释放登记。

## 范围声明

- 不连接数据库、生产环境或任何外部服务；不启动 E2E、前端或后端进程。
- 不修改 BGM 功能、浏览器内 Zustand 持久化、测试命令的 PowerShell 特殊环境变量或 Node 的 `--localstorage-file`。
- 2026-08-18 经用户授权完成交付：计划移入 archive，提交并推送本次前端改动，随后将 Linear LLY-36 更新为 Done。

## 执行记录（2026-08-18，Node v26.5.0）

- 红灯已复现：BGM 回归为 7/7 失败；新增 jsdom Web Storage 契约也在 `globalThis.localStorage` 为 `undefined` 时失败。
- 修复后通过：契约测试 1/1、BGM 回归 7/7、全量 Vitest 84 files / 626 tests、`typecheck`、`lint` 与 `git diff --check`。
- `check:agents` / `docs:check` 仍仅报告既有的工作区根 `docs/` retired（`doc-root`、`stale-location`）两项；本任务未扩大范围处理该文档治理冲突。
