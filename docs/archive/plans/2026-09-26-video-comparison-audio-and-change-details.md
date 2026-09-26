# 视频版本对比试听与差异说明

> Status: archived
> Owner: frontend
> Last verified: 2026-09-26

## 背景与根因

现有对比模式在 `app/assets/components/product-preview.tsx:568-680` 中同时播放两版完整视频，`app/assets/components/video-preview-player.tsx:31-178` 没有供对比态指定静音的入口，导致两条音轨叠加。受影响分镜目前调用 `app/assets/lib/video-version-comparison.ts:151` 生成“节奏 · 画面”等类别标签，没有指出实际变动，也缺少点击后的具体前后值。用户已确认只优化这两项，不新增联动模式或第二套分镜卡。

## 改法与涉及文件

1. 在 `video-preview-player.tsx` 增加可选静音属性，不改播放器外壳、比例和播放控件合同；在 `product-preview.tsx` 对比态默认只让修改后有声，以一个紧凑切换控件选择试听修改前/后。切换只改变音轨，不重建视频或改跳转行为；重新进入对比默认修改后有声。
2. 在 `video-version-comparison.ts` 从已有两版分镜字段生成简短、可核对的事实摘要与详情：时长和时间变化列实际数值；口播、标题、素材、MG 等仅对两边有可靠值的字段展示前后内容，其余仅说明类别，不臆测原因。`product-preview.tsx` 在现有受影响分镜列表内展开详情，不另起卡片组。
3. 更新 `app/globals.css:3816-3983`、`docs/specs/ui/prototypes/current/screens/workspace-video.html:223-245,733-751`、`docs/MULTIMIX_WORKSPACE_DESIGN.md:439` 与 `docs/specs/ui/video-artifact-browse-and-edit-states.md:49-58`，保持当前视觉原型及规范一致，播放器外壳合同原样保留。
4. 在 `app/assets/__tests__/video-version-comparison.test.ts` 与 `product-workspace-video-actions.test.tsx` 覆盖事实差异、默认静音、切换试听、分镜展开和跳转。先写失败用例，再做最小实现。

## 风险与取舍

- 两个浏览器视频仍分别解码；只保证点击时定位与同时播放，不宣称逐帧同步。静音只作用于对比态，不影响单视频。
- 历史快照缺字段时，宁可使用“画面已调整”等不含前后值的描述，也不伪造素材身份。
- 展开详情沿用一套受影响分镜列表，不重复完整分镜卡或制作入口。

## 验证方式

- 定向 Vitest 验证差异事实、音轨唯一性和交互；运行 lint/typecheck。
- 因涉及 `video-preview-player.tsx`，运行 `check:video-preview-contract`、`test:product-stage-style` 与隔离的 `test:display-coverage`；截图基线失败须区分既有差异与本轮回归。
- 运行 `docs:check`；用真实渲染页面或当前原型检查桌面和窄屏下切换控件、展开详情的清晰度。

## 任务

- [x] 记录方案并登记开发占用。
- [x] 先补失败测试，再实现单音轨试听及事实差异详情。
- [x] 同步规范和当前原型并检查视觉。
- [x] 运行验证、核对改动范围并释放占用。

## 本轮验证记录

- 定向 Vitest 47/47；展示区组件测试 40/40；类型、lint、文档、播放器视觉契约和产品阶段样式检查均通过。
- 隔离展示区 E2E：14 通过、4 失败、1 跳过。失败分别为新对话旧断言、视频库数量，以及两处播放器截图 1px 高度差；均与上一轮基线相同，未据此改写截图基线。新对比试听不在该 E2E 既有场景中，由定向组件测试和当前原型浏览器截图覆盖。
- 临时 SQLite 和测试进程已清理；测试生成的旧 QA 截图恢复到运行前状态。当前原型桌面截图见工作区外的 `video-compare-audio-details-desktop.png`。
