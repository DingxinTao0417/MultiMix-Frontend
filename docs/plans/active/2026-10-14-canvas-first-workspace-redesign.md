# 工作台视觉改版：成片优先布局与播放台外壳

> Status: active-plan
> Owner: frontend
> Last verified: 2026-10-16（定稿记录；代码改版待执行）

## 背景与根因

当前工作台的页面结构（对话流在左、展示区在右）和视频播放器外壳（白底细边框卡片）是 2026-07-08 到 2026-08-05 之间逐步确认的设计，记录在 `MULTIMIX_WORKSPACE_DESIGN.md` 和 `specs/ui/agentic-workbench-design.md`，并有独立契约脚本 `scripts/check-video-preview-contract.mjs` 和截图基线把关。

用户在 2026-10-13～2026-10-14 的多轮视觉探索中（`docs/specs/ui/prototypes/explorations/2026-10-13-canvas-first-full-site/`）确认了一套新方案：成片和分镜占主区，对话收成右侧工作轨；播放器外壳从白色细边框改为深色厚外壳并加入底部控制栏（时间码、分镜刻度、画幅、分辨率、来源）。用户已在 2026-10-14 明确批准三件受保护的事：

1. 页面结构约定可以改——对话区从左移到右，宽度规则同步调整。
2. 新的视频播放器外壳可以采用。
3. 以上两项确认后，`MULTIMIX_WORKSPACE_DESIGN.md` 全文需要据此修订。

本计划是这三项批准的落地设计沉淀，覆盖文档层；代码改动在文档确认后另行执行，归入 `workspace-shell` 开发占用区域。

## 定稿记录与实施方式（2026-10-16）

用户 2026-10-16 确认：

1. **播放台色值**：按方案 C `c-system.css` 现值定稿，已写入 `MULTIMIX_WORKSPACE_DESIGN.md` 的 `video-preview-shell-contract:v2`，状态为“已定稿、待实施”。下方“仍需你确认”第 3 条据此关闭。
2. **正式原型**：方案 C 15 屏全部替换 `prototypes/current/`，剪辑器屏归档（不在首发范围）。
3. **登录页文案**：首页/登录页主标题改用方案 C“说出想法，聊着聊着就做出一条短视频”，副标题“AI 协助编导和制作；不满意的地方接着聊、局部改，减少返工。”；新建项目页保持“说出想法，让 AI 帮你更快、更省力地做出短视频。”。登录页代码这一轮不改。
4. **切换时机**：工作区根 `AGENTS.md`「已确认 UI 不可回退门禁」要求契约变化时文档、正式原型、契约检查和截图基线同一轮切换。用户选择在代码改版时一起切换；在那之前，`prototypes/current/`、契约 v1、检查脚本与截图基线保持现状。

本轮（文档）已完成：契约 v2 定稿记录；设计文档第 3 节与视觉规范第 4 节标注“已定稿目标布局、改版前实现仍为对话在左”；方案 C README/入口页标注定稿；10-13 三轮探索入库并补进探索目录。

### 代码改版时须同一轮完成（登记 `workspace-shell` 占用后执行）

- [ ] 布局：`assets-workspace-client.tsx` 宽度常量与渲染顺序、`globals.css` 两栏 grid，改为展示区在左、对话轨 `340–560px`（默认 `400px`）。
- [ ] 播放台：`globals.css` 播放器外壳改为 v2；设计文档把 v2 升为现行、v1 标为废弃。
- [ ] 正式原型：方案 C 15 屏与 `assets/` 移入 `current/`，旧 6 屏（含剪辑器）移入 `explorations/` 存档，更新 `current/` README 与入口页。
- [ ] 检查与基线：`scripts/check-video-preview-contract.mjs` 断言值、浏览器截图基线、工作区根 `AGENTS.md` 门禁里的白色外壳描述（根仓库单独提交）。
- [ ] 登录页：`multimix-app.tsx` 主标题与副标题改为方案 C 文案；`product-positioning-copy-contract.test.ts`、`agent-ui-copy.test.ts`、`accessibility-interactions.test.tsx` 中读取登录页原型和产品文案的断言同步；设计文档第 218 行“登录和新建页主提示统一为”改为分别描述。
- [ ] 后端确认分辨率字段来源（见下方第 1 条）；没有可信字段时不显示分辨率标签。

## 涉及文件与关键行

| 文件 | 当前内容 | 改动点 |
| --- | --- | --- |
| `docs/MULTIMIX_WORKSPACE_DESIGN.md:75`（第 3 节「页面结构」） | `对话区默认宽度采用 clamp(480px, 52%, 720px)，展示区获得剩余空间且不小于 420px；两者之间保留 6px 拖拽分隔条。` 对话流在左、展示区在右。 | 改为：展示区在左、对话轨在右；对话轨默认 `400px`，可拖 `340–560px`；分隔条宽度评估是否仍用 `6px` 或改用新原型的 `8px`（原型用 8px 便于悬停命中，需与现有键盘步进逻辑核对后定稿）。 |
| `docs/MULTIMIX_WORKSPACE_DESIGN.md:457-487`（`<!-- video-preview-shell-contract:v1 -->` 整段） | 白底、`1px solid #eae7e1`、`20px` 圆角、`7px` 内边距、指定阴影；底部控制区只有时间、进度条、总时长。 | 整段重写为 `video-preview-shell-contract:v2`：深色厚外壳（具体色值、圆角、内边距需在原型 `c-system.css` 的 `.stagebox`/`.screen`/`.deck` 规则基础上定稿）；底部控制栏新增画幅、分辨率、来源标签；画布空白区域用模糊填充不留黑边的规则需写入契约。保留旧版本（标注 v1 已废弃，v2 生效于本计划归档后）。 |
| `docs/specs/ui/agentic-workbench-design.md:59`（第 4 节「布局骨架」） | `clamp(480px,52%,720px) 对话流 \| minmax(420px,1fr) 产物区`，`6px` 拖拽分隔条。 | 同步改为新的列顺序和宽度数值，并更新对「新增宽度优先分配给展示区」这条规则的措辞（现在展示区已经是主区，规则改为「对话轨宽度变化不影响展示区占满剩余空间」）。 |
| `docs/specs/ui/agentic-workbench-design.md` 第 5.3 节「产物区（右栏）」 | 标题里的「右栏」指代需要全文检查，改成「左栏」或中性的「展示区」。 | 全文检索「右栏」「左侧对话」等方位词，逐一核对后改写，避免方位词和新布局矛盾。 |
| `app/assets/components/assets-workspace-client.tsx:245-260`（`DESKTOP_CHAT_PANEL_MIN/MAX`、`DESKTOP_ARTIFACT_PANEL_MIN`、`WORKSPACE_DIVIDER_WIDTH`） | `480/720/420/6` | 改为 `340/560/`（展示区最小宽度另定）`/`（分隔条宽度另定，见上）。此为代码层改动，仅记录对应关系，不在本计划内执行。 |
| `app/assets/components/assets-workspace-client.tsx:4366-4454` | `<ConversationStudio>` 先渲染，分隔条，`<ProductWorkspace>` 后渲染（对应 CSS 列顺序：对话在前=左，展示区在后=右）。 | 渲染顺序需要对调，或改用 CSS `order` 属性；具体做法留给实现阶段决定，本计划不预先指定。 |
| `app/globals.css:4259-4290`（`.shadcn-prototype-preview-player` 及比例子类） | 白色卡片样式、`16/9` 与 `9/16` 画布比例规则。 | 改为深色厚外壳样式；画布比例规则需要新增「播放台外壳本身不随画幅比例改变尺寸」的规则（对应新原型的 `.stagebox`/`.screen` 固定高度逐图适配设计）。 |
| `scripts/check-video-preview-contract.mjs` | 断言白色外壳的具体 CSS 值（`border: 1px solid #eae7e1`、`border-radius: 20px`、`background: #ffffff`、指定阴影、`padding: 7px`）。 | 断言内容需要替换成 v2 契约的深色外壳数值；此脚本的改动必须与文档改动同一轮提交，不能脚本先改或文档先改造成临时不一致。 |
| 截图基线（`docs/specs/ui/prototypes/current/screens/workspace-video.html` 及对应 `.githubtest`/E2E 截图） | 当前原型反映 v1 白色外壳布局。 | 需要重新生成反映 v2 深色外壳与新布局的原型和截图基线；这是实现阶段的收口项，本计划先标记依赖。 |

## 具体改法

### 第一步：文档改写（本计划范围）

1. 在 `MULTIMIX_WORKSPACE_DESIGN.md` 第 3 节重写页面结构段落：
   - 列出新的桌面两栏 grid：`展示区（主区，剩余空间）| 分隔条 | 对话轨（340–560px，默认 400px）`。
   - 明确拖拽规则只在「展示区 + 对话轨」两栏布局出现；新建项目、待确认前单栏、资源库、首页、管理后台不出现分隔条——这条规则本来就有，只需确认它在新方向下依然适用并更新措辞里的方位词。
   - 补充：双击分隔条恢复默认宽度（原型新增的交互，当前文档未写）。
2. 在 `MULTIMIX_WORKSPACE_DESIGN.md` 的 `video-preview-shell-contract` 整段标注为 `v1`（废弃，保留存档供回溯），紧接着新增 `video-preview-shell-contract:v2`：
   - 外壳改为深色厚底，具体色值、圆角、内边距以 `docs/specs/ui/prototypes/explorations/2026-10-13-canvas-first-full-site/screens/c-system.css` 的 `.stagebox` 规则为起点定稿（当前原型值：外壳 `background:#111014`、`border-radius:22px`、`padding:10px`；这些是探索稿数值，正式写入契约前需要再核对一次视觉效果，不直接照抄探索稿当定稿）。
   - 画布空白区域填充规则：用当前画面模糊放大版填充，不留纯黑边（对应原型 `.screen .fill`）。
   - 底部控制栏新增：画幅标签、分辨率标签（480P/720P/1080P 档位，具体来源见下方「仍需确认」）、素材来源标签；时间码、进度条、总时长保留。
   - 播放台外壳尺寸与画幅无关：横屏、竖屏放入同一个外壳，不因比例变形或跳动。
   - 分镜胶片条的位置规则随播放台改写：始终在播放台正下方，独占整行宽度（这是对第二版方案的追加修正，原方案里胶片条和信息卡并排，已在原型第三版去掉并排结构）。
   - 保留 v1 契约里仍然适用的部分：浏览态与编辑态分离、分镜轻量预览的内容规则、生成失败时的动作归属（第 8.3.1 节）等不随外壳改色而变化的内容，逐条核对后决定保留或改写，不整段删除重写。
3. 在 `agentic-workbench-design.md` 第 4 节同步改写布局骨架的 grid 定义和宽度数值，并检索全文「左栏」「右栏」「对话流」「产物区」等方位性措辞，逐处核对改写，确保两份文档互相一致。
4. 新增一节记录「拖拽调宽」的完整规则（当前这条规则分散在两份文档里，没有集中说明双击恢复默认这个新交互）：默认宽度、可拖范围、键盘步进、ARIA 数值上下限必须使用同一组数字；哪些页面不出现分隔条。

### 第二步：标记代码改动依赖（本计划只记录，不执行）

写入「风险与取舍」一节，明确文档改完后，以下代码必须同步修改才算真正落地，不能只改文档；这些改动需要另外登记 `workspace-shell` 开发占用后执行：

- `assets-workspace-client.tsx` 的宽度常量与渲染顺序（见上表）。
- `globals.css` 里 `.shadcn-prototype-preview-player` 及其比例子类、分镜摘要相关样式。
- `scripts/check-video-preview-contract.mjs` 的断言值，必须与文档同一轮改，不能有先后窗口期。
- `docs/specs/ui/prototypes/current/screens/workspace-video.html` 原型和对应截图基线（`npm run check:video-preview-contract`、`npm run test:product-stage-style`、`npm run test:display-coverage`）。

## 仍需你确认或由后端评估的事项（不在本计划内解决）

1. **视频真实分辨率的数据来源**：播放台控制栏要显示分辨率标签，前端目前没有查到后端提供的成片分辨率字段；探索稿按常规大模型档位（480P/720P/768P/1080P）画，哪个档位对应哪条真实视频，需要后端确认是否已有字段，没有则由谁推算。这件事归后端，待你决定是否现在写交接文档。
2. **首页示例视频的正式接入**：探索稿左侧用了一段候选 AI 生成样片的截帧，仅用于原型展示；真要在正式首页使用任何示例视频，仍需走已有的「真实案例上架」计划（`docs/plans/active/2026-09-29-homepage-real-cases-and-release.md`）的授权和质量确认流程，本计划不覆盖那部分。
3. **（2026-10-16 已关闭：按方案 C 现值定稿）播放台外壳具体色值的最终定稿**：本计划第二条里引用的色值来自探索稿，是设计方向的参照而非最终像素级定稿；写入正式契约前建议再出一版缩小范围的视觉稿供确认（避免直接把探索稿的占位配色当成生产契约）。

## 风险与取舍

- 这是对已确认 UI 契约（`video-preview-shell-contract:v1`）的替换，按规则必须用户当次明确批准才能改——本计划开头已记录用户 2026-10-14 的批准，后续如果契约脚本或截图基线的改动范围超出本计划描述，需要再次确认，不能自行扩大解释批准范围。
- 页面结构从「对话左、展示区右」改为「展示区左、对话右」会影响所有依赖该布局假设的测试和截图基线，不止播放器一处；改写文档时需要通读两份文档全文，找出所有依赖旧方位的措辞，不能只改第 3/4 节这两处明显段落。
- 分隔条宽度（6px vs 探索稿的 8px）和展示区最小宽度等具体数值，本计划暂定「待实现阶段核对后定稿」，不在文档改写时武断写死，避免和实际可用性冲突。

## 验证方式

- 文档改写完成后，运行 `npm run docs:check` 确认文档结构仍符合入口文档规则。
- 运行 `npm run check:agents` 确认三层 `CLAUDE.md` 仍是薄入口，且文档改写没有破坏既有的视频预览契约检查脚本（本阶段脚本尚未改，检查应仍对旧契约通过，直到代码改动阶段同步替换）。
- 本计划归档前，需要用户确认文档改写内容准确反映了批准的三项决定，再进入下一阶段登记 `workspace-shell` 开发占用并改代码。
