# 工作台内嵌剪辑导出新鲜度整改（已完成）

> Status: current
> Owner: frontend
> Last verified: 2026-09-28

## 背景与根因

用户确认修复本轮审查发现的 P1：内嵌时间线修改后，只有成功保存的
`multimix-editor-project-updated` 才使旧导出失效。保存防抖、请求进行中及保存失败期间，
工作台仍可能下载旧缓存或接受修改前启动的导出。独立剪辑器已有实时内容校验，内嵌入口未接入。

## 范围与关键位置（整改前）

- `app/assets/components/product-workspace.tsx:906` 保存状态只更新展示；`:1149` 缓存先于保存检查；`:1850` 导出菜单。
- `app/editor/EditorView.tsx:541` 内嵌导出未传实时 `isCurrent`；`:877` 内容订阅跳过 embed。
- `app/editor/FilmStrip.tsx:191` 发送保存状态；`:206` 成功 PUT 后发 project-updated；已有 flush 协调器复用，不重写保存链路。
- `app/assets/__tests__/product-workspace-video-actions.test.tsx`、`app/editor/__tests__/standalone-export.test.tsx` 增加真实组件回归。
- `docs/API.md` 补充内嵌导出的本地编辑/异步结果契约。
- `e2e/display-area.spec.ts` 增加隔离浏览器的编辑、延迟保存、失败重试、导出竞态验收；不改变截图基线与播放器外观。

## 具体改法

1. 先将只读探针转成正式失败测试：原始/品牌缓存、dirty/saving/error、旧成功/失败/进度回填和保存恢复。
2. 工作台同步记录保存状态，dirty/saving/error 到达即清缓存、可恢复任务、当前导出请求/epoch、报告；屏蔽旧服务端恢复。
   保存中导出入口不可用且说明原因；失败明确提示先重试保存，复用现有完成编辑/重试保存入口。
3. 内嵌导出绑定点击时的实时 tracks/media/settings/metadata 身份与请求 epoch，先复用时间线 flush 再预检/合成；内容发生变化即使旧候选与异步任务失效。
   渲染完成、上传前、轮询及最终回填都检查同一身份；纯播放/选中不触发失效。
   浏览态只读预览器没有 FilmStrip/保存协调器，沿用导出流程自身的工程保存，不要求不存在的 flush；同样核对实时内容身份。
4. 补充契约并完成 L1/L2 离线回归、类型/lint/fast/build 和隔离 Playwright 验证。

## 风险与取舍

- 禁用只是入口反馈；真正保护必须覆盖缓存、异步消息及编辑器上传边界，不能仅隐藏按钮。
- flush 复用既有协调器，避免旧防抖 PUT 晚到覆盖导出前保存；实际修改才能废弃已验证缓存。
- 已登记的服务端任务不能撤销，但旧结果不能被客户端当作当前作品；服务端既有指纹/原子发布检查保持不变。
- 不改后端、数据、供应商、视觉外壳、生成确认门，不提交/推送。
- 浏览器使用独立端口及一次性 SQLite；启动前告知路径，结束清理自建进程与临时库，不连接 Supabase。

## 验证与进度

- [x] 1. 设计/占用与正式失败测试（9 个针对性用例修复前失败）。
- [x] 2. 工作台缓存失效及保存反馈（6 个聚焦用例通过）。
- [x] 3. 内嵌导出实时内容与保存一致性保护（含只读预览器导出、修改后撤销、验证中止与内容未变化通知）。
- [x] 4. 回归、构建、隔离浏览器及文档收口。

验收包括两种导出版本；保存延迟/失败不下载旧视频；旧回调不覆盖状态；修改中合成停止上传；
重试保存后导出新内容；内容未变化时仍可复用；不自动开始第二次导出或付费生成。

## 本地验证结果

- 修复前 9 个聚焦复现用例失败；修复后相关用例及浏览态兼容、修改后撤销等增补回归通过。
- `npm run test:fast`：138 个 Vitest 文件 / 1178 项通过；demo 8 项通过；脚本契约 236 项通过、1 项既有条件跳过。
- `npm run typecheck`、`npm run lint`、`npm run build`、`npm run check:agents`（含 docs/video-preview contract）、`npm run test:product-stage-style`、`git diff --check` 全部通过。
- `npm run test:display-coverage -- --grep='embedded exports reject|loads a real MP4 and seeks' --playwright-workers=1`：展示组件 40 项及隔离 Chromium 2 场景通过（32.5 秒），真实原始版/品牌版 MP4 导出与下载、分镜定位、检查中修改失效、保存失败和手工重试恢复。
- 控制台补测同一专项流程 1 场景通过（15.8 秒）：无 pageerror/框架错误弹层；两次 404 对应 fixture 未提供需求快照，一次 503 为主动注入的保存失败，无额外错误或 warning。
- Playwright 使用 1280×720、1440×900、390×844，截图已人工检查，证据在 `/tmp/multimix-embedded-export-evidence/`。
- 首轮浏览器发现只读预览器没有保存协调器，已补兼容测试并修正；第二轮只失败在错误的 Next devtools portal 判定（健康页面也有 portal），改为检查实际错误弹层后通过。
- 一轮并行 fast 检查被测试 Next 自动生成的临时类型路径干扰，隔离进程收尾并恢复文件后重跑全量 fast 通过；未保留生成文件改动。
- 每轮临时 SQLite/素材及自建进程均已清理，后端无工作区修改。没有访问 Supabase 主库、生产环境或付费生成服务。

## 边界

结论仅覆盖本轮前端导出/保存与隔离真实文件链路；未执行生产发布或真实付费创作全链路。
完成用户要求的本地修复，未提交/推送。
