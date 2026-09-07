# MultiMix 品牌包

> Status: current
> Owner: frontend
> Last verified: 2026-09-08

这套文件用于 MultiMix 产品对外展示、视频角标、图片署名、头像和宣传材料。

## 快速选择

- 浅色背景：使用 `multimix-logo-horizontal-black.*` 或 `multimix-logo-icon-black.*`。
- 深色或复杂背景：优先使用 `multimix-logo-horizontal-white.*` 或 `multimix-logo-icon-white.*`，必要时在合成层加轻微中性阴影。
- 视频与图片角标：优先使用横版白色 PNG，放在右下角。画面短边为 1080 px 时，宽度 160 px，距右侧与底部各 28 px；其他尺寸等比例缩放。
- SVG 是长期主文件；PNG 适合视频、图片和不支持 SVG 的平台。

## 使用限制

- 纯图标不小于 24 px；横版标识不小于 96 px 宽。
- 不拉伸、不旋转、不重绘、不改色，也不要改变图标与 `MultiMix` 标准字的比例。
- 不把阴影、底板或其他效果写回透明 LOGO 主文件。

## 在 MultiMix 中导出

- 图片产物的“下载”菜单提供“下载原图”和“下载品牌展示版”。
- 视频产物的“导出视频”菜单提供“原始成片”和“品牌展示版”。
- 原始版与品牌展示版独立保存；生成品牌版不会覆盖原文件。
- 导出菜单底部的“下载 MultiMix 品牌包”可随时重新下载本压缩包。

完整、权威的品牌规则见仓库内 `docs/specs/ui/multimix-logo-identity.md`。
