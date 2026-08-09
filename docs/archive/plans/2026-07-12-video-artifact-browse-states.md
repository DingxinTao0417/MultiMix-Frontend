# 编导稿与视频工程浏览状态实施计划

> Status: current
> Owner: frontend
> Last verified: 2026-07-12

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Subagent 未经用户明确批准不得启用。步骤使用 checkbox（`- [x]`）跟踪。

**Goal:** 编导稿只显示连续文字；视频工程默认显示顶部视频和下方独立纵向滚动的分镜卡片；点击“编辑”后继续复用现有胶片条编辑器。

**Architecture:** 在资产映射层把 `video_script/director_script_draft` 映射为文字产物，避免进入视频预览分支。保留 `ProductWorkspace` 现有 `browse | edit` 状态机和 `/editor?embed=1` 胶片条编辑器，只收紧浏览态布局与分镜列表滚动边界。`ProductPreview` 继续负责视频预览、分镜点击跳转和换素材入口。

**Tech Stack:** Next.js、React、TypeScript、Vitest、Testing Library、CSS。

## Global Constraints

- 编导稿与视频工程只通过左侧产物卡切换，不增加展示区内部 Tab。
- 编导稿不得显示播放器、进度条、时间轴或分镜卡片。
- 视频工程产物卡默认进入浏览态，不直接进入编辑器。
- 视频工程浏览态使用顶部视频预览和下方单列纵向分镜列表。
- 分镜列表独立纵向滚动；不分页、不折叠、不使用双列或横向胶片条。
- 点击“编辑”复用当前胶片条编辑器，不新建完整多轨编辑器。
- 点击分镜继续驱动顶部播放器或只读工程预览跳转。
- 不改后端数据结构、视频工程 readiness predicate 或素材/MG 权威字段。

---

## 文件边界

- `MultiMix-Frontend/lib/asset-mappers.ts`：决定编导稿映射为文字模式，视频工程映射为视频模式。
- `MultiMix-Frontend/app/assets/components/product-preview.tsx`：分别渲染连续文字稿和视频工程浏览态。
- `MultiMix-Frontend/app/assets/components/product-workspace.tsx`：保留浏览态与胶片条编辑态切换。
- `MultiMix-Frontend/app/assets/components/segment-cards.tsx`：纵向分镜卡片结构和交互。
- `MultiMix-Frontend/app/globals.css`：展示区、视频预览和分镜独立滚动布局。
- `MultiMix-Frontend/app/assets/__tests__/`：映射、浏览态、分镜交互和样式契约。

### Task 1: 让编导稿进入连续文字展示分支

**Files:**
- Modify: `MultiMix-Frontend/lib/asset-mappers.ts:484-590`
- Test: `MultiMix-Frontend/app/assets/__tests__/asset-mappers.test.ts`
- Test: `MultiMix-Frontend/app/assets/__tests__/display-area-cases.test.tsx`

**Interfaces:**
- Consumes: `ContentAsset.content_type`, `metadata.video_workflow_stage`。
- Produces: `contentAssetToProduct(asset).mode === "copy"` for `video_script/director_script_draft`；真实 `video_render` 仍为 `video`。

- [x] **Step 1: 写失败的映射测试**

在 `asset-mappers.test.ts` 增加一个 `video_script` fixture，断言：

```ts
const product = contentAssetToProduct({
  ...baseAsset,
  asset_kind: "copy",
  content_type: "video_script",
  body: "# 编导稿\n\n连续文字正文",
  metadata: { video_workflow_stage: "director_script_draft" },
});
expect(product.mode).toBe("copy");
expect(product.markdownBody).toContain("连续文字正文");
expect(product.videoProjectReady).toBe(false);
```

- [x] **Step 2: 运行测试并确认因当前映射为 `video` 而失败**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts`

Expected: FAIL，实际 `mode` 为 `video`。

- [x] **Step 3: 最小修改资产模式映射**

在 `productModeFromAsset` 中把编导稿映射为文字模式，并保留视频工程判断优先级：

```ts
if (asset.content_type === "video_render") return "video";
if (asset.content_type === "video_script" && isDirectorScriptDraft(asset)) return "copy";
```

确保 `markdownBody` 继续取资产正文，不能删除 `video_plan` metadata。

- [x] **Step 4: 增加展示回归案例**

在 `display-area-cases.test.tsx` 断言编导稿只渲染 Markdown：

```ts
expect(screen.getByRole("article")).toHaveTextContent("连续文字正文");
expect(screen.queryByLabelText(/视频工程预览|成片播放/)).not.toBeInTheDocument();
expect(screen.queryByLabelText("分镜摘要")).not.toBeInTheDocument();
```

- [x] **Step 5: 运行映射与展示测试**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/asset-mappers.test.ts app/assets/__tests__/display-area-cases.test.tsx`

Expected: PASS。

- [x] **Step 6: 提交 Task 1**

```powershell
git -C MultiMix-Frontend add lib/asset-mappers.ts app/assets/__tests__/asset-mappers.test.ts app/assets/__tests__/display-area-cases.test.tsx
git -C MultiMix-Frontend commit -m "fix: render director scripts as documents"
```

### Task 2: 固定视频工程浏览态与胶片条编辑入口

**Files:**
- Modify: `MultiMix-Frontend/app/assets/components/product-workspace.tsx:98-138,355-424`
- Test: `MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts`

**Interfaces:**
- Consumes: `product.videoProjectReady`, `product.backendAssetId`。
- Produces: `videoSurface: "browse" | "edit"`；产品切换时重置为 `browse`；“编辑”进入现有 `/editor?...&embed=1`。

- [x] **Step 1: 写浏览/编辑状态失败测试**

在 `video-browse-contract.test.ts` 增加契约断言：

```ts
expect(workspace).toContain('useState<"browse" | "edit">("browse")');
expect(workspace).toContain('onClick={() => setVideoSurface("edit")}');
expect(workspace).toContain('setVideoSurface("browse")');
expect(workspace).toContain('src={`/editor?asset=${encodeURIComponent(String(product.backendAssetId))}&embed=1');
expect(workspace).not.toContain("video-track");
expect(workspace).not.toContain("audio-track");
```

同时断言浏览态的头部操作只显示现有“编辑”，不新增跳往独立编辑页的链接。

- [x] **Step 2: 运行测试验证缺失的约束会失败**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/video-browse-contract.test.ts`

Expected: 至少一项新增契约 FAIL。

- [x] **Step 3: 收紧 `ProductWorkspace` 状态切换**

保留并明确以下行为：

```ts
const [videoSurface, setVideoSurface] = useState<"browse" | "edit">("browse");

useEffect(() => {
  setVideoSurface("browse");
  setEditSegmentId(null);
  setOpenSegmentMaterialPicker(false);
}, [currentAssetId]);
```

浏览态只渲染 `ProductPreview`；“编辑”或“换素材”才设置 `videoSurface="edit"`；“完成编辑”恢复 `browse`。

- [x] **Step 4: 运行视频浏览契约测试**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/video-browse-contract.test.ts`

Expected: PASS。

- [x] **Step 5: 提交 Task 2**

```powershell
git -C MultiMix-Frontend add app/assets/components/product-workspace.tsx app/assets/__tests__/video-browse-contract.test.ts
git -C MultiMix-Frontend commit -m "fix: keep video projects in browse mode by default"
```

### Task 3: 让分镜卡片在浏览态独立纵向滚动

**Files:**
- Modify: `MultiMix-Frontend/app/assets/components/product-preview.tsx:343-426`
- Modify: `MultiMix-Frontend/app/assets/components/segment-cards.tsx:22-105`
- Modify: `MultiMix-Frontend/app/globals.css`
- Test: `MultiMix-Frontend/app/assets/__tests__/segment-cards-contract.test.ts`
- Test: `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`
- Test: `MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts`

**Interfaces:**
- Consumes: `segments`, `activeId`, `onSelect`, `onReplaceMaterial`。
- Produces: 顶部视频区与 `.shadcn-prototype-segment-cards` 两个垂直区域；分镜 `ol` 是唯一滚动容器。

- [x] **Step 1: 写失败的布局契约测试**

在 `product-stage-style-contract.test.ts` 和 `segment-cards-contract.test.ts` 增加：

```ts
expect(css).toMatch(/\.shadcn-prototype-video-browse[^{]*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column/s);
expect(css).toMatch(/\.shadcn-prototype-segment-cards\s*>\s*ol[^{]*\{[^}]*overflow-y:\s*auto/s);
expect(css).toMatch(/\.shadcn-prototype-segment-cards\s*>\s*ol[^{]*\{[^}]*min-height:\s*0/s);
expect(css).toMatch(/\.shadcn-prototype-segment-actions[^{]*\{[^}]*flex-shrink:\s*0/s);
```

并断言组件继续渲染全部 `segments.map(...)`，不存在分页、slice 或“展开更多”。

- [x] **Step 2: 运行测试确认当前滚动边界不满足契约**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/segment-cards-contract.test.ts app/assets/__tests__/product-stage-style-contract.test.ts`

Expected: 新增 CSS 契约 FAIL。

- [x] **Step 3: 最小调整浏览态 DOM 与 CSS**

保持 `ProductPreview` 中视频预览在 `SegmentCards` 之前。CSS 使用：

```css
.shadcn-prototype-video-browse {
  display: flex;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
}

.shadcn-prototype-video-browse > .shadcn-prototype-product-video {
  flex: 0 0 auto;
}

.shadcn-prototype-video-browse > .shadcn-prototype-segment-cards {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
  flex-direction: column;
}

.shadcn-prototype-video-browse > .shadcn-prototype-segment-cards > ol {
  min-height: 0;
  overflow-y: auto;
}

.shadcn-prototype-segment-actions {
  flex-shrink: 0;
}
```

不要给卡片设置随数量缩小的高度；不要增加分页或横向滚动。

- [x] **Step 4: 保持分镜跳转和换素材交互**

确认 `ProductPreview` 仍包含：

```tsx
onSelect={(segment) => {
  setActiveSegmentId(segment.id);
  // MP4 player seek or embedded preview seek/play
}}
onReplaceMaterial={(segment) => onEditSegment?.(segment.id, true)}
```

卡片右侧操作区不能参与主文本压缩，长标题使用现有截断规则。

- [x] **Step 5: 运行浏览态和样式测试**

Run: `npm --prefix MultiMix-Frontend test -- app/assets/__tests__/segment-cards-contract.test.ts app/assets/__tests__/product-stage-style-contract.test.ts app/assets/__tests__/video-browse-contract.test.ts`

Expected: PASS。

- [x] **Step 6: 运行前端完整质量门**

```powershell
npm --prefix MultiMix-Frontend run typecheck
npm --prefix MultiMix-Frontend run lint
npm --prefix MultiMix-Frontend run check:agents
```

Expected: 全部 exit 0；`check:agents` 内含 `docs:check`。

- [x] **Step 7: 提交 Task 3**

```powershell
git -C MultiMix-Frontend add app/assets/components/product-preview.tsx app/assets/components/segment-cards.tsx app/globals.css app/assets/__tests__/segment-cards-contract.test.ts app/assets/__tests__/product-stage-style-contract.test.ts app/assets/__tests__/video-browse-contract.test.ts
git -C MultiMix-Frontend commit -m "fix: keep storyboard cards vertically scrollable"
```

### Task 4: 浏览器验收与计划收尾

**Files:**
- Modify after completion: `docs/plans/active/2026-07-12-video-artifact-browse-states.md`
- Move after all checks pass: `docs/archive/plans/2026-07-12-video-artifact-browse-states.md`

**Interfaces:**
- Consumes: 本计划 Tasks 1–3 的已提交前端行为。
- Produces: 浏览器验收证据和已归档计划。

- [x] **Step 1: 按工作区卫生规则准备 E2E 环境**

执行前告知用户临时 SQLite 的具体路径、用途和清理策略。后端使用未占用端口和一次性数据库；前端使用不占用 3117/3200 的独立端口。不得杀掉现有开发进程。

- [x] **Step 2: 验证编导稿展示案例**

操作：生成或打开 `director_script_draft`，点击编导稿产物卡。

Expected：展示连续 Markdown 正文；无播放器、进度条、分镜卡片；已确认稿不显示“确认后可生成”。

- [x] **Step 3: 验证视频工程浏览案例**

操作：点击 ready 视频工程产物卡。

Expected：顶部显示 MP4 或只读工程预览；下方显示单列纵向分镜卡；不自动进入胶片条编辑器。

- [x] **Step 4: 验证大量分镜滚动案例**

操作：使用超过一屏高度的分镜 fixture，滚动分镜区域。

Expected：只有分镜列表纵向滚动；顶部视频仍位于展示区上方；卡片尺寸不压缩；状态和“换素材”不变成竖排。

- [x] **Step 5: 验证跳转与编辑案例**

操作：点击任意分镜，再点击顶部“编辑”。

Expected：视频跳至分镜起始时间并高亮；“编辑”进入现有嵌入式胶片条编辑器；“完成编辑”返回视频工程浏览态。

- [x] **Step 6: 清理测试环境**

在 `finally` 路径停止本次启动的 uvicorn/Next 进程并删除事先声明的一次性 `.sqlite3` 文件；确认 3117/3200 原有进程未变化。

- [x] **Step 7: 勾选完成项并归档计划**

全部验证通过后，把所有完成项改为 `[x]`，将本文件移动到 `docs/archive/plans/`，运行：

```powershell
npm --prefix MultiMix-Frontend run docs:check
```

Expected: `Docs check passed.`
