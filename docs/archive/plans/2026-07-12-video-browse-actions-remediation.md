# 视频浏览态操作整改实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-07-12

**Goal:** 修复生成进度点颜色，并让视频工程在浏览态直接导出和更换单个分镜素材。

**Architecture:** 保留 `videoProjectReady` 作为操作可用门槛。把素材候选读取和分镜替换请求收口到前端 adapter，供浏览态 `ProductWorkspace` 与编辑器 `FilmStrip` 共用；编辑器 iframe 始终作为同一个实例存在，浏览态隐藏但可接收导出消息，避免点击导出或换素材时切换到编辑视图。

**Tech Stack:** Next.js 15、React 19、TypeScript、Vitest、Testing Library、现有视频工程与分镜重合成 API。

## Global Constraints

- 不改后端接口，不启动测试服务，不创建数据库。
- `videoProjectReady` 为视频工程操作门槛。
- `asset_reference` 与既有 timeline dirty 覆盖确认门保持权威。
- 浏览态 `换素材` 和 `导出视频` 均不得切换到编辑器。

### Task 1: 状态点与浏览态操作契约

**Files:**

- Modify: `MultiMix-Frontend/app/assets/__tests__/product-stage-style-contract.test.ts`
- Modify: `MultiMix-Frontend/app/assets/__tests__/video-browse-contract.test.ts`
- Modify: `MultiMix-Frontend/app/assets/__tests__/display-area-readiness.test.tsx`

- [x] 增加失败测试：运行、完成、失败状态点自身分别使用黄、绿、红背景。
  - 验证案例：三个 tone selector 都直接命中 `.shadcn-prototype-agent-run-title-dot`。
- [x] 增加失败测试：ready 视频浏览态显示导出按钮，并保持一个隐藏导出桥接 iframe。
  - 验证案例：按钮可见；点击分镜换素材不会调用 `setVideoSurface("edit")`。
- [x] 增加失败测试：浏览态换素材渲染 `AssetPicker`，候选确认后调用当前分镜重合成。
  - 验证案例：点击 `换素材` 后仍能看到 `成片预览`。

### Task 2: 共享素材替换数据边界

**Files:**

- Modify: `MultiMix-Frontend/app/assets/lib/asset-workspace-types.ts`
- Modify: `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`
- Modify: `MultiMix-Frontend/app/editor/FilmStrip.tsx`
- Test: `MultiMix-Frontend/app/assets/__tests__/asset-workspace-adapter.test.ts`

- [x] 增加失败测试：adapter 分别映射 AI 推荐和已保存图片/视频素材。
  - 验证案例：推荐失败时仍返回素材库；归档和不可用素材被过滤。
- [x] 增加失败测试：分镜替换返回真实 job，409 timeline dirty 返回覆盖确认信息。
  - 验证案例：确认覆盖后带 `confirm_overwrite=true` 重发。
- [x] 实现 adapter 方法，并让 `FilmStrip` 复用，删除重复请求映射。

### Task 3: 浏览态素材弹窗与导出桥接

**Files:**

- Modify: `MultiMix-Frontend/app/assets/components/product-preview.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/product-workspace.tsx`
- Modify: `MultiMix-Frontend/app/assets/components/asset-picker.tsx`
- Modify: `MultiMix-Frontend/app/globals.css`

- [x] 实现 `ProductWorkspace` 直接加载并展示当前分镜素材候选。
- [x] 实现确认替换、覆盖确认、任务轮询和当前产物刷新。
- [x] 保持同一个编辑器 iframe；浏览态隐藏，编辑态显示。
- [x] 顶部在 ready 浏览态与编辑态均显示导出按钮，点击不改变 `videoSurface`。
- [x] 为素材弹窗补加载、提交和错误状态，不制造假进度。

### Task 4: 验证与归档

- [x] 运行专项测试并确认 RED -> GREEN。
- [x] 运行 `npm run typecheck`。
- [x] 运行 `npm run lint`。
- [x] 运行 `npm run test`。
- [x] 运行 `npm run test:product-stage-style`。
- [x] 运行 `npm run check:agents`。
- [x] 运行 `npm run build`。
- [x] 运行 `git diff --check`，复核只修改本任务文件与此前已确认的未提交文件。
- [x] 全部勾选后将计划移入 `docs/archive/plans/`。
