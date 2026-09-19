# 桌面工作台 UI/UX 视觉层级与组件一致性整改计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-17

## 目标

在不改变产品流程和后端契约的前提下，修复桌面网页端已确认的五类问题：

- 对话区与展示区主次关系不稳，图片结果和对话产物卡没有充分利用可用宽度。
- 项目名在系统生成的多个层级重复，产物类型、版本和状态反而不够突出。
- 按钮高度、字号、文字颜色、圆角和间距缺少明确分层，组件视觉不够整齐。
- 同一次失败在对话时间线和右侧展示区同时提供恢复动作，用户难以判断应该点哪个。
- 图片库把内容分类和处理状态放在同一排同款胶囊里，筛选维度不清楚。

本计划只覆盖桌面网页端，主要验收尺寸为 `1280 × 720` 和 `1440 × 900`。手机端、平板端和 `<= 1180px` 的工作台响应式重构不在本期范围内，也不在本期结论中宣称已解决。

## 审查证据

- 审查报告（仓库外只读证据）：`/Users/zhangzhishu/.gstack/projects/DingxinTao0417-MultiMix-Frontend/designs/design-audit-20260915/design-audit-multimix-local.md`
- 桌面对话与文案结果：`screenshots/case01-desktop.png`
- 桌面图片结果：`screenshots/case14-desktop.png`
- 桌面失败态：`screenshots/case05-desktop.png`
- 桌面图片库：`screenshots/image-library-desktop.png`
- 桌面新建项目页：`screenshots/new-project-desktop.png`

## 背景与根因

### 1. 宽度由固定值和收缩上下文共同决定

- `app/globals.css:1015-1025` 把对话区默认宽度设为固定 `640px`；`app/assets/components/assets-workspace-client.tsx:654`、`:1565-1615` 又以 `320px / 360px` 作为拖拽下限。不同桌面宽度下，结果区没有稳定的视觉份额。
- `app/globals.css:1679-1685` 的助手消息是 `justify-self: start` 的收缩项，而 `:1762-1767` 的产物卡列表又使用百分比宽度，导致 `width: min(560px, 92%)` 在收缩上下文中只得到约 233px。
- `app/globals.css:4125-4131` 让图片预览使用隐式网格轨道并整体居中；子卡虽然写了 `width: 100%`，仍会按内容收缩，因此图片结果没有成为右侧视觉焦点。

### 2. “项目身份”和“产物身份”没有分工

- `app/assets/components/conversation-studio.tsx:930-979`、`product-workspace.tsx:1406-1430` 和 `product-preview.tsx:400-409` 都直接显示 `product.title`。
- 同一项目名因此同时出现在侧边栏、对话头、产物卡、展示区头部和图片说明中；用户看到大量重复标题，却不容易快速识别“这是封面图、编导稿还是视频工程，以及哪个版本”。

### 3. 视觉规格以局部字面量堆积

- `app/globals.css:106-132` 只有颜色和阴影 token；控件高度、字号、圆角和间距没有同级 token。
- 起始页、对话产物卡、项目资源条、展示区头部、资源库工具栏分别使用 `10px–15px` 字号与 `27px–38px` 控件高度。可见辅助文字仍有 `10px–11.5px`，并多次使用对比度不足的 `--sp-faint: #9b968e`。
- 产品头部 `30px` 胶囊是当前设计明确允许的紧凑工具栏例外，不应被全局放大；问题在于其余按钮没有稳定地归入普通操作或主要操作层级。

### 4. 恢复动作被两个区域同时拥有

- `app/assets/components/agent-run-timeline.tsx:153-168` 已在真实失败步骤上显示“重新执行此步骤”。
- `app/assets/components/product-workspace.tsx:1955-2014` 和 `product-preview.tsx:161-213` 又显示“重试生成”“回对话调整”等动作。
- 两套动作没有说明执行范围，形成相互竞争的主按钮；生成中或失败时，展示区头部还可能出现与当前状态无关的“保存”。

### 5. 资源库筛选没有表达维度

- `app/assets/components/library-workshop.tsx:738-770` 把内容分类和处理状态渲染在同一个容器。
- `app/globals.css:5934-5978` 给两类筛选使用同一按钮外观，只靠一个分隔线和小圆点区分，用户需要逐项阅读才知道含义。

### 6. 新建项目页存在不必要的视觉竞争

- `app/assets/components/conversation-start.tsx:444-510` 把能力说明、目标帮助和两组起点卡拆成相距较远的区域。
- 第一张输入示例卡永久使用 `featured` 样式，形成未选择也高亮的假优先级；空输入框的纵向空间也偏大。

## 权威设计与不可回退项

- `docs/MULTIMIX_WORKSPACE_DESIGN.md:20-57`：对话负责意图，展示区负责当前结果；桌面端保持左侧导航、对话区、展示区三部分。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:149-160`：新建页仍以对话框为第一入口，保留四张目标卡和三张输入示例卡，点击只填充输入框。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:261-329`：对话产物卡负责切换，展示区只显示当前产物并优先完整展示结果。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:341-358` 与 `docs/specs/ui/prototypes/current/screens/workspace-video.html`：`video-preview-shell-contract:v1` 全部保留。本期不改白色播放器外壳、边框、20px 圆角、7px 内边距、双层阴影、媒体比例、44px 播放键或控制条。
- `docs/specs/ui/agentic-workbench-design.md`：产物头部 `30px` 胶囊工具栏继续作为紧凑例外；普通按钮和主操作再使用更舒适的尺寸。

## 范围

### 计划修改

- 设计与原型：
  - `docs/MULTIMIX_WORKSPACE_DESIGN.md`
  - `docs/specs/ui/agentic-workbench-design.md`
  - `docs/specs/ui/prototypes/current/screens/workspace-video.html`
  - `docs/specs/ui/prototypes/current/screens/library.html`
  - `docs/specs/ui/prototypes/current/screens/start.html`
- 实现：
  - `app/globals.css`
  - `app/assets/lib/asset-workspace-shared.ts`
  - `app/assets/components/assets-workspace-client.tsx`
  - `app/assets/components/conversation-studio.tsx`
  - `app/assets/components/conversation-start.tsx`
  - `app/assets/components/materials-ready-strip.tsx`（移除首页仅统计图片的旧提示条及对应请求）
  - `app/assets/components/product-workspace.tsx`
  - `app/assets/components/product-preview.tsx`
  - `app/assets/components/generated-image-gallery.tsx`（仅在需要消除重复图片说明时调整）
  - `app/assets/components/library-workshop.tsx`
- 契约与测试：
  - `scripts/check-product-stage-style.mjs`
  - `app/assets/__tests__/product-stage-style-contract.test.ts`
  - `app/assets/__tests__/conversation-start-primary-tasks.test.tsx`
  - `app/assets/__tests__/display-area-cases.test.tsx`
  - `app/assets/__tests__/product-workspace-video-actions.test.tsx`
  - `app/assets/__tests__/generated-image-gallery.test.tsx`
  - 新增桌面视觉层级、产物身份和资源库筛选的定向测试
  - `e2e/display-area.spec.ts`

### 明确不做

- 不修手机端、平板端、侧边栏窄屏重新打开方式或单面板切换模式。
- 不修改后端、API、数据库、产物数据结构或生成流程。
- 不从标题、正文或文件名猜测产物分类；只消费明确的 `artifact_category`、约定的 `content_type` 和确定性的 `mode` 兜底。
- 不调整播放器视觉方向，不修改编辑器、多轨时间轴、登录页或后台管理页。
- 不提交、不推送、不部署；除非用户在后续请求中另行明确授权。

## 已锁定的桌面设计决策

### 1. 工作台空间分配

- `> 1180px` 时保持 264px 左侧导航。
- 对话区默认使用 `clamp(480px, 52%, 720px)`，展示区占剩余宽度且不小于 420px；6px 拖拽分隔条保留。
- 用户拖拽后继续尊重用户宽度；键盘左右调整、ARIA 数值和拖拽边界同步到新的桌面最小宽度。
- 1280px 桌面约为 `526 / 484`，1440px 桌面约为 `611 / 559`；更宽屏幕优先把新增空间交给结果区。

### 2. 结果区和产物卡

- 对话产物卡使用 `width: min(100%, 560px)`，其消息容器获得明确可用宽度，避免百分比在收缩项中循环计算。
- 图片预览显式建立 `minmax(0, 1fr)` 网格轨道并顶部对齐；普通图片和生成图片都使用右侧内容宽度，宽屏时可设置合理最大阅读宽度，但不能退回小卡片漂浮。
- 文案继续使用阅读宽度；视频继续使用现有横竖屏播放器宽度和外壳契约，不为了“全宽”拉伸竖屏播放器。

### 3. 标题归属

- 项目名保留在侧边栏项目列表和对话区头部，作为导航上下文。
- 对话产物卡和右侧头部改为“明确产物类型 + 版本 + 状态”，例如“封面图 · v1”“编导稿 · v2”“视频工程 · v1”。
- 产物类型优先读取后端明确分类；缺失时按约定 `content_type` 映射，再以 `mode` 显示“文案 / 图片 / 视频 / 音频 / MG 动效”。禁止检查标题关键词。
- 完整原始标题保留在详情和下载文件名中；用户原话和助手正文不做自动改写。
- 图片正文只保留帧名、用途或图片自身说明；当说明与展示区头部相同，不再重复一行同名标题。

### 4. 组件规格

- 紧凑工具栏：30px 高，仅用于产物区 header；保持现有 30px 契约。
- 普通操作：36px 高，用于筛选、搜索、资源库工具和次级操作。
- 主要操作：40px 高，用于上传、发送、失败恢复和确认类动作。
- 可见正文不小于 14px；按钮标签不小于 12.5px；状态、版本和说明文字不小于 12px。
- `--sp-faint` 只用于装饰性图标或非必要提示；所有需要阅读的元信息改用对比度至少 4.5:1 的文字色。
- 控件、内嵌卡、主要卡和播放器分别使用稳定的语义圆角；播放器 20px 为受保护例外，胶囊继续使用全圆角。
- 统一采用 4 / 8 / 12 / 16 / 24px 的间距节奏，避免相邻组件各写一套近似值。

### 5. 失败与生成状态的动作归属

- 有真实 `retryJobId` 的失败由对话执行时间线拥有唯一主恢复动作；右侧只显示失败摘要和“在左侧重试失败步骤”的范围说明，不再重复按钮。
- 没有对话级重试、但服务端明确给出 `modify_script`、`replace_scene_asset` 或 `retry_scene_generation` 时，右侧只显示一个与该动作一致的主按钮；付费单镜重做继续明确费用和范围。
- 不可重试时只显示原因和下一步说明，不制造“重试”按钮。
- 生成中和失败时隐藏保存、编辑和导出；完成后再显示适用操作。

### 6. 资源库筛选

- 分类筛选放入带可见标签的“内容类型”组。
- `已解析 / 待处理` 放入独立的“处理状态”组，保留状态点，但不与分类胶囊混为一组。
- 两组筛选继续独立生效；搜索和上传保留在工具栏右侧。

### 7. 新建项目页

- 缩短空输入坞的纵向高度，但继续保持它是首屏第一操作入口。
- 把“会限制制作方式吗？”放到能力提示附近，并把文案改为明确说明目标与能力提示都只是起点。
- 三张输入示例卡取消第一张永久高亮；目标卡和示例卡都只在用户实际选择后显示选中态，且同一时刻只有一个选中项。
- 保留四张有背景图的目标卡、三张输入示例卡和六项能力提示；点击仍只填充输入框，不自动提交。旧“素材就绪”横条按下方补充确认删除。

### 8. 侧边栏与首页信息精简（2026-09-17 用户补充确认）

- 桌面侧边栏调整为 `新建项目 → 最近项目 → 资源库入口 → 账户`；项目是用户继续工作的主入口，资源库属于全局工具，固定在项目区下方，不再抢占项目列表之前的位置。
- “项目列表 + 数量”改为“最近项目”。默认展示最近 8 个项目；“查看全部”只在项目超过 8 个时出现，并在侧边栏内展开，不新增页面或后端接口。搜索始终覆盖全部项目，搜索期间不受 8 条限制。
- 项目行取消更新时间和第二行状态胶囊，恢复为紧凑单行。选中态使用低对比度中性背景与字重表达，不再依赖偏紫色的整块高亮；更多操作继续仅在悬停、键盘聚焦或菜单展开时出现。
- 状态保留，但只显示有行动价值的三种：`generating → 生成中`、`script_review → 待确认`、`needs_attention → 需处理`。`ready` 与 `needs_input` 不在列表显示状态。
- 关键状态与项目名同一行、靠右显示，使用不带胶囊、底色、图标的 `12px` 短文字；生成中使用低饱和品牌蓝、待确认使用中性灰、需处理使用克制红色。悬停显示更多操作时可以让状态淡出，避免增加第三个固定列。
- 删除新建页底部“你的素材可以开始做视频了”横条。当前实现只查询图片库，却使用“素材”总称并暗示整体视频制作已就绪，产品含义不准确；同时移除其图片库请求、缩略图、样式和测试，不用改文案掩盖数据范围问题。
- 如果未来服务端提供图片、视频和资料的统一可用性汇总，再单独设计跨素材类型的紧凑入口；本次不保留图片专属替代条，也不新增聚合逻辑。

## 实施任务

### 任务 1：固化桌面视觉契约并先补失败测试

- [x] 把本计划确认后的布局比例、标题归属、控件分层、失败动作归属和筛选分组补入当前权威设计与三个当前原型。
- [x] 新增桌面视觉层级契约测试，先证明当前产物卡收缩、图片轨道收缩、可见小字和规格散落问题。
- [x] 新增产物显示身份测试，覆盖明确分类、`content_type` 兜底、`mode` 兜底以及“不得按标题猜分类”。
- [x] 新增失败动作所有权与资源库分组测试，确认当前重复动作和单组筛选会失败。

### 任务 2：修复桌面分栏与结果视觉层级

- [x] 将默认分栏改为桌面比例 + 上下限，保留拖拽、键盘调整和 ARIA 行为。
- [x] 消除助手消息和产物卡列表的收缩宽度循环，让产物卡占满合理内容宽度。
- [x] 为图片结果设置明确网格轨道、顶部对齐和稳定最大宽度；文案、视频各自保留正确阅读/媒体规则。
- [x] 通过分栏边界计算与样式契约验证 1280 和 1440 下无横向溢出；最终视觉截图在任务 7 复核。

### 任务 3：建立项目标题与产物身份分工

- [x] 增加只依赖结构化字段的产物显示身份 helper。
- [x] 对话产物卡、展示区头部和图片说明改用产物类型 / 版本 / 状态，不再机械重复项目名。
- [x] 保留详情中的完整原始标题、下载命名和现有选择/路由行为。

### 任务 4：统一桌面组件规格并收紧新建页

- [x] 在 `.shadcn-prototype-shell` 下补充控件和字号 token，只迁移本计划覆盖的现役工作台选择器；圆角与间距沿用已确认的 4px 节奏和语义层级。
- [x] 保留产物头部 30px 例外，其余普通/主要操作统一到 36px / 40px。
- [x] 将本计划覆盖区域的可见元信息提升到至少 12px，并把需要阅读的 `--sp-faint` 文案迁移到可读颜色。
- [x] 收紧起始输入坞、移动帮助说明位置、取消默认 featured 示例，补齐统一选中态测试。

### 任务 5：收敛失败和生成状态动作

- [x] 用同一服务端失败步骤判定决定恢复动作属于对话时间线还是右侧展示区。
- [x] 对话有真实失败步骤时，右侧仅显示摘要；没有对话恢复动作时，右侧最多显示一个服务端允许的动作。
- [x] 生成中/失败隐藏保存、编辑、导出，完成态保持现有能力。
- [x] 保留运行时写能力门禁、重试防连点、单镜付费提示和原有请求参数。

### 任务 6：重排资源库筛选

- [x] 把分类和处理状态拆成两个有名称的 `role="group"`，保持现有过滤逻辑和状态组合。
- [x] 使用独立标签和容器表达“内容类型”和“处理状态”，保留搜索、上传和加载状态位置。
- [x] 同步 `library.html` 原型与键盘/可访问名称测试。

### 任务 7：联合回归与桌面截图验收

- [x] 运行定向组件测试、样式契约、类型检查、ESLint、构建和文档检查。
- [x] 运行受保护播放器契约、产品展示区样式检查和隔离展示区 E2E；播放器外壳、控件、比例与截图基线均通过，完整 E2E 的独立导出阻塞见下方验证记录。
- [x] 在 `1280 × 720` 和 `1440 × 900` 捕获新建页、文案结果、图片结果、生成中、失败、视频完成、视频工程、图片库和图片详情截图。
- [x] 对照 2026-09-15 审查截图逐项签收，并清理测试进程、临时构建目录和一次性 SQLite。

### 任务 8：重排桌面侧边栏信息架构

- [x] 把最近项目移到“新建项目”之后，并让项目区承担中间可滚动空间；把四个资源库入口固定在项目区下方、账户区上方。
- [x] 将标题改为“最近项目”，默认展示 8 条并提供侧边栏内“查看全部”；搜索继续覆盖完整项目集合。
- [x] 收敛项目行选中、悬停、键盘焦点和更多菜单样式；1280 与 1440 的最终视觉尺寸在任务 10 统一截图复验。

### 任务 9：精简项目状态

- [x] 增加列表专用的显隐映射，只输出“生成中 / 待确认 / 需处理”，不改变服务端状态、项目排序或工作台内部状态逻辑。
- [x] 删除更新时间和第二行胶囊；将关键状态作为同行右侧纯文本，保留长标题截断，并在更多菜单出现时让状态淡出。
- [x] 补充定向测试，覆盖五种 `projectState` 的三显两隐规则，并确认状态含义不只依赖颜色。

### 任务 10：移除不准确的首页素材提示并复验

- [x] 从新建页移除 `MaterialsReadyStrip`，删除无用组件、图片库请求、相关样式、旧原型和过时测试期望。
- [x] 同步 `MULTIMIX_WORKSPACE_DESIGN.md`、`start.html`、`workspace-video.html` 和侧边栏/起始页契约测试。
- [x] 运行定向单测、TypeScript、ESLint、构建与文档检查；在 `1280 × 720`、`1440 × 900` 重拍新建页和工作台侧边栏截图，确认列表简洁、资源库入口稳定且首页不留空洞。

## 2026-09-17 验证记录

- 单元测试：`121` 个测试文件、`985` 个用例通过；展示区定向组件测试 `40 / 40` 通过。
- 静态检查：TypeScript、ESLint、生产构建、文档检查、播放器契约和产品展示区样式契约通过。
- 浏览器验收：新建页、文案/图片结果、生成中、失败恢复、视频工程、播放器、图片库和图片详情通过；CASE-05 与 CASE-08 均确认只有左侧时间线保留恢复动作。
- 截图证据：`artifacts/qa/desktop-ui-ux-remediation-20260917/`，共 `9` 个桌面场景、`18` 张截图。
- 完整 `test:display-coverage` 结果：UI 相关场景均通过；专用恢复用例按预期跳过。唯一遗留失败是 CASE-07 编辑后导出，后端以 `export_duration_mismatch` 拒绝 `9.08s` 文件与 `9.00s` 工程的差异。该问题属于后端质量校验/导出链路，不在本次纯前端整改范围内，也未通过放宽测试绕过。
- 隔离运行 `desktop-ui-ux-20260917-r2/r3/r4` 的进程、临时构建目录和 SQLite 均已清理；未连接 Supabase 主库，未占用开发端口 `3117 / 3200`。

### 侧边栏补充复验

- 全量单元测试更新为 `122` 个测试文件、`990` 个用例通过；本次侧边栏定向测试 `5 / 5`、受影响组件测试 `71 / 71` 通过。
- TypeScript、ESLint、生产构建、文档检查、播放器契约和产品展示区样式契约继续通过。
- 隔离 E2E 已通过新建页、`生成中` 与 `需处理` 三个目标场景；最近 8 条、查看全部/收起、搜索全量项目和已删除素材横条均完成浏览器复验。
- 截图已更新到 `artifacts/qa/desktop-ui-ux-remediation-20260917/`：`new-project-1280x720.png`、`new-project-1440x900.png`、`generating-1440x900.png`、`failure-1440x900.png`。
- `desktop-sidebar-20260917` 及 `r2–r5` 的测试进程和一次性 SQLite 均已清理，端口 `8299 / 3219` 无监听。

## 验收标准

- 1280 和 1440 桌面宽度下，对话区、分隔条和展示区全部可见；默认结果区不小于 420px，拖拽后仍满足两侧最小宽度。
- 对话产物卡不再缩成约 233px；在可用内容宽度内达到 `min(100%, 560px)`，类型、版本和状态可直接辨认。
- 普通图片结果占据右侧主要内容宽度并顶部对齐，不再在大面积空白中漂浮；视频播放器尺寸和外壳保持原契约。
- 系统生成的主界面不再重复完整项目名：项目名负责导航，产物区负责显示“类型 / 版本 / 状态”；详情仍能查看完整原标题。
- 本计划覆盖区域不存在需要阅读的 `< 12px` 文字；正文、按钮和元信息的颜色对比满足既定标准。
- 相同层级组件遵循 30 / 36 / 40px 控件体系；30px 只用于产物 header 紧凑工具栏。
- CASE-05 等失败态全页只有一个主要恢复动作；生成中和失败态不显示保存、编辑或导出。
- 图片库可直接看到“内容类型”和“处理状态”两组筛选，并能独立组合。
- 新建页没有默认高亮的示例卡；选择任一目标或示例只出现一个选中态，只填充输入框。
- 侧边栏顺序稳定为“新建项目 → 最近项目 → 资源库入口 → 账户”；最近项目默认最多 8 条，搜索和“查看全部”仍能访问完整列表。
- 项目列表只有“生成中 / 待确认 / 需处理”三种关键状态，同一行轻量显示；普通项目没有空白第二行、胶囊或更新时间噪声。
- 新建页不再展示只统计图片却泛称“素材”的就绪横条，也不再为该横条额外请求图片库。
- `video-preview-shell-contract:v1`、自然滚动、画布比例、控制条和截图基线全部通过。

## 验证命令

```bash
npm --prefix MultiMix-Frontend test -- --run \
  app/assets/__tests__/product-stage-style-contract.test.ts \
  app/assets/__tests__/conversation-start-primary-tasks.test.tsx \
  app/assets/__tests__/display-area-cases.test.tsx \
  app/assets/__tests__/product-workspace-video-actions.test.tsx \
  app/assets/__tests__/generated-image-gallery.test.tsx \
  app/assets/__tests__/desktop-workspace-visual-hierarchy.test.tsx \
  app/assets/__tests__/library-filter-groups.test.tsx \
  app/assets/__tests__/sidebar-project-navigation.test.tsx
npm --prefix MultiMix-Frontend run test:display-components
npm --prefix MultiMix-Frontend run typecheck
npm --prefix MultiMix-Frontend run lint
npm --prefix MultiMix-Frontend run build
npm --prefix MultiMix-Frontend run check:video-preview-contract
npm --prefix MultiMix-Frontend run test:product-stage-style
npm --prefix MultiMix-Frontend run test:display-coverage
npm --prefix MultiMix-Frontend run docs:check
```

浏览器验收：

- `1280 × 720`：新建项目、图片结果、失败态、图片库。
- `1440 × 900`：新建项目、普通编导稿、图片结果、生成中、失败、完成视频、图片库、图片详情。
- 补充确认复验：新建页和至少一个工作台页面同时覆盖 1280、1440，检查最近项目、关键状态、资源库固定位置和已删除的素材横条。
- 截图输出：`MultiMix-Frontend/artifacts/qa/desktop-ui-ux-remediation-20260917/`。
- 隔离 E2E 使用端口 `8299 / 3219`，并显式使用 `/Users/zhangzhishu/Desktop/multimix-test-results/e2e-runtime/display-coverage/desktop-ui-ux-20260917/runtime.sqlite3`；成功或失败都在记录结果后清理，不连接 Supabase 主库，不占用开发者的 `3117 / 3200`。

## 风险与取舍

- 分栏比例变化会改变文案换行和视频周围留白；因此布局验收同时覆盖 1280 和 1440，并保留用户拖拽。
- 全宽图片会更醒目，但超宽屏不应无限放大；使用结果类型自己的合理最大宽度，不给所有产物套一个固定宽度。
- 去掉重复项目名后，产物身份必须可靠；分类缺失时只使用确定性通用标签，不用标题词表制造看似准确的类型。
- 控件 token 迁移影响面较大；只改本计划列出的工作台区域，不顺手重构编辑器、后台或窄屏样式。
- 单一恢复动作不能牺牲真实能力：只有存在真实任务 ID 和服务端允许的动作才显示，无法重试时明确说明原因。
- 隐藏普通项目状态会减少列表信息量，但项目打开后的完整状态不变；列表只负责帮助用户发现正在运行、等待确认或需要处理的项目。
- 默认只显示最近 8 条必须与搜索、展开和当前选中项目兼容；当前项目不在前 8 条时仍要保证选中上下文可见，不能让用户误以为项目消失。
- 本期不修窄屏。桌面改动不得主动改写 `@media (max-width: 1180px)` 的响应式策略；窄屏已知问题继续保留为独立后续事项。

## 开工门禁（用户确认后执行）

本计划确认前不改 UI 代码。确认后、首次代码写入前执行：

```bash
npm --prefix MultiMix-Frontend run work:guard -- status
npm --prefix MultiMix-Frontend run work:guard -- begin \
  --task desktop-sidebar-information-hierarchy-20260917 \
  --owner codex-root-20260917 \
  --plan MultiMix-Frontend/docs/plans/active/2026-09-17-desktop-workspace-ui-ux-remediation.md \
  --area desktop-sidebar-information-hierarchy \
  --area new-project-entry-ui \
  --path MultiMix-Frontend/app/globals.css \
  --path MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx \
  --path MultiMix-Frontend/app/assets/components/conversation-start.tsx \
  --path MultiMix-Frontend/app/assets/components/materials-ready-strip.tsx \
  --path MultiMix-Frontend/app/assets/__tests__ \
  --path MultiMix-Frontend/e2e/display-area.spec.ts \
  --path MultiMix-Frontend/docs/specs/ui \
  --path MultiMix-Frontend/docs/MULTIMIX_WORKSPACE_DESIGN.md
```

每个任务完成后运行 `work:guard check --token <token>` 并按计划进度向用户汇报；全部完成或放弃后运行 `work:guard end --token <token>` 释放占用。

## 当前进度

- [x] 任务 1：固化桌面视觉契约并先补失败测试
- [x] 任务 2：修复桌面分栏与结果视觉层级
- [x] 任务 3：建立项目标题与产物身份分工
- [x] 任务 4：统一桌面组件规格并收紧新建页
- [x] 任务 5：收敛失败和生成状态动作
- [x] 任务 6：重排资源库筛选
- [x] 任务 7：联合回归与桌面截图验收
- [x] 任务 8：重排桌面侧边栏信息架构
- [x] 任务 9：精简项目状态
- [x] 任务 10：移除不准确的首页素材提示并复验
