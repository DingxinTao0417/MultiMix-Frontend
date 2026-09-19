# 桌面侧边栏资源库宫格实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-17

## 背景与根因

桌面侧边栏的四个资源入口当前使用传统纵向菜单：单色描边图标、逐行文字和分隔线共同形成后台设置页观感，同时占用较多纵向空间。用户已于 2026-09-17 确认采用设计稿 A「柔和宫格」，目标是在不改变导航行为和资源库数据边界的前提下，将四个入口改为更现代、紧凑的 `2 × 2` 快捷卡片。

已确认视觉稿：`/Users/zhangzhishu/.gstack/projects/DingxinTao0417-MultiMix-Frontend/designs/resource-library-entry-20260917/variant-A.png`。

设计稿中的“全部素材”不直接进入实现：当前 `assets` 视图只承载上传资料、采集资料和对话沉淀，不聚合文案、图片、视频产物。正式入口使用 `资产 / 文案 / 图片 / 视频`，避免文案大于真实数据范围。

## 涉及文件与关键位置

- `app/assets/components/assets-workspace-client.tsx:3122-3139`：桌面展开态资源库导航结构和四个入口行为。
- `app/globals.css:463-496`：现有纵向导航、悬停与选中态样式。
- `app/assets/__tests__/sidebar-project-navigation.test.tsx`：侧边栏顺序、资源入口和状态显隐契约。
- `app/assets/__tests__/agent-ui-copy.test.ts`：同步已过时的侧边栏 grid 行结构断言，避免要求恢复旧布局。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md:63-89`：桌面侧边栏和四类资源入口的权威设计说明。
- `docs/specs/ui/prototypes/current/screens/start.html`、`workspace-video.html`：当前桌面侧边栏原型。
- `e2e/display-area.spec.ts`：桌面新建页和工作台截图验收。

## 具体改法

### 任务 1：固化宫格视觉与文案契约

- 在权威设计中明确“资源库”分组标题、`2 × 2` 卡片布局和 `资产 / 文案 / 图片 / 视频` 四个短标签。
- 卡片保持真实按钮语义和可访问名称；选中态不能只靠颜色，继续使用 `active` 状态和文字权重表达。
- 折叠侧边栏仍保留原有四个图标入口，本次只修改桌面展开态。
- 先补定向契约测试，限制旧纵向菜单样式回退，并确认四个 `setActiveView` 行为不变。

### 任务 2：实现 2 × 2 柔和宫格

- 为展开态导航增加可见“资源库”标题，把四个按钮改成两列宫格。
- 卡片使用白色/浅暖灰表面、`1px` 柔和边框、约 `11px` 圆角和独立浅色图标底座。
- `assets / copy / image / video` 分别使用克制的蓝、暖黄、紫、青绿图标色；选中态仅提高边框、背景和文字对比，不使用大面积高饱和色。
- 保留悬停、键盘焦点和现有点击行为；不显示数量，不引入新接口。
- 同步 `start.html` 与 `workspace-video.html` 的展开态侧边栏原型。

### 任务 3：桌面回归与截图验收

- 运行侧边栏定向单测、TypeScript、ESLint、生产构建和文档检查。
- 运行桌面目标 E2E，确认新建页和工作台四个入口均可访问、选中态正确、最近项目区域没有被挤压。
- 在 `1280 × 720` 和 `1440 × 900` 重拍侧边栏，重点检查资源库宫格、账户区和后台任务提示之间无重叠。
- 清理隔离测试进程和一次性 SQLite；本次不修改手机端、不提交、不推送、不部署。

## 风险与取舍

- 两列卡片比单行菜单更宽，但在现有 `264px` 侧边栏内每张卡仍能保留完整短标签；长文案不进入卡片。
- 四种图标色只用于分类识别，不能让资源入口比“新建项目”和当前项目更抢眼，因此背景和边框保持低对比。
- 当后台任务状态条出现时，宫格不能与账户区重叠；以现有 grid 行为为准，不通过绝对定位固定宫格。
- “资产”不改成“全部素材”，因为当前没有跨四库聚合页面；未来若提供统一聚合视图，再单独调整名称和路由。

## 验证方式

```bash
npm test -- --run app/assets/__tests__/sidebar-project-navigation.test.tsx
npm run typecheck
npm run lint
npm run build
npm run docs:check
npm run test:display-coverage -- --e2e-only --grep="desktop start|CASE-04|CASE-05"
```

桌面截图输出继续使用：`artifacts/qa/desktop-ui-ux-remediation-20260917/`。

## 验证记录

- 定向侧边栏测试：`5 / 5` 通过；全量单元测试：`122` 个文件、`990` 个用例通过。
- TypeScript、ESLint、生产构建、文档检查与 `git diff --check` 通过。
- Playwright 桌面用例 `desktop start and image library keep the approved hierarchy` 通过，已验证“资源库”标题、四个入口、两列宫格、图片库选中态及页面跳转。
- 截图已更新：`new-project-1280x720.png`、`new-project-1440x900.png`、`image-library-1280x720.png`、`image-library-1440x900.png`。
- E2E 包装脚本在用例通过后的 Next 临时目录删除阶段遇到一次 `ENOTEMPTY` 竞态；已手动清理明确的 `.next-display-coverage-resource-grid-20260917` 与 `resource-grid-20260917` 一次性运行目录，端口 `8299 / 3219` 均无监听。

## 当前进度

- [x] 任务 1：固化宫格视觉与文案契约
- [x] 任务 2：实现 2 × 2 柔和宫格
- [x] 任务 3：桌面回归与截图验收
