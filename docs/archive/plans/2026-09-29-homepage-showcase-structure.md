# 首页成片案例结构与重复示例收敛

> Status: archived
> Owner: frontend
> Last verified: 2026-09-29

## 背景与根因

用户确认首页应先展示最终成片，制作过程按需打开。当前 `app/assets/components/conversation-start.tsx:64-84,495-524` 在三张开始方式卡下重复展示“只有一个想法 / 一张图片 / 一段原视频”三张输入示例，和上方入口一一对应，增加第二次选择；`app/globals.css:1505-1560`、当前原型 `docs/specs/ui/prototypes/current/screens/start.html:194-205,408-445` 及相关检查仍保留该区。

仓库中确有内部质量验证 MP4，但 `MultiMix-Backend/docs/qa/video-golden-baseline-evidence.md` 明确标注当前候选不可公开发布或缺少公开使用授权，不能作为首页真实案例。用户本轮选择先完成页面结构，待确认真实案例素材后上架。

## 改法与范围

1. `app/assets/components/conversation-start.tsx`：移除重复输入示例及其选中逻辑；输入框保留单条咖啡店示例；入口标题改为“你想怎么开始？”，保留三个开始方式及点击只填词的行为。帮助说明只指向入口。
2. 新增 `app/assets/components/homepage-showcase.tsx` 与 `app/assets/lib/homepage-showcase-cases.ts`：建立最多三条人工精选案例的展示结构。卡片包含成片封面、入口类型、用户提供了什么、最终成果和“查看案例”；详情包含可控播放的成片、经编辑的“需求 → 方案 → 修改 → 成片”关键步骤，修改类可展示原片对比。视频不自动播放，缺少批准案例时整个区域不渲染；首发可以仅上一条或两条，不凑齐三条。
3. `docs/specs/ui/prototypes/current/screens/start.html`：移除重复示例，加入明确标为“结构示意，非真实案例”的卡片和过程详情交互，用于审核版式；不把原型占位内容写入生产页面。同步 `app/globals.css` 的生产组件样式及响应式布局。
4. `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`docs/specs/ui/agentic-workbench-design.md`：写明案例准入、展示字段、信息层级和无内容隐藏策略。更新 `app/assets/__tests__/conversation-start-primary-tasks.test.tsx`、`app/assets/__tests__/agent-ui-copy.test.ts`、`app/assets/__tests__/product-analytics-events.test.tsx`、`scripts/check-conversation-entry.mjs`；新增展示结构的聚焦测试。分析事件测试对旧入口标题有直接查询，需同步更新查询文案以验证事件行为。

## 案例准入与取舍

- 上架前逐条确认：成片由 MultiMix 产品原生链路完成，完整观看并通过当次质量检查；视频、人物、音乐、品牌和原素材均有明确首页公开展示范围；首句需求、过程摘要和最终结果均可追溯。内部 QA 或模拟样本不能冒充公开案例。
- 展示采用整理后的关键决策，不直接公开完整聊天记录；修改类“前后对比”仅在原片也获公开授权时出现。卡片不暗示任意类似需求都能稳定一次完成。
- 暂无授权案例时生产页面不显示空壳或假视频；当前原型可使用清楚标记的版式占位。真实案例接入是后续内容发布事项，需按实际素材重新检查授权与质量。
- 仅触碰首页及其检查，保留工作区现有其他未提交改动；不改视频生成、素材理解、后端或数据库链路。

## 验证与任务

1. [x] 设计落盘、核对并发占用并登记本轮前端路径。
2. [x] 移除重复示例并保持入口填词、自由输入与分析事件正常。
3. [x] 建立真实案例可接入但零案例隐藏的生产结构，完成明确占位的当前原型和设计说明。
4. [x] 运行聚焦测试、类型检查、lint、文档检查及 390 / 768 / 1440 px 原型验证；共享 Next 构建仅在不干扰并发 E2E 时执行。不得用内部质量候选充当公开成片验收。

## 完成与验证

- 聚焦测试 75/75；`test:fast` 通过（页面测试 1131/1131、演示链路 8/8、脚本检查 253 通过、1 跳过）。
- `typecheck`、`lint`、`build`、`docs:check` 和 `git diff --check` 通过。
- 当前静态原型在 390 / 768 / 1440 px 下无横向溢出，三个开始入口、三个明确标记的结构占位卡及详情弹层均已检查。该验证只覆盖原型，不代表真实案例已上架或成片链路 E2E 通过。
- 生产案例清单保持空数组；没有获得公开授权及质量复核的成片不会显示。真实案例接入仍需逐条核对素材、授权和产品产出证据。
