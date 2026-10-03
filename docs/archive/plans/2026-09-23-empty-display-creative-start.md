# 展示区空态：创作起点

> Status: archived
> Owner: frontend
> Last verified: 2026-09-23

## 背景与根因

新建对话尚未生成产物时，当前 `assets-workspace-client.tsx:3298` 只渲染全宽 `ConversationStart`，根本没有右侧展示区；`EmptyProductWorkspace`（`app/assets/components/product-workspace.tsx:164`）仅在已有对话但未选中产物时渲染，且内容只有“还没有生成产物 / 继续左侧对话”。因此空展示区既没有解释作品如何从对话变成可编辑视频，也无法在用户刚开始聊天时承担“当前创作从哪里开始”的辅助作用。

这不是缺少后端数据：首条消息前没有可靠的目标、受众、时长或素材事实，前端不能伪造创作摘要。空态应展示固定、非交互的过程预览；发送首条消息后，现有等待态和真实产物继续接管展示区。

## 目标与范围

- 将空展示区改为低干扰的“创作起点”，帮助用户理解创作会经历“明确目标 → 形成编导方案 → 生成可编辑视频”。
- 用抽象分镜/视频画布和简短提示提供视觉锚点，不添加提交、选择或配置操作，不与左侧新建页的目标卡和输入示例重复竞争。
- 保持现有数据边界：不在首条消息前展示、推断或缓存用户创作摘要；不改 API、对话发送、产物选择及视频预览契约。
- 将已确认空态规则写入工作台设计文档，新增单元和真实浏览器展示区用例。

## 涉及文件与关键行

- `app/assets/components/assets-workspace-client.tsx:3285`：新建对话从单列 `ConversationStart` 改为“起始输入 + `EmptyProductWorkspace`”双栏，不增加第二输入或改变首条消息发送逻辑。
- `app/assets/components/product-workspace.tsx:164`：替换 `EmptyProductWorkspace` 的低信息占位内容，使它同时服务新建对话和已有对话尚无产物的真实空展示区。
- `app/globals.css:1128`、`2490`、`4199`：为 `empty-mode` 定义桌面双栏与窄屏单列降级，并新增空态专属样式；复用工作台色彩、边框、圆角与 reduced-motion 规则，不能影响正式产物、视频播放器或滚动面。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:3`：补充展示区无产物时的产品规则，明确首条消息后由真实状态接管。
- `app/assets/__tests__/display-area-cases.test.tsx`：增加空态的可访问内容与“无伪造产物”的单测。
- `e2e/display-area.spec.ts`：以隔离 display-coverage fixture 打开新建对话，断言空态内容、无产物操作及首屏视觉，并保存桌面截图证据。

## 具体改法

1. 在新建对话布局中并列渲染现有 `ConversationStart` 和 `EmptyProductWorkspace`；桌面沿用工作台左右分区，窄屏退回单列。新建页仍只有左侧输入框和既有目标/示例卡，首条消息后沿用已有的对话/等待/产物切换。
2. 在 `EmptyProductWorkspace` 中建立语义明确的空态层级：标题“你的作品会在这里逐步成形”，一条不含用户事实的流程轨迹，三个阶段为“明确目标 / 形成编导方案 / 生成可编辑视频”，以及“先在左侧说说想做什么，或加入资料。”的引导。
3. 添加非交互的轻量画布：三枚分镜缩略形状与视频时间线暗示，使用 `aria-hidden`，避免把装饰当作产物预览或点击入口。
4. 为空态添加限定选择器，不调整 `.shadcn-prototype-product-preview` 的通用产品与视频样式；在 `prefers-reduced-motion` 下静止显示。
5. 在工作台设计文档中写明：空态只说明生产路径，不显示模拟进度、素材数量或用户未提供的创作摘要；首条消息后的真实等待态/产物态不受影响。
6. 先写单元断言，再更新 display-coverage E2E，在真实本地页面截图中核验桌面呈现；不使用生产环境、Supabase 主库或开发端口。

## 风险与取舍

- 空态若承载过多示例或可点击建议，会与左侧已经存在的起始输入、目标卡和示例卡重复，造成双重主入口；因此只保留静态说明。
- 首条消息前没有服务端生成的“创作摘要”，展示猜测内容会破坏来源真实性；本次不实现摘要，待后端提供结构化需求快照后再单独设计真实摘要态。
- 该改动不得触碰受保护的视频预览壳；空态画布不是播放器，不能套用或改变播放器契约。

## 验证方式

1. 运行空态与展示区相关 Vitest，确认可访问标题、三阶段说明、非交互画布和无产物操作。
2. 运行 `npm run typecheck` 和 `npm run docs:check`。
3. 使用一次性 SQLite `~/Desktop/multimix-test-results/e2e-runtime/display-coverage/empty-display-creative-start-20260923/runtime.sqlite3` 启动隔离 display-coverage E2E，使用后自动删除该次运行目录、停止自身启动的 8492/3492 进程；绝不连接 Supabase 主库或占用 3117/3200。
4. 在 `1280×720`、`1440×900` 真正浏览器页面保存空态截图，核验空态无“详情 / 编辑 / 保存 / 导出”等产物操作，且左侧新建对话入口仍可见。

## 实施结果

- 新建对话现以桌面双栏渲染：左侧保留原有起始输入、目标卡和示例卡，右侧渲染 `EmptyProductWorkspace`；`940px` 以下安全退回单列。
- 空展示区显示三段固定创作路径和非交互分镜画布，不包含模拟进度、用户摘要、素材数量或产物操作。
- 首条消息后的切换逻辑未改：新建页退出后继续使用既有对话、等待和真实产物展示路径。
- 2026-09-23 验证通过：相关 Vitest 106 项、`npm run typecheck`、`npm run docs:check`，以及隔离 display-coverage E2E（1 项）；截图已保存至 `artifacts/qa/desktop-ui-ux-remediation-20260917/creative-start-1280x720.png` 和 `creative-start-1440x900.png`。临时 SQLite 及 8492/3492 进程已清理。
