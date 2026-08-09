# 视频预览简化实施计划

> Status: completed
> Owner: frontend
> Last verified: 2026-08-01

## 背景与根因

视频工程尚未导出成片时，工作台在浏览页嵌入 `/editor` 的预览画面。该嵌入画面带有面向剪辑的缩放、构图网格和全屏控件，普通观看也会看到它们。浏览页还在播放器下方重复显示“完整工程预览加载中”、背景音乐和完整来源素材卡，导致“看结果”的区域被制作信息挤占。

播放器白色外壳及柔和阴影是受保护的 `video-preview-shell-contract:v1`。当前 `.shadcn-prototype-video-browse` 的裁切边界会截断播放器向外扩散的阴影，属于实现问题，不改变视觉契约。

## 目标

让默认视频浏览页只回答“视频效果如何、是否需要我处理”：

- 普通预览不显示剪辑用的 `Fit`、构图网格和编辑器全屏工具；这些只在用户主动进入编辑页时出现。
- 保留白色圆角播放器与柔和阴影，且阴影不再被父容器裁断。
- 预览准备和失败文案使用用户语言，并只在播放器画面内出现；不在播放器下方重复占行。
- 背景音乐和正常素材来源移入已有“详情”浮层；只有确有素材缺口时，主区保留可行动的简短提醒。

## 涉及文件与关键位置

- `MultiMix-Frontend/app/assets/components/video-project-preview.tsx`：工程预览 iframe 与画面内加载/失败提示。
- `MultiMix-Frontend/app/editor/editor.css`：只在嵌入的只读预览模式隐藏编辑工具栏，不改变用户主动打开编辑器时的功能。
- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：视频浏览页的播放器下方状态、音乐、来源与素材缺口提示。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`：已有“详情”浮层中承接音乐和来源引用。
- `MultiMix-Frontend/app/globals.css`：播放器阴影留白、浏览态信息层级、画面内状态样式。
- `MultiMix-Frontend/app/assets/__tests__/video-project-preview.test.tsx`、`display-area-cases.test.tsx`：行为回归；`scripts/check-video-preview-contract.mjs` 与 `scripts/check-product-stage-style.mjs`：视觉契约回归。
- `MultiMix-Frontend/e2e/display-area.spec.ts`：浏览器级默认浏览态验证及播放器截图基线。
- `MultiMix-Frontend/docs/MULTIMIX_WORKSPACE_DESIGN.md`：同步澄清“默认浏览态隐藏编辑工具、详情承接制作信息”；不得修改已确认的播放器外壳契约。当前原型已经符合该信息层级，不新增另一份原型。

## 具体改法

### 1. 分离“观看预览”和“编辑工具”

1. `/editor?...&embed=1&mode=preview` 只保留画面、播放/暂停和播放进度通信；隐藏 `Fit`、构图网格和编辑器全屏按钮。
2. 用户主动进入编辑模式或完整 `/editor` 时，保留现有全部编辑工具，不改变剪辑能力。
3. 默认观看态不增加新的工具条；播放器自身仅保留既有中央播放按钮和轻量进度条。

### 2. 处理播放器的阴影与准备状态

1. 调整视频浏览区的滚动/裁切边界和播放器周边留白，使白色播放器外壳的现有阴影在四周完整可见，同时不新增第二个纵向滚动容器。
2. 把“正在准备工程预览…”改为画面内的“正在准备预览”，加载完成立即消失。
3. 画面内失败提示改为“暂时无法播放预览，可先查看分镜”；保留已有重试入口，但不再显示“完整工程”等实现名称。
4. 删除播放器下方重复的加载、失败说明行；成片播放失败的恢复文案同样使用上述用户语言。

### 3. 收起正常制作信息，仅保留需要行动的提醒

1. 视频浏览页不再默认渲染背景音乐文本与 `SourceRefBlock`。
2. 在已有“生成详情”浮层增加“背景音乐”和“本片素材”区块，复用真实的 `browseBgmSummary` 与 `sourceSummary` 数据，不生成占位内容。
3. `gapNotice` 为空时主预览不展示素材说明；存在素材缺口时，把内部式描述收敛为“有 N 个画面暂未匹配到你的素材”，并提供清晰的“查看分镜”定位入口或复用现有分镜列表中的“换素材”。公共素材本身不是错误，不能单独触发警告。

## 风险与取舍

- 隐藏嵌入预览的编辑工具不能影响完整编辑器；测试必须分别覆盖 `embed + mode=preview` 和正常编辑模式。
- 阴影修复不能通过删除阴影、取消播放器白色外壳或固定播放器高度实现；必须维持 `video-preview-shell-contract:v1`。
- 素材信息从主区移入详情会减少可见信息，但能使默认体验聚焦成片；真正需要处理的素材缺口仍必须留在主区。
- 当前前端工作树已有其他未提交改动。开始前必须通过 `work:guard` 登记精确路径；任何冲突都停止，不覆盖他人改动。

## 验证方式

1. 先为每项用户可见变化写失败测试：嵌入预览不输出编辑工具、加载/失败文案、正常素材与音乐不在浏览页、素材缺口仍可见、详情显示真实信息。
2. 运行对应单元/组件测试，确认改动前失败、最小实现后通过。
3. 运行受保护播放器规定的检查：
   - `npm --prefix MultiMix-Frontend run check:video-preview-contract`
   - `npm --prefix MultiMix-Frontend run test:product-stage-style`
   - `npm --prefix MultiMix-Frontend run test:display-coverage`
4. 运行隔离的展示区 E2E，确认：普通浏览态没有专业编辑控件；加载提示只在画面内；阴影没有被截断；音乐和素材在详情；有素材缺口时出现可行动提示。
5. 若变更影响当前原型或视觉基线，更新两者并执行 `npm --prefix MultiMix-Frontend run docs:check`。
