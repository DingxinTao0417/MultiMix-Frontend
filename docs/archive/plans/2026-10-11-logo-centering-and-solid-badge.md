# MultiMix LOGO 居中修正与实心角标补充版

> Status: archived
> Owner: frontend
> Last verified: 2026-10-11

## 背景与根因

用户 2026-10-11 在 9 个 LOGO 方向中确认 **E + H**：保留已确认的「一笔 M + 向右箭头」概念，只修正纯图标的导出构图；并新增实心角标版作为小尺寸与复杂画面的补充版本。不更换品牌概念，不进入 C/A/A2/B/D/G 任何替代方向。

根因（像素级 alpha 扫描实测，非目测）：`public/brand/multimix-logo-icon-*.svg` 的 192×192 画布内，mark 真实可见边界为 `x 18→190`、`y 28.63→156`，即左 18px、**右仅 2px**、上 28.63px、下 36px，视觉重心落在 `(104, 92.31)` 而不是画布中心 `(96, 96)`。

后果与现行规范冲突：`docs/specs/ui/multimix-logo-identity.md` 第 5 节要求「横版标识四周安全区不小于图标高度的 25%」，而纯图标右侧实际几乎为零，方形头像、favicon、圆形裁切会贴边或切掉箭头尖端，且整体重心右倾。

同时发现：`multimix-brand-kit.zip` 当前不由任何脚本生成（仅被测试断言存在），属于手工产物，本次需纳入生成脚本，否则新增文件无法进入品牌包。

## 涉及文件与关键行

- `scripts/generate-multimix-logo-assets.mjs` — 唯一生成入口。`mark()` 第 10–14 行、`iconSvg()` 第 30–32 行、`horizontalSvg()` 第 34–36 行、SVG 清单第 71–77 行、PNG 渲染第 81–84 行、预览页第 45–68 行。
- `scripts/__tests__/multimix-logo-assets.test.mjs` — 第 9–14 行 variants 清单、第 37–43 行 forward-arrow 断言（硬编码原始 `d`，居中后需同步）、第 45–63 行 manifest/zip 断言、第 65–71 行 PNG 尺寸表。
- `public/brand/brand-kit-manifest.json` — `files` 数组需新增 badge 资产。
- `public/brand/README.md` — 快速选择与使用限制需补 badge 用法。
- `docs/specs/ui/multimix-logo-identity.md` — 第 2.1 节（新增 badge 为补充版）、第 3 节结构、第 4 节交付清单、第 5 节使用规则、第 6 节风险。
- `lib/brand-showcase.ts:4` — `BRAND_SHOWCASE_LOGO_URL` 指向横版白色 PNG，本次不改指向（产品内导出继续用横版）。

## 具体改法

### 1. E：纯图标居中修正

在 `mark()` 外层对纯图标套一次仅用于构图的变换，形状、比例、颜色、`stroke-width`、`data-part` 全部不变：

- 目标安全区 26px（长边占 140/192 ≈ 72.9%）。
- 实测长边 172px → `scale = 140/172 = 0.8140`。
- 居中位移：`translate(11.35, 20.86)`，由 `96 - 0.814 × 104` 与 `96 - 0.814 × 92.31` 得出。
- 仅作用于 `iconSvg()`；`horizontalSvg()` 的 mark 与 wordmark 相对关系不动，避免破坏已发布横版比例。

### 2. H：实心角标补充版

新增 4 个文件，命名按**底板颜色**：

- `multimix-logo-badge-black.svg` / `.png` — `#151515` 圆角底板 + 反白 mark。
- `multimix-logo-badge-white.svg` / `.png` — `#FFFFFF` 底板 + `#151515` mark。
- 底板：192×192 内 `x/y=16`、`160×160`、`rx=38`。
- 内部 mark 复用居中变换后再 `scale(0.62)`，mark 约占底板 54%。
  - 实施偏离说明：原计划 `0.52`，实测 24px 复杂画面下 mark 偏小，提高到 `0.62` 后可辨度明显改善，底板圆角仍无裁切。
- PNG 输出 1024×1024，底板不透明、底板外透明。

### 3. zip 纳入生成

在生成脚本末尾按 manifest `files` 重新打包 `multimix-brand-kit.zip`（Node 内置 zlib 手写 store/deflate 条目，不新增依赖），使新增 badge 资产进入品牌包。

### 4. 文档与测试同步

- manifest `files` 增 4 项；`version` 保持 `multimix-brand-showcase:v1`（资产新增不改契约语义）。
- 测试：forward-arrow 断言改为校验 `data-part="forward-arrow"` 与 `stroke-width="12"` 仍存在且 `d` 未变，另加「纯图标四边安全区 ≥ 24px 且重心偏移 ≤ 1px」的 alpha 扫描断言，使缺陷不可回归。
- badge PNG 加入尺寸表（1024×1024）；badge 底板中心像素断言为不透明。
- 规范与 README 写明：badge 是补充版，仅用于 ≤48px 场景与复杂画面角标；主标仍为线性版；禁止把 badge 当默认主标。

## 风险与取舍

- H 与现行规范第 3 节「不封闭成徽章」冲突，依据是用户 2026-10-11 当次「E+H」确认；按补充版收口，不替换主标，冲突范围限定在新增版本。
- 居中变换改变已发布纯图标的视觉尺寸（mark 占比由 ~90% 降到 ~73%）。已用旧图标的外部物料不会自动更新，但旧物料仍可用，不构成破坏。
- 横版不动，纯图标变小，两者并排时图标观感略小于旧版；以安全区合规优先。
- zip 改为脚本生成后，手工 zip 的历史内容会被覆盖；manifest 是唯一清单来源，风险可控。
- 不改 favicon、工作台导航、登录页与播放器 UI，不做动态 LOGO 与品牌色系统。

## 验证方式

- `node scripts/generate-multimix-logo-assets.mjs` 重新生成全部资产。
- `node --test scripts/__tests__/multimix-logo-assets.test.mjs`（含新增安全区与 badge 断言）。
- `npm run check:agents`（文档入口与状态头）。
- alpha 扫描复核纯图标与 badge：四边安全区、重心偏移、24/48/96px 可辨。
- 明暗背景与复杂画面预览页目视复核 `multimix-logo-preview.png`。
- 不触碰视频预览播放器链路，无需 `check:video-preview-contract` 之外的视觉契约测试。

## 任务清单

- [x] 1. 生成脚本：纯图标居中变换
- [x] 2. 生成脚本：badge 黑/白 SVG + PNG
- [x] 3. 生成脚本：zip 按 manifest 重建
- [x] 4. manifest 新增 badge 资产
- [x] 5. 测试：安全区/重心断言 + badge 断言
- [x] 6. 规范与 README 同步 badge 定位与使用规则
- [x] 7. 重新生成资产并跑完验证命令

## 验证结果（2026-10-11）

- 纯图标：重心 `(96.06, 96.06)`，四边安全区 `26 / 25.88 / 44.25 / 44.13`（修正前右侧仅 `2px`）。
- badge 黑/白：重心 `(96.00, 96.00)`，四边均 `16px`。
- `node --test scripts/__tests__/multimix-logo-assets.test.mjs`：6/6 通过。
- `npm run check:agents`：agent 入口、`docs:check`、视频预览契约全部通过。
- zip 经 Python `zipfile.testzip()` 校验无损坏，14 个文件与 manifest 一致。
- 24/32/48px 复杂渐变画面目视复核：线性白色版在浅色区 24px 几乎消失，badge 两色均清楚可辨，构成 badge 补充版的证据。
