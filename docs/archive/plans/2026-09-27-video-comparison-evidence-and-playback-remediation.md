# 视频版本对比证据与播放状态修复

> Status: archived
> Owner: frontend
> Last verified: 2026-09-27

## 背景与根因

上一轮只读审查发现：版本对比把一侧缺失的数据当作真实变更，导致假差异；重复点击同一分镜时焦点不再回到播放器；播放器把所有 `play()` 拒绝当成媒体加载失败；未记录配乐名称时界面暴露原始 catalog ID。根因分别是缺失值参与比较、焦点仅依赖选中 ID 变化、播放异常未分类、展示标签与内部标识混用。

## 涉及文件与关键位置

- `app/assets/lib/video-version-comparison.ts`：`anyFieldChanged`、`segmentChange`、`videoSegmentChangeSummary`、`bgmChoice`、`compareVideoVersionOverview`。
- `app/assets/components/product-preview.tsx`：`seekComparisonSegment` 及差异详情的证据不足提示。
- `app/assets/components/video-preview-player.tsx`：`togglePlayback`、媒体错误与播放器提示。
- `app/assets/__tests__/video-version-comparison.test.ts`、`video-preview-player.test.tsx`、`product-workspace-video-actions.test.tsx`：回归测试。
- `e2e/display-area.spec.ts`：重复选择同一差异分镜的浏览器焦点验证。
- `docs/specs/ui/video-artifact-browse-and-edit-states.md`：当前产品行为说明。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`docs/specs/ui/prototypes/current/screens/workspace-video.html`：已确认播放器外壳及视觉约束，仅核对，不改变其外壳契约。

## 执行任务

1. 先补失败用例，覆盖单侧缺失字段/未知画幅、未知配乐名称、重复选镜焦点，以及 `play()` 的不同拒绝原因。
2. 只对双方均有可信值的字段认定变更；保留明确清空的真实差异；配乐仅在展示层使用友好缺省名称，内部 ID 继续用于判等。
3. 每次选择差异分镜都把焦点送回播放器；分类处理播放中断、权限拒绝和真实媒体错误，保持现有白色外壳、控件尺寸与间距。
4. 同步 UI 规格并运行单测、类型/静态检查、文档检查、播放器独立契约检查、产品阶段样式检查，以及隔离数据库的桌面/窄屏展示区 E2E。

## 风险与取舍

- 缺失字段不再产出“已调整”，可能减少旧数据的差异条目；这是避免虚假结论的有意取舍，新增/移除分镜仍可展示。
- 内部配乐 ID 不显示，但仍用于可靠判等；名称缺失时只能说明“名称未记录”，不可推断曲名。
- `AbortError` 不代表文件损坏；权限拒绝可提示用户重试，媒体 `error`/不支持格式仍保持可见失败态。
- 不改变播放器壳、画幅计算或双播放器布局；若视觉实现触及其契约，先补权威设计与原型批准，不在本轮自行改方向。

## 验证与完成标准

- 新增测试先复现失败，修复后通过；已知值的真实变化与显式清空继续报告，未知值不制造假变化。
- 同一分镜卡连续两次键盘激活，焦点都落到双播放器区域。
- 浏览器播放中断不显示“视频无法加载”；权限拒绝与真正媒体错误各有准确提示。
- `check:video-preview-contract`、`test:product-stage-style`、隔离的 `test:display-coverage` 均通过；临时 SQLite 与自启进程清理。

## 完成记录

- 2026-09-27：65 个相关 Vitest 用例通过，`typecheck`、`lint`、`docs:check`、`check:video-preview-contract`、`test:product-stage-style` 和 `git diff --check` 通过。
- 隔离的展示区 E2E（版本对比用例）通过，覆盖 1280×720、1440×900、390×844；测试运行目录和临时 SQLite 已清理。播放器外壳契约未改动。
