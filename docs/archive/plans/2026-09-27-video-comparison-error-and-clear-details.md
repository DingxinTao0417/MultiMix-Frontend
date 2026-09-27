# 视频版本对比错误态与清空详情修复计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-27

## 背景与根因

只读复查确认两项 P2 问题。其一，`VideoPreviewPlayer` 正常态把版本标签放进命名 `group`，但错误分支退化为带 `aria-label` 的普通 `div`，并且重试按钮无版本名；双播放器里读屏用户无法判断失败/重试属于哪一侧。其二，版本详情只接受前后都非空的文本；`asset-mappers.ts` 又把显式空字符串折叠为 `undefined`，导致“新版清空了内容”和“历史字段不可用”无法区分，界面会给出错误的历史缺失说明。

## 涉及文件与关键位置

- `app/assets/components/video-preview-player.tsx:89-102`：播放器加载错误分支的命名语义和重试动作。
- `app/assets/__tests__/video-preview-player.test.tsx:138-153`：播放器失败态回归测试。
- `app/assets/lib/video-version-comparison.ts:150-179`：差异详情的空值处理。
- `app/assets/lib/asset-workspace-types.ts:64-76`：可选文本字段表达“未知”与“明确为空”的语义。
- `lib/asset-mappers.ts:976-990`：标题、口播、字幕和声音名称的快照投影。
- `app/assets/__tests__/video-version-comparison.test.ts`、`app/assets/__tests__/asset-mappers.test.ts`：空值与历史未知测试。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`docs/specs/ui/video-artifact-browse-and-edit-states.md`：更新版本对比错误态及详情语义说明，不改动播放器视觉外壳合同。

## 具体改法

1. 失败态继续暴露 `role="group"` 和调用方传入的播放器名称；重试按钮名称拼入同一标签（例如“修改前 · v1：重新加载视频”），可见按钮文案保持简洁。
2. 文本映射保留明确提供的空字符串为 `""`，字段缺失或 `null` 继续作为 `undefined`；不从不完整历史字段推断其曾被清空。
3. 差异详情在前后字段均已知且不同（允许其中一侧为空）时显示完整对比；空值显示为“已清除”，未知字段仍保持不列出，由原有历史信息缺失提示说明。
4. 先补失败测试，再按最小范围实现；同步规格文案并覆盖播放器错误语义与文本清空的回归案例。

## 风险与取舍

- 空字符串仅在来源字段明确包含字符串时代表“明确为空”；缺失字段、`null` 与未知历史继续保持未知，避免伪造变化。
- `VideoPreviewPlayer` 的错误恢复、可见文案和白色播放器外壳/画布合同不变，只补充语义标签。
- 当前 `workspace-video.html` 是静态视觉原型，没有 React 播放错误态或读屏交互；本次只更新权威规范，不添加仅供截图的模拟错误控件，避免原型视觉/交互失真。
- 不触碰视频播放源、工程数据、生产服务或资产引用；保留工作区已有的其他未提交改动。

## 验证方式

- TDD：失败态播放器必须提供命名 group 和带版本名的重试按钮；明确的空口播/标题差异显示“已清除”，缺少历史字段不显示为清空。
- 运行相关 Vitest、`typecheck`、`lint`、`docs:check`、`git diff --check`。
- 使用仓库 Playwright E2E runner 复验版本对比主流程及桌面/窄屏；如运行 UI runner，先告知独立临时 SQLite 路径与清理策略，并确认结束后临时数据库、进程及测试端口均清理。
- 不修改播放器外壳视觉契约；保留并复核已有 `check:video-preview-contract` 与 `test:product-stage-style`。

## 执行结果

- 播放器错误分支保留具名播放器组；重试按钮名称包含传入的播放器/版本标签，界面可见短文案不变。
- 数据映射保留明确空字符串；标题、口播、字幕、声音与素材快照的缺失/`null` 仍投影为未知。差异详情只在前后两侧字段已知且不同的情况下显示，空值呈现“未设置/已清除”。
- TDD 中三类新断言先失败、实现后通过。相关 Vitest 4 个文件共 128 项通过；`typecheck`、`lint`、`check:video-preview-contract`、`test:product-stage-style`、`docs:check` 和 `git diff --check` 全部通过。
- 隔离真实页面 E2E：CASE-07 桌面/窄屏版本对比 1 项通过；截图存于 `/Users/zhangzhishu/Desktop/multimix-test-results/visual-acceptance/video-comparison-error-details-20260927/`。临时 SQLite 和 runtime 目录已清理，8299/3219 端口无本任务监听。
- 播放器失败态的版本化 accessible name 由 Vitest 验证；本次 E2E 覆盖正常版本对比，不覆盖浏览器媒体真实解码失败，也未进行 VoiceOver/NVDA 人工验收。
- 静态视觉原型没有动态播放器错误态，本次未添加仅供截图的模拟控件；已更新工作台设计合同和浏览态规格。播放器外壳、尺寸、颜色及播放交互均未改变。
