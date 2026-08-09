# 分镜预览直接导出成片计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-05

## 背景与根因

当前视频工程浏览态已经加载分镜预览 iframe，但顶部“导出视频”会额外挂载一个隐藏编辑器
iframe，并等待它通过 `postMessage` 回传 ready 后才开始渲染。真实验收
`mg-primary-fallback-20260805-r8` 中，浏览态预览已经可播放、隐藏编辑器也已加载，但导出桥接
未进入导出状态，按钮最终回到“导出视频”。这使一个用户并未要求编辑的动作依赖编辑器状态，
与“浏览态直接看、直接下载；编辑器仅在主动编辑时打开”的产品决策不一致。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/assets/components/video-project-preview.tsx`：复用现有预览 iframe，暴露
  导出命令、就绪状态和导出事件。
- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：把预览的直接导出能力向工作台透出。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`：顶部下载动作调用分镜预览，保留
  质量检查、验证、保存和下载状态；“编辑”才挂载完整编辑器。
- `MultiMix-Frontend/app/assets/__tests__/product-workspace-video-actions.test.tsx`、
  `app/assets/__tests__/display-area-cases.test.tsx`、`app/assets/__tests__/video-browse-contract.test.ts`：
  覆盖无编辑器桥接的导出契约。
- `MultiMix-Frontend/e2e/video-pipeline-production.spec.ts`：继续以真实成片下载验证浏览态导出。
- `MultiMix-Frontend/scripts/check-product-stage-style.mjs`：把展示契约从“导出也打开隐藏编辑器”
  更新为“仅编辑才打开编辑器”。
- `MultiMix-Backend/app/tests/fixtures/display_coverage/seed.py`：仅修正展示覆盖测试对一次性
  `runtime.sqlite3` 的旧文件名限制，使受保护的预览测试能使用统一的临时运行目录。
- `MultiMix-Backend/app/tests/test_display_coverage_seed.py`：覆盖该统一临时文件名仍可通过、开发库
  仍被拒绝的安全边界。

## 具体改法

1. 给已加载的分镜预览 iframe 增加受控 `export()` 接口。只有预览明确 ready 时才发送既有
   `multimix-editor-export` 命令；渲染、质量验证、MP4 保存仍复用现有路径，不绕过质量门。
2. 工作台点击“导出视频”后先跑既有导出前质量检查，再直接调用预览接口。若预览尚在加载，
   显示“正在准备预览导出…”并在预览 ready 后自动继续；不再创建第二个隐藏编辑器 iframe。
3. 导出进度、验证结果、错误和最终 Blob 从预览组件以显式回调上报工作台，保持当前“下载成片 /
   再次下载 / 导出失败重试”的用户可见语义。
4. 完整编辑器仍只由“编辑”按钮打开；编辑中的重做、工程同步等消息继续由其独立处理，避免预览
   消息误改变编辑器状态。
5. 让展示覆盖测试将生命周期创建的 `runtime.sqlite3` 识别为临时测试库；它仍必须是显式绝对
   SQLite 路径，且不得是开发库 `changein.sqlite3`。

## 风险与取舍

- 底层仍会使用同一套渲染引擎，因为它是当前可靠的 MP4 生成器；变化是用户不再需要进入或等待
  编辑器，不能把“直接导出”误解成跳过渲染与质量验证。
- 预览与编辑器都可能存在时，必须按 preview channel 区分消息，防止一个 iframe 的 ready 或进度
  误驱动另一个 iframe。
- 已有 MP4 时仍直接下载已有文件，不重复渲染。
- 测试库校验的放宽只适用于统一 E2E 生命周期生成的 `runtime.sqlite3`；生产与开发数据库仍不会
  被测试脚本选中。

## 验证方式

1. 先写测试：点击导出不会挂载隐藏导出 bridge，而是向预览接口发命令；预览未 ready 时会排队，
   ready 后自动导出。
2. 运行前端相关单测、类型检查和浏览态契约测试。
3. 用独立端口和一次性 SQLite 复跑真实视频：从浏览态点击导出，检查状态变化、下载 MP4、视频
   可解码；结束后清理临时数据库、ArtifactStore 与进程。

## 执行记录

- 已完成：浏览态复用已挂载的预览 iframe 导出；隐藏编辑器只在用户点击“编辑”后挂载。预览
  就绪通知改为提交后回调，避免刚收到 ready 时命令被旧状态吞掉。
- 已完成：47 项前端回归、播放器契约、展示样式契约、类型检查、文档检查通过；展示覆盖的 10 个
  浏览器场景通过。展示测试库接受统一生命周期的 `runtime.sqlite3`，同时仍拒绝 `changein.sqlite3`。
- 真实验收 `preview-direct-export-20260805-r11` 成功跑完编导与视频工程主链，但在点击导出前被既有
  MG 一致性断言阻断：页面按动画编排显示 3 个 MG 增强，权威 `mg_decision` 却均为 `not_needed`。
  该矛盾违反 MG 权威契约，不能通过放宽断言掩盖；本次临时数据库、素材和进程已清理。后续须单独
  修复“动画编排与 mg_decision 的一致性”，再复跑真实预览导出验收。
