# 已关闭 BGM 不请求曲库并阻塞导出修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-04

## 背景与根因

隔离运行 `e2e-video-project-ratio-contract-20260804-12` 的工程已明确保存
`video_project.metadata.bgm_choice.enabled=false`，但编辑器仍在挂载时请求
`GET /v1/video/bgm/catalog`。该运行的测试曲库不可用而返回 503；前端把无关请求错误留在
导出页，使下载流程无法完成。

根因是 `BgmPanel` 只知道 asset ID，挂载时无条件加载曲库，没有消费已加载工程中保存的
`bgm_choice`。这违反 BGM 规格：无配乐工程仍有确定的选择状态，曲库不可用必须不阻塞成片。

## 涉及文件与具体改法

1. `MultiMix-Frontend/app/editor/EditorView.tsx`
   - 将已加载视频工程中经保存的 `metadata.bgm_choice` 传给 BGM 面板，作为初始权威状态。
2. `MultiMix-Frontend/app/editor/BgmPanel.tsx`
   - 初始状态明确为 `enabled=false` 时不请求曲库，显示“已关闭”状态。
   - 用户主动点击“恢复自动配乐”时才加载曲库并执行恢复；曲库失败只展示该操作错误，不能阻塞视频导出。
   - 保留有 BGM、未知状态、换曲、试听与手动关闭的既有行为。
3. `MultiMix-Frontend/app/editor/__tests__/bgm-panel.test.tsx`
   - 先复现：明确无配乐时面板不得发出曲库 GET。
   - 覆盖：主动恢复时才发出曲库请求，并继续走现有更新动作。
4. `MultiMix-Frontend/vitest.config.ts`
   - 补齐 Vitest 对既有 `@/` 路径别名的解析，使上述前端回归测试能加载已有共享 API 模块；
     不改变生产构建或产品行为。
5. 真实 E2E
   - 使用独立 SQLite 和端口重新跑无 BGM 视频工程到 MP4 下载；断言没有 BGM 曲库 503 阻塞。

## 风险与取舍

- 不把 503 静默视为成功，也不修改后端曲库接口；曲库仍是用户主动换曲/恢复时必须可用的能力。
- 不改变每个工程的 BGM 选择权威数据、BGM 默认开启策略或已启用工程的面板行为。
- 只把“无配乐”从曲库依赖中解耦，保证用户能继续导出已有工程。

## 验证方式

- 先运行新增前端回归测试使其失败，再实现并运行 BGM 面板相关单测、类型/lint 与文档检查。
- 新隔离 E2E 覆盖无 BGM 工程创建、编辑器加载、导出下载；保留运行数据库和素材，直到用户确认清理。

## 执行状态

- [x] 取证并定位无配乐仍请求曲库的根因
- [x] TDD 回归用例
- [x] 编辑器延迟曲库加载实现
- [x] 自动化验证：BGM 面板 6 项、类型检查、ESLint 与文档检查通过
- [x] 真实隔离 E2E：run `e2e-disabled-bgm-catalog-export-20260804-13` 已完成无 BGM
  工程、编辑器导出与 MP4 下载（`video_export` 31.9 秒通过），后端日志没有
  `/v1/video/bgm/catalog` 503。套件最终仅因预存的 draft 会话 404 被控制台零错误
  检查判失败；该错误发生在 BGM 修复前的会话刷新，运行证据已保留。
