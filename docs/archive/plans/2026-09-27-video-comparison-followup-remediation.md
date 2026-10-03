# 视频版本对比二轮整改

> Status: archived
> Owner: frontend
> Last verified: 2026-09-27

## 背景与根因

二轮只读复审确认三项问题：旧/新快照一侧素材来源缺失时，`isFallback` 由映射层默认产出 `false`，对比器把这个派生布尔值当作独立证据，误报“画面已调整”；同一视频元素的上一播放请求晚到拒绝时，播放器只核对元素身份，可能覆盖新播放状态；重复选择同一分镜会重新定位却收起用户正在核对的详情。

## 涉及文件与关键行

- `app/assets/lib/video-version-comparison.ts:10-29,62-98`：画面差异证据字段与双方已知值比较。
- `lib/asset-mappers.ts:1009-1012`：`isFallback` 的派生来源；本轮核对其语义，不改素材显示投影。
- `app/assets/components/video-preview-player.tsx:43-99,160-181`：播放请求、媒体事件与迟到的 Promise 拒绝。
- `app/assets/components/product-preview.tsx:603-629,740-785`：重复选镜、详情展开和播放器定位。
- `app/assets/__tests__/video-version-comparison.test.ts`、`app/assets/__tests__/video-preview-player.test.tsx`、`app/assets/__tests__/product-workspace-video-actions.test.tsx`、`e2e/display-area.spec.ts`：回归用例。
- `app/assets/__tests__/display-area-cases.test.tsx:173-178`：完整展示区检查发现的旧无障碍名称断言；当前播放器已使用带“成片播放器”前缀的名称，需同步测试口径，不修改产品名称。
- `e2e/display-area.spec.ts:11-29,146-161,464-480`：完整 E2E 仍期待已取消的右侧“创作起点”、固定的旧视频库总数，并把每轮桌面截图写回已跟踪的历史证据目录；需与现行单栏规范、动态分页和本轮独立证据目录一致。
- `e2e/display-area.spec.ts-snapshots/video-preview-shell-darwin.png`、`video-preview-storyboard-shell-darwin.png`：CASE-06/07 现有基线都比实际画面矮 1px；先核对控制区几何和像素差异，只在确认视觉契约不变时刷新基线。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`docs/specs/ui/video-artifact-browse-and-edit-states.md`、`docs/specs/ui/prototypes/current/screens/workspace-video.html`：当前对比交互依据与同步。播放器外壳视觉契约不变。

## 执行任务

1. 先补失败测试：真实映射的缺失素材来源不产生差异，但双方有权威画面证据的真实变化仍保留；过期播放拒绝不能覆盖较新的成功播放；重复选择同一分镜后详情仍可见。
2. 对比器不把 `isFallback` 派生布尔值当独立画面证据，继续比较双方已知的来源、主轨身份和素材状态；不更改映射层及素材库现有行为。
3. 播放器为每次播放请求建立序号，并在暂停、播放成功、错误或媒体源重置时使旧请求失效；仅最新请求可更改失败/提示状态。
4. 重复选镜始终保持所选镜详情展开；同步 UI 规格和当前原型的同一交互，不改变播放器外壳、尺寸、比例或双排布局。
5. 修正完整展示区检查中沿用旧播放器无障碍名称的断言，使其验证当前权威名称与加载禁用态，不改播放器实现。
6. 将完整 E2E 中无产物场景改为断言已批准的单栏对话，将视频库分页结果改为验证增长与加载结束；截图证据改写入运行专属外部目录，避免污染已跟踪的历史证据。
7. 分析播放器截图基线的 1px 差异：核对现行 CSS/DOM 几何和像素内容，确认视觉契约不变后仅刷新必要的快照；若发现真实视觉回退，先修根因并复测独立契约。
8. 运行相关单测、类型/lint、文档和播放器独立契约检查；使用一次性 SQLite 的完整展示区 E2E 验证桌面、窄屏与重复键盘激活，清理测试进程和数据库。

## 风险与取舍

- `isFallback` 仍可服务分镜卡的“公共候选”提示，但它由来源字段派生，不应单独充当两版画面变化证据；缺少权威来源的旧数据将少报差异，优于虚假宣称。
- 播放请求序号只用于忽略过时结果，媒体元素自身 `error` 仍按真实失败处理；避免过度吞掉最新失败。
- 重复选镜不再承担“收起详情”操作，因为该卡片的主要动作是定位与核对；切换模式或分镜时继续按原有规则清理状态。
- 本轮不改变 `video-preview-shell-contract:v1`；若验证发现需更改外壳，先征得新的视觉批准。
- 截图基线刷新只接受与现行视觉契约一致的 1px 环境/字体取整差异；不得借此放宽样式断言或改变外壳。外部证据目录由运行时环境变量指定，不影响产品行为。

## 验证方式

- TDD：新用例先失败，修复后通过；保留真实素材替换、播放权限拒绝及加载错误的既有用例。
- 对比 E2E 从真实本地工作台入口进入，检查重复选镜后的焦点、详情和移动端无溢出，并保存截图。
- 必须通过 `check:video-preview-contract`、`test:product-stage-style`、隔离 `test:display-coverage` 与 `docs:check`；记录未覆盖的真实浏览器解码异常。

## 2026-09-27 验证进度

- 已通过：67 个目标 Vitest 用例、40 个展示区组件测试、定向的版本对比 Playwright E2E（桌面及 390px 窄屏）、`typecheck`、`lint`、`docs:check`、`check:video-preview-contract`、`test:product-stage-style`、`git diff --check`。
- 完整 `test:display-coverage` 已运行但未通过：20 个 E2E 中 15 通过、1 跳过、4 失败。失败分别是旧“创作起点”预期、视频库分页用例、CASE-06 与 CASE-07 播放器截图基线；版本对比目标用例通过。不能将完整套件记为通过。
- 核对现行设计确认新对话应该单栏；种子当前共 62 个视频，不应把总数 65 写死。CASE-07 基线与实际的 1px 高度差异始于控制区，外壳属性断言已通过；继续核对后才考虑刷新基线。
- 单栏与视频库两项定向 E2E 已通过。CASE-06/07 重新复现后确认两张实际截图均为 434×280，基线均为 434×279；两者媒体画布和外壳从顶部到控制区前完全逐像素一致，控制区下缘整体仅下移 1px，当前 CSS 契约断言全部通过。可仅刷新 darwin 两张基线，不改变播放器实现或视觉方向。
- 两张 darwin 基线已仅按该 1px 差异刷新；CASE-06 完整用例和 CASE-07 截图阶段通过。CASE-07 后续编辑导出独立失败：测试库中两次导出均被 `export_duration_mismatch` 拦截（容器时长 9.08s、工程 9.00s），导致下载等待超时。该问题不属于基线差异，须单独查明导出媒体时长来源，不能放宽截图或质量门禁掩盖。
- 导出根因和修复记录见后端计划 `2026-09-27-export-video-stream-duration-verification.md`：服务端原来优先读容器时长，现按主视频流时长核对工程，仍保留逐帧容差及真实时长偏差阻断。
- 最终完整 `test:display-coverage` 通过：40 个组件测试，20 个 E2E 中 19 通过、1 个既有跳过；CASE-07 编辑后真实导出与下载通过。`typecheck`、`lint`、`docs:check`、`check:video-preview-contract`、`test:product-stage-style`、两仓 `git diff --check` 均通过；测试数据库和端口已清理。
- 失败运行保留的临时 SQLite 和 artifacts 已通过 `e2e:cleanup` 清理，测试端口已释放；本计划暂留 active。
