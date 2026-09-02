# 口播全屏素材导出预检修复计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-03

## 背景与根因

- 生产对话 `asset-conversation-717b00d04e1e` 已生成口播工程资产 `1377`，后端质量检查通过，预览可完整播放约 30 秒。
- 导出前端预检将口播轨道中的 3 个 `media_takeover` 全屏素材事件误认为 MG 动效，并因其画面区域与字幕区域重叠而阻止导出。
- `media_takeover` 的职责是临时替换主画面，字幕会继续叠加在其上方；它不是 MG overlay，因此不应参与“MG 与字幕安全区重叠”的判断。

## 涉及文件与关键位置

- `editor-engine/vendor/quality/preflight.ts`：导出前预检收集视频 overlay 的位置。
- `editor-engine/vendor/quality/preflight.test.ts`：MG/字幕重叠及口播全屏素材回归测试。

## 具体改法

- 先增加失败测试，复现 `overlay: true`、`logicalLayer: media_enhancement`、`eventType: media_takeover` 的全屏素材与字幕重叠场景。
- 预检仅从 MG 碰撞候选中排除 `media_takeover`；真实 MG 以及其他可能遮挡字幕的视频 overlay 仍沿用现有检查。
- 不改变口播剪辑、字幕布局、素材编排、后端质量规则或导出渲染方式。

## 风险与取舍

- 仅按稳定的 `eventType=media_takeover` 排除，避免把整条 `media_enhancement` 轨道都放行。
- 如果未来新增另一类全屏主画面替换事件，需要明确其职责后再加入分类，不能用轨道名或中文文案猜测。
- 本次修复只消除错误拦截，不降低真实 MG 遮挡字幕时的保护能力。

## 验证方式

- 单元测试：口播全屏素材与字幕重叠不再产生 `overlay_subtitle_collision`。
- 回归测试：真实 MG 与字幕重叠仍产生 blocker；不重叠时仍通过。
- 工程检查：目标测试、相关测试、类型检查、lint、文档检查及 `git diff --check`。
- 生产验收：部署到 Vercel 正式项目后，重新打开资产 `1377`，执行导出并确认生成的 MP4 有视频、有原音频、时长约 30 秒。

## 生产目标

- Vercel team：`lywgood96-1172s-projects`
- Vercel project：`multimix-frontend`
- 地址：`https://multimix-frontend.vercel.app`

## 执行记录

- RED：新增生产同构测试后，旧实现产生 `overlay_subtitle_collision`，1/10 测试失败。
- GREEN：仅排除 `eventType=media_takeover` 后，预检测试 10/10 通过。
- 相关回归：`buildProject` 与 `serializeProject` 共 80/80 通过。
- 工程检查：类型检查、lint、文档检查、`git diff --check` 通过。
- 全量测试：首次 817/818，通过项之外有 1 个运行时轮询测试偶发超时；该文件单独重跑 18/18 通过，与本次预检改动无关。
- 提交与部署：修复提交 `ddf688b25205ed4e6d0732675a3ce9809c9275fa` 已进入远端 `main`，Vercel 指定生产项目部署成功。
- 生产验收：同一旧工程资产 `1377` 不再被 3 个错误的字幕安全区冲突拦截；导出进入合成与检查阶段，最终显示“下载成片”。
- 成片核验：网页可正常播放约 30 秒成片；后端文件探测确认 MP4 同时包含 1920×1080 H.264 画面和双声道 AAC 原音频。
