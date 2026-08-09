# 异常视频工程旧展示入口修复

> Status: archived
> Owner: frontend
> Last verified: 2026-08-01

## 背景与根因

线上历史测试记录存在 `content_type=video_render`、`status=draft`、没有有效
`metadata.video_project`、没有 MP4 且没有运行中编排任务的异常组合。它不是可播放或可编辑的
视频工程，却被前端按普通视频产物映射，进入旧的海报、时间轴与分镜兜底展示。截图中出现
“视频工程”和“编导稿草稿”并存，以及 12 秒间隔的旧时间轴，正是该错误入口的可见后果。

当前 readiness 只将“存在但无效的 `video_project`”标为异常，没有将“`video_render` 完全缺失
工程事实”的孤立记录纳入同一恢复边界。

## 涉及文件与关键位置

- `MultiMix-Frontend/lib/asset-mappers.ts`：`contentAssetToProduct` 的工程有效性与状态映射。
- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：视频展示分支；新增当前样式的恢复卡，阻断旧兜底预览。
- `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`：孤立 `video_render` 映射回归。
- `MultiMix-Frontend/app/assets/__tests__/display-area-readiness.test.tsx`：恢复卡与旧展示不可达回归。
- `MultiMix-Backend/app/tests/fixtures/display_coverage/cases.json`、`seed.py`：浏览器验证用异常工程种子。
- `MultiMix-Frontend/e2e/display-area.spec.ts`：异常工程不展示旧预览的 E2E 断言。

## 具体改法

1. 将“视频工程类型、无有效工程、无 MP4、未运行、未处于明确失败任务”的孤立记录归类为
   `工程异常 · 待恢复`。
2. 对该状态渲染当前工作台的恢复提示，不展示旧海报、时间轴、分镜摘要、编辑或导出入口。
3. 增加单元和浏览器场景，覆盖“无 `video_project` 的孤立 `video_render`”与已有的“伪 ready 工程”。
4. 验证通过后，对已确认的历史异常测试记录与关联对话做归档/清理；只处理明确的测试记录，不触碰原始上传素材、有效成片或其来源资产。执行前已只读复核：目标为资产 `832` 与会话
   `asset-conversation-59adbd2ea3e9`；该会话没有引用任何其他资产。二者均采用既有的软归档语义（状态改为
   `archived`），保留消息与审计数据。

## 风险与取舍

- 工程创建中必须继续显示真实进度，因此只在不存在 `orchestration_pending`、失败任务或 MP4 时归类为异常。
- 不把异常记录伪装为编导稿：它的类型与来源事实已不一致，恢复提示比展示误导性内容更安全。
- 历史记录清理在代码验证后单独执行，并先复核资产、会话与素材依赖。

## 验证方式

1. 先运行新增前端单测，确认它因当前旧兜底而失败。
2. 最小实现后运行素材映射与展示就绪测试、前端类型检查。
3. 使用一次性 SQLite 运行完整 `test:display-coverage`，新增异常工程浏览器场景并确认所有场景通过。
4. 用线上只读复核确认异常记录不再有可见旧展示入口；清理后检查原始素材和保留成片未被归档。

## 执行结果

- 前端已将无工程事实的孤立 `video_render` 映射为 `工程异常 · 待恢复`，并在展示区使用恢复卡阻断旧海报、时间轴、分镜摘要和编辑入口。
- 回归验证通过：素材映射单测 40 项、展示组件测试 28 项、类型检查，以及临时 SQLite 的浏览器展示覆盖 10/10；临时数据库和测试进程均已清理。
- 已软归档线上测试资产 `832` 和唯一关联会话 `asset-conversation-59adbd2ea3e9`。回读确认二者均为 `archived`，正常可见查询均为空；12 条审计消息被保留，未触碰原始素材或有效成片。
