# 视频工作台分镜浏览与胶片条编辑实施计划

> Status: active-plan
> Owner: frontend
> Last verified: 2026-07-30

**目标：** 让 ready 视频工程默认以可交互分镜浏览态展示，点击顶部“编辑”后在当前展示区进入胶片条编辑态。

**架构：** 使用统一的 ready 判断决定是否开放浏览和编辑。浏览态把最终工程时间线投影为分镜视图；无 MP4 时复用编辑器预览引擎的只读模式。编辑态继续复用 `/editor?embed=1` 和 `FilmStrip`，全屏 `/editor` 仅作高级入口。

**技术栈：** Next.js 15、React 19、TypeScript、Vitest、现有 editor-engine。

> 2026-07-21 状态回填：Task 1–4 的实现已存在于当前前端，并由 mapper、浏览态、编辑器和素材替换测试覆盖。后续一致性补强记录见 `docs/archive/plans/2026-07-21-video-workbench-browse-edit-consistency.md`；本计划只保留尚未完成的隔离 E2E 验收。

## 2026-07-30：浏览态懒加载与“编辑”入口回归修复

### 背景与根因

`CASE-06` 展示区 E2E 发现 ready 且尚无 MP4 的工程，在用户没有操作时便加载了完整工程预览。根因位于 `MultiMix-Frontend/app/assets/components/product-preview.tsx`：`projectPreviewRequested` 的初值和产品切换 effect 都写为 `true`。这绕过了浏览态的轻量分镜预览，且让“编辑”按钮与实际状态不一致。

当前产品规格 `docs/specs/video-workbench-browse-and-filmstrip-edit.md` 已明确：默认分镜浏览态；用户点击顶部“编辑”后，在当前展示区进入嵌入式胶片条编辑态。完整只读工程预览不是默认加载路径。

### 涉及文件与具体改法

- `MultiMix-Frontend/app/assets/components/product-preview.tsx`
  - 将完整工程只读预览改为显式请求：初始和产品切换后均保持 `projectPreviewRequested=false`。
  - 保留“加载完整工程预览 / 重新加载完整工程预览”作为浏览态中的可选预览动作；失败时仍回退轻量分镜预览。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`
  - 保持顶部“编辑”作为唯一默认编辑入口；点击后仅切换当前工作区到 `/editor?...&embed=1`，由 `EditorView` 的 embed 模式展示 `FilmStrip`。
  - 不把浏览态的预览加载动作改造成编辑动作，不自动跳转全屏时间线。
- `MultiMix-Frontend/e2e/display-area.spec.ts`（CASE-06）
  - 先断言首次打开只显示 `轻量分镜预览`，且没有 `/editor` 请求、工程预播 iframe 或编辑器 iframe。
  - 点击“编辑”后断言出现 `视频剪辑器` iframe，地址带 `embed=1`，并验证胶片条而非只读 `mode=preview` 预览。
  - 将只读工程预览的显式加载验证保留为独立可选动作，避免把它误当作编辑主路径。
- `MultiMix-Frontend/app/assets/__tests__/display-area-cases.test.tsx` 与 `product-workspace-video-actions.test.tsx`
  - 覆盖首次浏览态不挂载 iframe、点击“编辑”后才挂载 embed 编辑器/胶片条的契约。

### 风险与取舍

- 不再自动加载完整工程会少展示转场与动效，但首屏更快、更符合用户意图；用户仍可主动加载预览或进入编辑。
- `video_project_ready` 仍是开放浏览和编辑入口的唯一前提；本次不放宽 ready 判断，也不修改后端工程状态。
- 不改播放器外壳、比例和视觉契约；只纠正加载时机和“编辑”进入胶片条的交互路径。

### 验证方式

- 先使 CASE-06 在修复前失败，再完成最小修改并验证首次打开无 `/editor` 请求。
- 运行定向组件测试、`npm --prefix MultiMix-Frontend run check:video-preview-contract`、`npm --prefix MultiMix-Frontend run test:product-stage-style`、隔离的 `npm --prefix MultiMix-Frontend run test:display-coverage`。
- 隔离 E2E 使用一次性 SQLite、独立端口，结束后删除数据库与临时构建产物并停止进程。

### 执行记录

- [x] `projectPreviewRequested` 的初始值和产品切换重置值均改为 `false`；只读工程预览只在用户点击“加载完整工程预览”后挂载。
- [x] CASE-06 改为验证首次没有编辑器请求、点击“编辑”进入 `embed=1` 的胶片条、完成编辑回到轻量分镜，以及可选只读预览仍可加载。
- [x] 更新组件与源码契约测试，覆盖被动浏览不挂载 iframe 和主动只读预览加载。
- [x] 已通过：定向 Vitest 43/43、`docs:check`、`check:video-preview-contract`、`test:product-stage-style`、`typecheck`、`lint`、隔离 `test:display-coverage`（组件 28/28、浏览器 9/9）。
- [x] 隔离测试库 `C:\Users\24566\AppData\Local\Temp\multimix-display-coverage-744a0d35-3f6d-4649-afb9-64f40a6a26c2.sqlite3` 与同名临时产物已清理；8299/3219 无监听进程。

## 全局约束

- 不开 Subagent，全部在当前会话内联执行。
- 不覆盖工作区现有无关改动。
- `asset_reference` 是分镜素材引用权威；`mg_decision` 是 MG 权威。
- 每项先增加失败测试并确认失败，再写最小实现。
- UI 以 `docs/specs/ui/prototypes/current/screens/workspace-video.html` 为视觉基准。

---

### Task 1：统一视频工程可用状态与分镜投影

**文件：**

- 修改：`MultiMix-Frontend/lib/asset-mappers.ts`
- 修改：`MultiMix-Frontend/app/assets/lib/asset-workspace-types.ts`
- 测试：`MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`

- [ ] 增加真实后端工程夹具：`video_project` 只有 `media`、`tracks`、`script` 和 `orchestration`，没有虚构的 `video_project.segments`。
- [ ] 验证测试先因缺少时间线到分镜投影、MG 状态或缩略图而失败。
- [ ] 从最终工程轨道和 `video_segments`/`video_plan.scenes` 按稳定分镜标识合并起止时间、文案、`asset_reference` 和 `mg_decision`。
- [ ] 给 `AssetProductSegment` 增加 MG 状态字段；ready 结果显式投影到 product metadata，供组件统一消费。
- [ ] 运行：`npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts`，预期全部通过。

**验证案例：**

- [ ] ready 工程的每个分镜都有真实 `startSeconds/endSeconds`。
- [ ] `mg_decision.status=rendered/failed` 均被保留，失败不影响工程 ready。
- [ ] 非 ready 的占位或恢复中工程不会被标记为可编辑。

### Task 2：让浏览态分镜卡片完整可交互

**文件：**

- 修改：`MultiMix-Frontend/app/assets/components/segment-cards.tsx`
- 修改：`MultiMix-Frontend/app/globals.css`
- 新建测试：`MultiMix-Frontend/app/assets/__tests__/segment-cards-contract.test.ts`

- [ ] 增加源码契约测试，要求卡片在浏览态始终支持选择、键盘操作、active 状态、MG 状态和“换素材”操作槽。
- [ ] 运行测试并确认因当前 `onSelect`/MP4 门控和缺少换素材按钮失败。
- [ ] 扩展 `SegmentCards` 接口：选择与换素材分别传入回调；操作按钮阻止冒泡；卡片无伪造时间时保持可选。
- [ ] 按原型补充 hover、focus-within、active 和操作按钮样式。
- [ ] 复测契约测试与 mapper 测试。

**验证案例：**

- [ ] 鼠标悬停、键盘聚焦和选中卡片时均可看到“换素材”。
- [ ] 点击卡片选择分镜；点击“换素材”不会额外触发一次分镜跳转。
- [ ] MG 徽章显示模板和真实状态。

### Task 3：建立无 MP4 也可用的工程浏览播放器

**文件：**

- 新建：`MultiMix-Frontend/app/editor/ReadOnlyProjectPreview.tsx`
- 修改：`MultiMix-Frontend/app/editor/EditorView.tsx`
- 修改：`MultiMix-Frontend/app/assets/components/product-preview.tsx`
- 修改：`MultiMix-Frontend/app/assets/components/product-workspace.tsx`
- 新建测试：`MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts`

- [ ] 增加契约测试：有 MP4 使用原生 video；无 MP4 的 ready 工程使用只读工程预览；两者都接收分镜跳转并同步当前分镜。
- [ ] 运行测试并确认当前静态 poster 分支导致失败。
- [ ] 为嵌入式编辑器增加 `mode=preview`：只渲染 `PreviewPanel`，通过 `postMessage` 接收 seek/play/pause，并回传 ready/time/playing 状态。
- [ ] 在浏览态无 MP4 时嵌入 preview-only iframe；有 MP4 时保留原生 video。
- [ ] 解除 `SegmentCards` 对 MP4 的点击门控，并根据播放器时间自动更新 active 分镜。
- [ ] 复测浏览契约、mapper 和编辑器布局测试。

**验证案例：**

- [ ] 无 MP4 的 ready 工程不再显示假播放按钮，可播放、暂停和按分镜定位。
- [ ] 有 MP4 与无 MP4 两条路径都能随播放进度高亮当前分镜。
- [ ] preview-only 模式不显示胶片条或多轨时间线。

### Task 4：接通浏览态换素材和默认胶片条编辑

**文件：**

- 修改：`MultiMix-Frontend/app/assets/components/product-preview.tsx`
- 修改：`MultiMix-Frontend/app/assets/components/product-workspace.tsx`
- 修改：`MultiMix-Frontend/app/editor/EditorView.tsx`
- 修改：`MultiMix-Frontend/app/editor/FilmStrip.tsx`
- 测试：`MultiMix-Frontend/app/editor/__tests__/editor-layout.test.ts`
- 测试：`MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts`

- [ ] 增加测试：顶部“编辑”打开 embed 胶片条；浏览态“换素材”携带分镜标识打开同一套素材选择；“完成编辑”返回浏览态。
- [ ] 运行测试并确认浏览态尚未暴露换素材桥接而失败。
- [ ] 让 workspace 把 token 和更新回调传给浏览态；通过现有建议/重组接口复用 AssetPicker，而不是复制重组逻辑。
- [ ] 保证 embed 模式默认 FilmStrip，全屏模式仍是 Timeline，preview 模式两者都不显示。
- [ ] 重组成功后刷新当前 product，并保留当前分镜选择；失败时保留旧素材。
- [ ] 复测相关测试。

**验证案例：**

- [ ] 顶部“编辑”只切换当前展示区，不跳全屏。
- [ ] 浏览态和胶片条态的换素材使用同一后端重组链路。
- [ ] “全屏打开”仍可进入完整时间线编辑器。

### Task 5：回归与浏览器验收

**文件：**

- 更新：`docs/specs/video-workbench-browse-and-filmstrip-edit.md`
- 移动完成计划到：`docs/archive/plans/2026-07-11-video-workbench-browse-filmstrip.md`

- [ ] 运行定向 Vitest、`npm --prefix MultiMix-Frontend run typecheck`、`npm --prefix MultiMix-Frontend run lint` 和 `npm --prefix MultiMix-Frontend run docs:check`。
- [ ] 如需启动浏览器环境，先通知一次性 SQLite 路径、独立端口和清理策略；不得占用 3117/3200/8199 或连接 Supabase。
- [ ] 用 ready 有 MP4、ready 无 MP4、MG failed、换素材失败、非 ready 五种状态完成手动验收。
- [ ] 关闭本次启动的进程并删除一次性测试数据库。
- [ ] 勾选规格验收项，归档本计划。

**验证案例：**

- [ ] 默认分镜浏览、胶片条默认编辑和全屏高级编辑三层边界符合原型。
- [ ] 不存在静态假播放器、不可点击分镜或 raw `video_project` 绕过 ready 判断。
