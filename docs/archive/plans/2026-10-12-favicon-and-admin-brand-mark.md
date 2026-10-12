# Favicon 与管理后台品牌标记

> Status: archived
> Owner: frontend
> Last verified: 2026-10-12

## 背景与根因

- 2026-10-12 工作台、登录页、重置密码页、条款页已统一为黑白 badge（品牌规范 §8.1），但站点没有任何 favicon：生产 `/favicon.ico` 返回 404，浏览器标签页和书签显示默认图标。
- 品牌规范 §10 曾把 favicon 列为范围外；用户 2026-10-12 要求“都补上”，该排除项撤销。
- 管理后台 `app/admin/product-metrics/product-metrics-client.tsx` 的两处品牌位（访问受限卡片、页面头部）只有文字 `MultiMix`，未使用共享 badge。

## 涉及文件与改法

- `app/icon.svg`：Next App Router 文件约定，自动输出 `<link rel="icon" type="image/svg+xml">`。内容取自 `public/brand/multimix-logo-badge-black.svg`，viewBox 裁到底板 `16 16 160 160`，与 `app/components/brand-mark.tsx` 一致。
- `app/favicon.ico`：兼容默认请求 `/favicon.ico` 的浏览器与爬虫；由 `public/brand/multimix-logo-badge-black.png`（1024px）裁到底板区域后生成 16/32/48 三档。
- `app/apple-icon.png`：180×180，iOS 会自行切圆角且不支持透明，故用 `#151515` 满版底、字形比例与 badge 相同。
- `app/admin/product-metrics/product-metrics-client.tsx`：两处 `.brand` 前加 `<BrandMark size={20} />`；`product-metrics.module.css` 的 `.brand` 改 `inline-flex` + `gap`，不加背景或渐变。
- `app/assets/__tests__/agent-ui-copy.test.ts`：品牌契约测试加入 admin 页面；新增 icon 文件契约（svg 含底板与字形、ico/apple-icon 存在且尺寸正确）。
- `docs/specs/ui/multimix-logo-identity.md`：§8.1 补 favicon 与管理后台；§10 删除“不修改 favicon”。

## 风险与取舍

- 不在 `layout.tsx` 手写 `icons` 元数据，避免与文件约定重复输出。
- favicon 用 badge（自带对比底板）而不是线条图标：16px 标签页在明暗两种浏览器主题下都需要可辨，符合规范 §2.4 的 ≤48px 用 badge 规则。
- 不改播放器 UI，不触碰视频预览受保护链路。

## 完成记录（2026-10-12）

- 合入本地 main：`329ebc0`。
- 品牌契约测试 2 项通过；把 `icon.svg` 底板色改成紫色后测试按预期失败（变异检查）。
- `typecheck`、`lint`、vitest 1778/1778、demo-e2e 8/8、脚本测试 296/0、`check:agents` 通过；`next build` 输出 `/favicon.ico`、`/icon.svg`、`/apple-icon.png`，页面头部出现对应 `icon` / `apple-touch-icon` 链接。
- 管理后台需登录后才渲染，静态预渲染 HTML 中不含 badge，由类型检查与契约测试覆盖。

## 验证方式

- L1：`agent-ui-copy` 品牌契约测试（含变异检查）。
- `typecheck`、`lint`、`test:fast`、`build`、`check:agents`。
- `next build` 输出中出现 `/icon.svg`、`/apple-icon.png`、`/favicon.ico` 路由。
