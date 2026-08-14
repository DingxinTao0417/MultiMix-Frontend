# 公开素材结果卡片可读性修复实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-08-15

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Subagent execution is not authorized for this task.

**Goal:** 修复公开素材候选卡片的样式误伤和长内容挤压，并用实际页面确认数字证明对话分流正确。

**Architecture:** 保持搜索、候选和保存数据流不变，只在 `LibraryWorkshop` 内为候选主体、内容和保存动作建立明确结构，再由局部 CSS 控制三列等高布局与响应式降列。自动化测试锁定选择器边界，浏览器验收覆盖真实对话和可控的极端卡片数据。

**Tech Stack:** React 19、Next.js 15、TypeScript、CSS、Vitest、Testing Library、Playwright、FastAPI。

## Global Constraints

- 不改公开素材搜索请求、Provider、候选排序、保存接口和详情内容。
- 不优化搜索耗时，不调整候选相关性，不修改监控解释。
- 桌面默认三列；标题最多两行；来源授权单行省略；保存按钮固定底部。
- 图片加载失败时必须显示中性占位，不显示长 `alt` 文本。
- 使用一次性 SQLite 和独立端口完成浏览器验收，结束后清理所有自启进程和临时文件。
- 保留当前工作区其他未提交改动；实施与验收阶段不自动提交、不推送、不部署。

---

## 背景与验收问题

真实流程验收中，公开素材搜索能够返回候选，但结果卡片出现明显布局错误：缩略图、长标题、来源授权信息和“保存”按钮被挤压、换行或重叠，用户难以快速判断候选内容和来源。

本计划同时补做上一阶段“数字证明”修复的浏览器界面复验。该复验只验证前端实际页面是否正确展示后端已通过的对话分流，不扩大数字事实实现范围。

## 根因

- `app/globals.css:5825` 使用 `.shadcn-prototype-public-results article > button` 统一设置紫色操作按钮。结果卡片的主体按钮和“保存”按钮都是 `article` 的直接子按钮，因此整张主体卡也被套用紫色背景、白色文字和操作按钮内边距。
- `app/assets/components/library-workshop.tsx:1154` 的卡片没有为主体、信息区和保存动作建立独立类名，CSS 只能依赖宽泛的层级选择器。
- 当前结果网格在约 920px 弹窗内使用最小 180px 的自动填充，通常形成四列；面对外部来源的长英文标题时，每张卡的有效宽度不足。标题、来源和标签又没有明确截断与高度约束，导致卡片高度和按钮位置失控。

## 已确认设计

采用“结构化三列卡片”方案：

- 桌面弹窗默认三列；窄屏按可用宽度降为两列和一列，不固定四列。
- 缩略图保持 `16:9`，图片加载失败或没有预览时显示中性的素材类型占位，不让图片替代文本参与卡片排版。
- 标题最多两行，超出截断；完整标题保留在可访问名称和详情区域中。
- 来源与授权信息独立成一行，允许单行省略，不与标题或标签混排。
- 列表只展示少量标签并限制为单行；完整标签继续在候选详情中展示。
- “保存”按钮固定在卡片底部，与打开详情的主体按钮分离；卡片主体使用中性背景，只有保存动作使用主色。
- 不改变搜索请求、Provider、候选排序、保存接口或详情内容。

## 涉及文件与关键位置

- `app/assets/components/library-workshop.tsx:1149-1168`
  - 为候选 `article`、信息区、元信息和保存按钮增加明确类名。
  - 对缩略图加载失败提供中性占位状态，避免浏览器直接显示长 `alt` 文本破坏布局。
  - 保持点击主体打开详情、点击保存执行导入的现有行为。
- `app/globals.css:5825-5933`
  - 删除会误伤主体卡的宽泛按钮选择器。
  - 建立三列网格、等高卡片、两行标题、单行元信息、受限标签和底部保存动作。
  - 增加窄屏断点，保证弹窗宽度不足时不横向溢出。
- `app/assets/__tests__/public-material-card-layout.test.tsx`
  - 新增静态契约测试，锁定主体卡与保存按钮的独立类名，禁止恢复 `article > button` 宽泛选择器。
  - 锁定标题截断、三列网格、底部动作和响应式规则。

## TDD 步骤

1. RED：新增布局契约测试，在当前实现下因缺少独立保存类名、仍存在宽泛按钮选择器、网格仍可能四列而失败。
2. GREEN：先拆分主体与保存按钮样式，再补等高三列、文本截断和响应式规则，只写使测试通过的最小实现。
3. 重跑新增测试以及资产工作台、UI 静态契约和性能相关测试。
4. 运行 `typecheck`、`lint`、`docs:check` 与 `git diff --check`。

## 浏览器验收

使用独立前后端端口和一次性 SQLite，不连接开发库或 Supabase：

- 数字证明请求：“做一条30秒家具品牌宣传视频，必须用具体经营数据证明品牌实力，但我还没提供数据”。页面必须只询问可使用的真实数据，不再询问内容形式。
- 普通请求：“做一条提升品牌认知的30秒短视频”。页面必须进入视频参数确认，不询问数字证据。
- 公开素材卡片使用固定测试候选覆盖超长英文标题、长授权信息、多个标签、图片加载失败和正常图片；桌面宽度下为三列，窄屏无横向溢出，保存按钮位置一致。
- 验收完成后停止本会话启动的进程，删除临时 SQLite、WAL/SHM、临时构建目录和截图之外的运行文件。

## 风险与取舍

- 三列会比四列少显示一张候选，但显著提高标题、来源和操作可读性；弹窗仍可纵向滚动。
- 两行标题会隐藏部分长标题，详情中保留完整内容，避免列表因单条外部标题无限增高。
- 图片错误占位只处理展示稳定性，不解决外部图片防盗链或 Provider 可用性；搜索速度和候选相关性不在本轮范围。
- 当前 `library-workshop.tsx`、`globals.css` 及相关文档可能包含其他未提交改动；实施时只修改本计划列出的局部区域，不覆盖其他改动。

## 明确不做

- 不优化公开素材搜索耗时。
- 不调整候选相关性、排序或 Provider 查询。
- 不修改监控解释。
- 不提交、不推送、不部署。

## Implementation Tasks

### Task 1: 锁定卡片结构与 CSS 边界

**Files:**

- Create: `app/assets/__tests__/public-material-card-layout.test.tsx`
- Read: `app/assets/components/library-workshop.tsx:1087-1184`
- Read: `app/globals.css:5789-5933`

**Interfaces:**

- Consumes: `LibraryWorkshop` 现有公开素材 JSX 和 `.shadcn-prototype-public-*` 样式。
- Produces: 静态布局契约，后续实现必须满足独立类名、三列、截断和响应式规则。

- [x] **Step 1: 写失败的布局契约测试**

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public material result card layout", () => {
  it("separates the preview card from the save action", () => {
    const workshop = read("app/assets/components/library-workshop.tsx");
    const css = read("app/globals.css");

    expect(workshop).toContain('className="shadcn-prototype-public-result"');
    expect(workshop).toContain('className="shadcn-prototype-public-save"');
    expect(workshop).toContain('className="shadcn-prototype-public-card-content"');
    expect(css).not.toContain(".shadcn-prototype-public-results article > button");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
  });

  it("constrains long content and provides responsive columns", () => {
    const css = read("app/globals.css");

    expect(css).toContain("-webkit-line-clamp: 2");
    expect(css).toContain("text-overflow: ellipsis");
    expect(css).toContain("grid-template-columns: repeat(2, minmax(0, 1fr));");
    expect(css).toContain("grid-template-columns: minmax(0, 1fr);");
  });

  it("uses a controlled placeholder when an external preview fails", () => {
    const workshop = read("app/assets/components/library-workshop.tsx");

    expect(workshop).toContain("function PublicMaterialThumbnail");
    expect(workshop).toContain("onError={() => setLoadFailed(true)}");
    expect(workshop).toContain('className="shadcn-prototype-public-thumb-placeholder"');
  });
});
```

- [x] **Step 2: 运行测试并确认 RED**

Run: `npm run test -- app/assets/__tests__/public-material-card-layout.test.tsx`

Expected: 3 项因当前缺少独立类名、仍使用 `article > button`、网格为 `auto-fill` 且没有失败占位而失败。

### Task 2: 实现结构化三列卡片

**Files:**

- Modify: `app/assets/components/library-workshop.tsx:128-134, 1143-1168`
- Modify: `app/globals.css:5825-5933`
- Test: `app/assets/__tests__/public-material-card-layout.test.tsx`

**Interfaces:**

- Consumes: `PublicMaterialCandidate`、`publicMediaSource(candidate)`、`publicCandidateTags(candidate)`、`handleImportPublicMaterial(candidate)`。
- Produces: `PublicMaterialThumbnail({ candidate, source })` 以及 `.shadcn-prototype-public-result/card/card-content/meta/tags/save/thumb-placeholder` 样式契约。

- [x] **Step 1: 添加受控缩略图组件**

```tsx
function PublicMaterialThumbnail({ candidate, source }: {
  candidate: PublicMaterialCandidate;
  source: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const canPreview = Boolean(source && candidate.media_type !== "text" && !loadFailed);
  const label = candidate.media_type === "video" ? "视频素材" : candidate.media_type === "image" ? "图片素材" : "文案素材";
  const PlaceholderIcon = candidate.media_type === "video" ? Video : candidate.media_type === "image" ? ImageIcon : FileText;

  return (
    <span className="shadcn-prototype-public-thumb">
      {canPreview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={source} alt="" loading="lazy" onError={() => setLoadFailed(true)} />
      ) : (
        <span className="shadcn-prototype-public-thumb-placeholder">
          <PlaceholderIcon size={22} aria-hidden="true" />
          <small>{label}</small>
        </span>
      )}
    </span>
  );
}
```

- [x] **Step 2: 拆分卡片主体、内容和保存动作**

```tsx
<article className="shadcn-prototype-public-result" key={candidate.id}>
  <button
    type="button"
    className="shadcn-prototype-public-card"
    aria-label={`查看素材：${candidate.title}`}
    onClick={() => setPublicSelected(candidate)}
  >
    <PublicMaterialThumbnail candidate={candidate} source={src} />
    <span className="shadcn-prototype-public-card-content">
      <strong title={candidate.title}>{candidate.title}</strong>
      <small className="shadcn-prototype-public-meta" title={`${candidate.provider} · ${candidate.license_label}`}>
        {candidate.provider} · {candidate.license_label}
      </small>
      <span className="shadcn-prototype-public-tags">
        {tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}
      </span>
    </span>
  </button>
  <button
    type="button"
    className="shadcn-prototype-public-save"
    onClick={() => void handleImportPublicMaterial(candidate)}
  >
    保存
  </button>
</article>
```

搜索按钮增加 `className="shadcn-prototype-public-search-submit"`，不再依赖层级选择器。

- [x] **Step 3: 用局部 CSS 建立三列、等高与截断**

```css
.shadcn-prototype-public-search-submit,
.shadcn-prototype-public-save {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  border-radius: 8px;
  padding: 8px 12px;
  background: #5b45e0;
  color: #ffffff;
  font-weight: 700;
}

.shadcn-prototype-public-results {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.shadcn-prototype-public-result {
  min-width: 0;
  height: 100%;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 10px;
}

.shadcn-prototype-public-card {
  min-width: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
  padding: 0;
}

.shadcn-prototype-public-card-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shadcn-prototype-public-card strong {
  display: -webkit-box;
  min-height: 38px;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.shadcn-prototype-public-meta {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.shadcn-prototype-public-save {
  width: 100%;
}

.shadcn-prototype-public-thumb-placeholder {
  display: grid;
  place-items: center;
  gap: 6px;
  color: #6e6a64;
}

@media (max-width: 760px) {
  .shadcn-prototype-public-results {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 520px) {
  .shadcn-prototype-public-results {
    grid-template-columns: minmax(0, 1fr);
  }
}
```

保留现有缩略图和标签色彩规则；标签容器补 `flex-wrap: nowrap; overflow: hidden; min-height: 24px;`。

- [x] **Step 4: 运行新增测试并确认 GREEN**

Run: `npm run test -- app/assets/__tests__/public-material-card-layout.test.tsx`

Expected: 3 passed。

- [x] **Step 5: 运行前端相关回归**

Run: `npm run test -- app/assets/__tests__/public-material-card-layout.test.tsx app/assets/__tests__/library-workshop-performance.test.tsx app/assets/__tests__/library-workspace-state.test.tsx app/assets/__tests__/agent-ui-copy.test.ts`

Expected: 全部通过，无新增 warning 或错误。

### Task 3: 浏览器复验对话与卡片视觉

**Files:**

- Update execution evidence: `docs/plans/active/2026-08-15-public-material-card-layout.md`
- Temporary only: `.gstack/qa-reports/public-material-card-layout-20260815/*`

**Interfaces:**

- Consumes: 当前真实意图 Provider、前端公开素材弹窗、固定的公开素材响应 fixture。
- Produces: 两条对话结果、桌面与窄屏截图、布局尺寸断言和清理证据。

- [x] **Step 1: 启动隔离环境**

使用后端 `8302`、前端 `3322`，数据库固定为 `MultiMix-Backend/multimix-public-card-e2e-20260815.sqlite3`。显式设置：

```text
MULTIMIX_ENV=local
MULTIMIX_AUTH_PROVIDER=local
MULTIMIX_DATABASE_URL=sqlite:///./multimix-public-card-e2e-20260815.sqlite3
MULTIMIX_DATABASE_SCHEMA_BOOTSTRAP_ENABLED=true
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8302
NEXT_PUBLIC_MULTIMIX_AUTH_MODE=dev-admin
```

- [x] **Step 2: 验收数字证明 UI**

在两个全新对话分别发送：

```text
做一条30秒家具品牌宣传视频，必须用具体经营数据证明品牌实力，但我还没提供数据
做一条提升品牌认知的30秒短视频
```

Expected: 第一条回复包含“你希望使用哪些真实数据”，第二条进入“30 秒”视频参数确认且不包含“真实数据”。

- [x] **Step 3: 验收公开素材卡片**

浏览器拦截 `/v1/assets/public-sources` 和 `/v1/assets/public-search`，返回 6 条固定候选，覆盖超长标题、长授权、5 个标签、正常图片和失败图片。断言：

```text
桌面 1200px：结果网格 3 列；每张卡无水平溢出；保存按钮顶部差值 <= 2px。
窄屏 700px：结果网格 2 列；弹窗与卡片无水平溢出。
失败图片：显示“图片素材”占位，不显示候选标题作为图片替代文本。
```

实际结果（2026-08-15）：

- 两条对话均通过本地真实后端与 DeepSeek Provider 返回。数字证明请求只追问“你希望使用哪些真实数据”；普通请求生成“确认视频参数”卡，保留 30 秒且未追问真实数据。
- 桌面 1200px 为 3 列，6 张卡片水平溢出均为 0，首行保存按钮顶部差值为 0px，弹窗水平溢出为 0。
- 窄屏 700px 为 2 列，卡片和弹窗水平溢出均为 0；500px 为 1 列。
- 失败图片卡片中不存在残留 `img`，且只显示 1 个“图片素材”占位。
- 截图：`.gstack/qa-reports/public-material-card-layout-20260815/public-material-cards-desktop.png`、`.gstack/qa-reports/public-material-card-layout-20260815/public-material-cards-narrow.png`。
- 自动测试：新增布局契约 3 passed；相关前端回归 67 passed。
- `typecheck` 通过；`lint` 为 0 error、8 个已有 warning。

- [x] **Step 4: 运行最终静态验证**

Run:

```text
npm run typecheck
npm run lint
npm run docs:check
git diff --check
```

Expected: typecheck、docs 和 diff check 为 0；lint 为 0 error，仅允许记录已有 warning。

- [x] **Step 5: 清理并记录结果**

停止本轮启动的 Next/uvicorn，删除指定 SQLite/WAL/SHM、临时 Next 构建目录和一次性 runner；保留验收截图。把实际测试数量、截图路径、任何残余风险写入本计划。不创建提交。

清理结果（2026-08-15）：8302/3322 监听数为 0；指定 SQLite/WAL/SHM 文件数为 0；临时 Next 构建目录不存在；一次性 runner 和运行日志已删除。保留两张截图及不含密钥的 `acceptance-evidence.json`。验收阶段未创建提交；后续经用户确认，仅提交本次相关文件到本地 `main`，未推送、未部署。
