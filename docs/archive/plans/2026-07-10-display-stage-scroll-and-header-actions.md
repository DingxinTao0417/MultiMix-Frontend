# 展示区统一滚动条与顶部按钮实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-10

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**目标：** 不改变展示区容器层级，统一所有产物滚动面的右侧贴边行为，并让顶部操作按钮严格复用当前 Demo 的 30px 胶囊主次样式。

**架构：** 用 `shadcn-prototype-stage-scroll-surface` 标记每条渲染路径唯一的纵向滚动 owner；公共规则将滚动面扩展 24px 到产物区边缘并防止父级裁剪，视频工程浏览态不再叠加普通视频 wrapper。按钮继续使用现有 `primary`、详情 trigger、保存和导出语义，只收敛公共样式，不改事件、显示条件或禁用逻辑。

**技术栈：** Next.js 15、React 19、TypeScript、Vitest、全局 CSS、静态契约测试。

## 全局约束

- [x] 不改变 `ProductWorkspace` / `ProductPreview` 的容器层级、滚动职责和业务事件。
- [x] 所有现有及新增展示区滚动面复用 `shadcn-prototype-stage-scroll-surface`，禁止按产物类型新增贴边 CSS。
- [x] 主操作（复制全文 / 下载 / 编辑 / 完成编辑）为深色实底；详情 / 保存 / 导出为白底描边。
- [x] 顶部按钮固定 30px 高，不保留视频工程 26px 特例。
- [x] 每项生产代码修改先有失败测试，完成后运行定向测试、typecheck、构建和 docs 检查。
- [x] 构建前停止 3200，避免开发/生产进程与 `.next` 并发写入；完成后只恢复 3200，不动 8199 或数据库。
- [x] 未收到提交或推送指令，不创建 Git commit、不推送远程。

---

### 任务 1：建立展示区样式契约测试

**文件：**

- 新增 `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`（Vitest/CI 契约）
- 新增 `MultiMix-Frontend/scripts/check-product-stage-style.mjs`（本地可执行 Node 契约）
- 修改 `MultiMix-Frontend/package.json`（`test:product-stage-style`）

**接口：**

- 消费：`app/globals.css`、`product-preview.tsx`、`product-workspace.tsx` 源码。
- 产出：统一滚动面和 Demo 按钮样式的静态回归契约。

- [x] **步骤 1：写入失败测试**

```ts
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const preview = readFileSync(new URL("../components/product-preview.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/product-workspace.tsx", import.meta.url), "utf8");

describe("product stage style contract", () => {
  test("uses one shared stage scroll surface across copy and video paths", () => {
    expect(preview).toContain("shadcn-prototype-copy-document shadcn-prototype-markdown shadcn-prototype-stage-scroll-surface");
    expect(preview).toContain("shadcn-prototype-video-browse shadcn-prototype-stage-scroll-surface");
    expect(workspace).toContain('product.mode === "video" ? "shadcn-prototype-stage-scroll-surface" : ""');
    expect(css).toMatch(/\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-stage-scroll-surface\s*\{[^}]*margin-right:\s*-24px;[^}]*padding-right:\s*24px;/s);
    expect(css).not.toMatch(/\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-(?:product-preview\.video|copy-document)\s*\{[^}]*margin-right:/s);
  });

  test("matches the demo header action hierarchy", () => {
    expect(css).toMatch(/\.shadcn-prototype-product-actions\s*\{[^}]*gap:\s*7px;/s);
    expect(css).toMatch(/\.shadcn-prototype-product-actions > button\.primary\s*\{[^}]*background:\s*var\(--sp-text\);[^}]*color:\s*#ffffff;/s);
    expect(css).not.toMatch(/video-project-mode[^}]*height:\s*26px/s);
  });
});
```

- [x] **步骤 2：运行测试并确认因统一规则缺失而失败**

运行：`npm --prefix MultiMix-Frontend run test:product-stage-style`

预期：Node 契约在共享滚动类、24px 宽度扩展、唯一滚动 owner、30px 高优先级按钮规则或深色主操作缺失时失败。Vitest 契约保留给正常 CI；本机受限执行环境启动 Vitest worker 时返回 `spawn EPERM`，不作为功能失败。

### 任务 2：统一展示区滚动面

**文件：**

- 修改 `MultiMix-Frontend/app/assets/components/product-preview.tsx`
- 修改 `MultiMix-Frontend/app/assets/components/product-workspace.tsx`
- 修改 `MultiMix-Frontend/app/globals.css`
- 测试 `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`

**接口：**

- 消费：现有文案、普通视频和视频工程浏览态滚动元素。
- 产出：公共类 `shadcn-prototype-stage-scroll-surface` 与唯一贴边 CSS。

- [x] **步骤 1：给实际滚动面增加公共类**

```tsx
<article className="shadcn-prototype-copy-document shadcn-prototype-markdown shadcn-prototype-stage-scroll-surface">

<div className="shadcn-prototype-video-browse shadcn-prototype-stage-scroll-surface" aria-label="成片预览">

const previewClassName = [
  "shadcn-prototype-product-preview",
  product.mode,
  product.mode === "video" ? "shadcn-prototype-stage-scroll-surface" : "",
  getProductRatioClass(product.ratio)
].filter(Boolean).join(" ");
```

- [x] **步骤 2：删除类型专属贴边规则并增加唯一公共规则**

```css
.shadcn-prototype-workspace.conversation-mode .shadcn-prototype-stage-scroll-surface {
  margin-right: -24px;
  padding-right: 24px;
}
```

同时删除 `.shadcn-prototype-product-preview.video` 和 `.shadcn-prototype-copy-document` 下现有的 `margin-right: -24px` 类型专属覆盖。

- [x] **步骤 3：运行滚动契约用例**

运行：`npm --prefix MultiMix-Frontend run test:product-stage-style`

预期：共享滚动面、24px 宽度扩展、父级不裁剪和视频工程无嵌套滚动 owner 的契约通过；按钮用例直到任务 3 完成。

- [x] **步骤 4：验证案例**

- 长文案：正文横向位置不变，滚动条贴展示区最右边。
- 数字人准备方案：即使以文案 fallback 展示，也复用同一滚动面。
- 普通视频与视频工程浏览态：两者滚动条横坐标一致。
- 无溢出内容：不出现多余滚动条或右侧布局跳动。

### 任务 3：对齐 Demo 顶部按钮

**文件：**

- 修改 `MultiMix-Frontend/app/globals.css`
- 测试 `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`

**接口：**

- 消费：现有 `primary` class、详情 summary、保存按钮和导出按钮。
- 产出：30px Demo 胶囊样式和稳定的主次视觉语义。

- [x] **步骤 1：统一按钮组和 ghost 基础样式**

```css
.shadcn-prototype-artifact .shadcn-prototype-product-header .shadcn-prototype-product-actions {
  gap: 7px;
}

.shadcn-prototype-product-actions > button,
.shadcn-prototype-product-detail-trigger,
.shadcn-prototype-open-editor {
  display: inline-flex;
  height: 30px;
  min-height: 30px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 13px;
  border: 1px solid var(--line-strong);
  border-radius: 999px;
  background: #ffffff;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
```

- [x] **步骤 2：恢复 Demo 的深色主操作语义**

```css
.shadcn-prototype-product-actions > button.primary {
  border-color: var(--sp-text);
  background: var(--sp-text);
  color: #ffffff;
}

.shadcn-prototype-product-actions > button.primary:hover {
  background: var(--sp-text);
  color: #ffffff;
}
```

删除“所有顶部按钮强制 ghost”的旧覆盖，并删除视频工程态 26px 按钮规则；保留 hover、disabled 和详情浮层行为。

- [x] **步骤 3：运行完整样式契约测试**

运行：`npm --prefix MultiMix-Frontend run test:product-stage-style`

预期：滚动面和 Demo 按钮契约全部通过。

- [x] **步骤 4：验证案例**

- 文案：详情 ghost、复制全文 primary、保存 ghost。
- 图片：详情 ghost、下载 primary、保存 ghost。
- 视频浏览态：详情 ghost、编辑 primary、保存 ghost。
- 视频编辑态：完成编辑 primary、导出 ghost、保存 ghost。
- pending / failed / disabled：按钮显示与点击逻辑不变，禁用态不产生 hover 位移。

### 任务 4：验证、文档闭环与重启

**文件：**

- 已修改 `docs/specs/ui/agentic-workbench-design.md`
- 更新并归档本计划到 `docs/archive/plans/2026-07-10-display-stage-scroll-and-header-actions.md`

**接口：**

- 消费：任务 1–3 的代码与测试结果。
- 产出：可复现验证记录、归档计划和恢复后的 3200 服务。

- [x] **步骤 1：运行定向与静态检查**

```powershell
npm --prefix MultiMix-Frontend run test:product-stage-style
npm --prefix MultiMix-Frontend run typecheck
npm --prefix MultiMix-Frontend exec eslint -- app/assets/components/product-preview.tsx app/assets/components/product-workspace.tsx app/assets/__tests__/product-stage-style-contract.test.ts
npm --prefix MultiMix-Frontend run docs:check
```

预期：命令退出码均为 0；若全仓已有无关失败，不修改无关代码并在结果中单独说明。

- [x] **步骤 2：停止 3200 并构建**

先用 `netstat -ano | findstr :3200` 取得明确 PID，只停止该前端进程；然后运行 `npm --prefix MultiMix-Frontend run build`，预期退出码 0。

- [x] **步骤 3：恢复并验证 3200**

使用 `next start --hostname 127.0.0.1 --port 3200` 启动当前构建，验证首页为 200、所有 HTML 引用的 Next JS/CSS 资源均为 200，且 8199 进程未被改动。

- [x] **步骤 4：完成计划并归档**

勾选已完成步骤，记录命令结果，把计划移动到 `docs/archive/plans/2026-07-10-display-stage-scroll-and-header-actions.md`，再次运行 `npm --prefix MultiMix-Frontend run docs:check`。
## 实施与验证记录

- [x] TDD RED：初始 Node 契约因文案/视频缺少共享滚动面失败；浏览器验收进一步发现仅有负 margin 不会扩展显式宽度、mock 视频工程会嵌套两个滚动 owner，以及顶部直接按钮被通用 card-header 规则覆盖成 34px。针对三项均先补失败契约再修复。
- [x] TDD GREEN：`npm --prefix MultiMix-Frontend run test:product-stage-style` 通过；Vitest 契约文件保留给 CI，本机 worker 启动受限为 `spawn EPERM`。
- [x] 静态检查：`npm run typecheck` 通过；定向 ESLint 0 error、1 个既有 `product-preview.tsx:159` 的 `<img>` 性能 warning；`git diff --check` 通过（仅 LF/CRLF 提示）。
- [x] 构建：`npm run build` 通过；只有仓库既有的 8 个 `<img>` 性能 warning。
- [x] 浏览器实测（1600×831）：长编导稿 `clientHeight=732 / scrollHeight=1638`、视频工程 `clientHeight=750 / scrollHeight=814`，两者均真实产生纵向溢出，滚动面右边界与产物区右边界差值均为 `0px`，`nestedSurfaceCount=0`。
- [x] 浏览器实测按钮：详情 / 复制全文 / 编辑 / 保存实际计算高度均为 `30px`，组间距 `7px`；复制全文 / 编辑为 `rgb(32,31,30)` 深色实底，详情 / 保存为白底描边；Next 错误覆盖层 0，页面 console error 0。
- [x] 服务恢复：生产构建以 `next start` 监听 `127.0.0.1:3200`（PID 20348），首页 HTTP 200；后端 `127.0.0.1:8199` 保持 PID 48652，`/healthz` 为 `ok`，未触碰数据库。
- [x] 文档：更新 `docs/specs/ui/agentic-workbench-design.md`，记录宽度扩展、父级不裁剪和单一滚动 owner 约束；计划完成后归档。
