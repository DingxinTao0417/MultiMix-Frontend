# 项目资料抽屉状态修复

> Status: archived
> Owner: frontend
> Last verified: 2026-09-30

## 背景与根因

- `app/assets/components/project-resources-drawer.tsx:73-100` 在抽屉关闭、切换项目及资料数量变化后继续保存 `kind/sourceScope/offset`；仅对“没有当前素材”做范围回退，没有对“没有历史素材”做对称回退。
- `app/assets/components/assets-workspace-client.tsx:3661-3685` 长期挂载同一抽屉实例，项目切换会继承上一项目的交互状态。
- `project-resources-drawer.tsx:110-131,328-333` 按旧页码请求后，即便服务端 `total` 已收缩，也没有回到有效页；页数降为一页时，“上一页”还会消失。

## 具体改法

1. 在 `app/assets/__tests__/project-resources-drawer.test.tsx` 加回归：关闭重开/项目切换、历史选中后最后一条历史资料恢复、末页数量缩小后的回页与资料展示。
2. 在 `app/assets/components/assets-workspace-client.tsx` 只于打开时挂载抽屉，并用项目 ID 作为组件 key；同项目每次打开默认从当前可用资料的首屏开始，跨项目不继承状态。
3. 在 `app/assets/components/project-resources-drawer.tsx` 双向校正当前/历史范围；汇总变化触发列表刷新，但以列表返回的 `total` 判断页码是否有效，避免汇总短暂落后时截断真实页；无效页自动回退且不误报空态。
4. 更新 `docs/MULTIMIX_WORKSPACE_DESIGN.md` 中抽屉默认状态/状态变化契约；完成前端静态、单测和隔离浏览器回归。

## 风险与取舍

- 每次关闭重开从首屏开始，会放弃记住上次分类/页码；这是资料抽屉的可预测默认态，避免跨项目误显示。
- 服务端汇总与列表可能短暂不一致；汇总只触发刷新、决定可用范围，分页总数以列表 `total` 为准，不改后端数据或引用规则。
- 不处理另一项“永久删除源文件”入口问题，不改变后端删除保护。

## 验证方式

- 先让新增回归在旧实现上失败，再实施最小修复并重跑。
- 运行相关 Vitest、`typecheck`、`lint`、`check:agents`；因浏览器回归涉及展示区 E2E，先读取当前播放器原型/设计，再运行 `check:video-preview-contract`、`test:product-stage-style` 和隔离 `test:display-coverage`。
- E2E 使用独立端口与一次性 SQLite；执行前告知精确路径，结束后确认进程和数据库清理。

## 任务

- [x] T1 补充失败回归，覆盖范围/关闭重开/页码三类状态转换；旧实现下 3 例均失败。
- [x] T2 修复抽屉生命周期、范围和页码，并同步 UI 契约；补充汇总落后于列表的失败回归后，相关 21 个单测、类型检查、lint 与文档检查通过。
- [x] T3 完成静态、单测及真实浏览器验证与清理。

## 完成证据

- 旧实现下三条根因回归失败；修复后新增汇总落后于列表的失败回归也通过。最终相关 21/21 单测、类型检查、lint、`check:agents`（含文档与播放器外壳契约）、`test:product-stage-style` 均通过。
- 修复中间版的完整 `test:fast`：Vitest 1288/1288、demo 单测 8/8、脚本测试 236 通过 / 1 跳过；完整展示区 E2E 25 通过 / 1 条专用恢复用例按配置跳过。最终分页边界调整后，相关项目资料浏览器 E2E 4/4 再通过，展示组件 40/40 通过。
- 真实浏览器截图：`/tmp/multimix-drawer-state-evidence-final-20260930/project-source-historical-only-390.png` 与 `project-source-restored-1280.png`。最终临时 SQLite 和 8299/3219 测试进程均已清理；没有修改后端、生产配置或业务数据。
- 未覆盖生产账号实测及 WebKit；另一个“永久删除源文件”死入口不在本轮范围。
