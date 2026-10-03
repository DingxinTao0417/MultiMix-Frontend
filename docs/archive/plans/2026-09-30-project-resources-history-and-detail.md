# 项目资料历史入口与精确详情修复

> Status: archived
> Owner: frontend
> Last verified: 2026-09-30

## 背景与根因

只读验收确认两项 P1：仅剩已移出历史素材时，对话标题的“资料”入口消失，抽屉在有其他产物时也没有“素材”分类；点击项目来源素材会进入“正在为项目添加素材”的素材库模式，不会打开被点击项的详情。前者因前端汇总仅计 `sources`，漏掉后端独立提供的 `historical_sources`；后者因导航只设置素材库视图和目标项目，未按 ID 读取或选中资源。

## 范围与具体改法

1. `app/assets/components/conversation-studio.tsx:1186-1222`：资料入口总量包含 `historicalSources`，仍保留无资料时不显示入口。`app/assets/components/project-resources-drawer.tsx:80-99,230-280`：素材分类/抽屉总量包含历史来源；仅历史来源时沿用现有历史范围和恢复操作，活跃与历史并存时保留范围切换。
2. `app/assets/components/assets-workspace-client.tsx:2974-2992,3632-3660`：来源素材点击后按 `assetKind` 导航到资产/图片/视频库，取消“添加到项目”模式，并传递精确资产 ID。`app/assets/lib/asset-workspace-adapter.ts:950-970,1274-1320,1874-1908`：通过现有授权的 `/assets/detail/{id}` 接口读取单项并映射现有库行。`app/assets/components/library-workshop.tsx:353-565,760-800,1244-1280`：直接打开该 ID 的现有详情弹层，即使它不在库首页、当前筛选或搜索结果中；关闭/切换时清理焦点；读取失败时显示可见错误，不误开其他资源。
3. `app/assets/__tests__/project-resources-drawer.test.tsx`、`conversation-project-resources.test.tsx`、库详情与适配器相关测试、浏览器 E2E：先加失败用例，覆盖仅历史来源、恢复入口、来源精确定位、非图片来源与不出现添加模式，再实现并复测。

## 风险与取舍

- 历史来源会计入“资料”总数，但不会伪装成可用于后续生成的活跃素材；抽屉内保留状态提示。
- 精确详情增加一次按 ID 的读取以避免分页/搜索漏项；接口按当前用户鉴权，读取失败显示错误，不退回错误的添加模式。
- 不改后端接口、素材成员关系语义、播放器视觉契约或业务数据。不处理独立剪辑器。

## 验证

- 前端定向 Vitest 先失败后通过；运行 typecheck、lint、`test:fast`、build、`docs:check`。
- 在一次性 SQLite 和独立端口的真实页面中，验证仅历史来源仍能打开并恢复、点击来源打开正确详情且没有添加项目提示；截桌面与窄屏证据。测试进程和临时库完成后清理。
- 若改动展示区 E2E，先复核播放器原型与设计契约，再运行 `check:video-preview-contract`、`test:product-stage-style`、隔离 `test:display-coverage`。

## 任务进度

- [x] 历史来源计数与抽屉入口修复，定向测试通过。
- [x] 来源素材精确详情导航修复，定向测试通过。
- [x] 全量静态检查与隔离浏览器 E2E 验证，证据留存与清理。

## 完成证据

- 定向测试先复现失败；修复后 `test:fast` 通过：Vitest 1284/1284、demo E2E 单测 8/8、脚本测试 236 通过 / 1 跳过。`test:display-components` 40/40 通过；lint、typecheck、build、`docs:check`、`check:video-preview-contract`、`test:product-stage-style` 和 `check:agents` 通过。
- 隔离真实页面全套展示区 E2E：25 通过 / 1 按原有条件跳过；最终导航改动后，定向完整流程 1/1 再通过。覆盖 390px 详情精确定位、最后一份来源移出后重载仍显示资料、重新加入和 1280px 恢复态。
- 截图：`/private/tmp/multimix-project-resources-20260930/project-source-exact-detail-390.png`、`project-source-historical-only-390.png`、`project-source-restored-1280.png`。两次独立运行的临时 SQLite 与进程均已清理。
- 未更改后端、生产配置/数据或播放器视觉合同；未运行真实生产账号和 WebKit，作为残余验证范围。
