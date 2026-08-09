# MultiMix UI 重设计 · 实施计划

## ⚡ 实施进度（跨 session 接力用，完成一项勾一项）

- [x] **阶段 1 · 全局换肤**：`app/globals.css` 已完成——①`:root` 与 `--sp-*` 双 token 层替换为 V3（含新增 `--ai-grad`/`--sp-ai-grad` 渐变族）②全量硬编码色清洗（旧 zinc/slate/蓝/绿 → V3 调色板，约 60 种映射）③V3 签名手法：输入坞渐变描边+紫 focus、发送键渐变圆、确认芯片渐变、产物卡 active 渐变环、context-strip 活徽章（渐变呼吸点）、打字点渐变、视频进度完成节点渐变、重试按钮渐变、起始页 aurora+34px 标题、侧边栏选中态 accent-soft、拖拽提示紫虚线、文件末尾 prefers-reduced-motion 降级。花括号 769/769 配平。
- [x] **阶段 2 · 状态上卡片**：`library-workshop.tsx` 列表行标题旁新增状态胶囊（读现有 `row.statusLabel`）+ `globals.css` 新增 `.shadcn-prototype-library-status`（已解析=渐变点/处理中=琥珀闪烁/失败=红）。
- [x] **验证已补**（2026-07-08）：typecheck ✓ / lint ✓（仅 4 个仓库既有模式的 no-img-element warning）/ test 41/41 ✓ / check:agents ✓。仍欠：dev 起服后对照 `docs/specs/ui/prototypes/current/index.html` 截图比对（视觉走查，未阻塞提交）。
- [x] **已提交**（2026-07-08，main 领先 origin/main 2 个提交，未 push）：`33179ec` 换肤+库列表状态胶囊/被引用次数（globals.css + library-workshop.tsx）；`18d0e91` 阶段 2 数据层+SourceRefBlock/SegmentCards（8 文件）。⚠️ 工作区仍留有**与重设计无关的更早未提交改动**（editor-engine/vendor 时间轴系列、app/editor、suggestion-actions 模块+测试、conversation-*/assets-workspace-client/product-workspace、agent-ui-copy.test.ts、docs/API.md、MULTIMIX_WORKSPACE_DESIGN.md、CLAUDE/AGENTS.md），全树检查为绿但归属未确认，待用户决定是否分主题提交。
- [x] 阶段 2 剩余（代码已写完并全部落盘，2026-07-08 第二个 session）：来源引用块 `source-ref-block.tsx` + 分镜卡 `segment-cards.tsx`（新纯展示组件）；`asset-workspace-types.ts` 新增 `AssetProductSourceSummary`/`AssetProductSegment`/行级 `referenceCount`；`asset-mappers.ts` 新增 `segmentsFromVideoMetadata`（video_project.segments→video_segments→video_plan.scenes 优先级，asset_reference/mg_decision 权威）与 `sourceSummaryForAsset`（source_mapping + 分镜推导，含素材命中率）；adapter `LibraryRow.referenceCount`（读 `metadata.reference_count`，缺位不渲染）；`product-preview.tsx` 接线（copy 文末来源块 / video 分镜卡+来源块，分镜卡存在时旧「查看分镜详情」折叠退场、数据缺位自动回退）；`library-workshop.tsx` 列表行渲染 `被引用 N 次`；`globals.css` 末尾（reduced-motion 块前）新增 source-block/segment-cards/refcount 样式；mock 数据补 `videoScriptProduct.segments`+两处 `sourceSummary`+图片库行 `statusLabel/referenceCount`；`asset-mappers.test.ts` 新增 3 个用例。db/schema+db-init 无需改（产物整体序列化为 payload_json）。
- [x] **阶段 3 · 新前端组件**（2026-07-08，全部按降级规则实现，统一挂 `NEXT_PUBLIC_MULTIMIX_UI_V3_*` flag，见 `app/assets/lib/ui-flags.ts`，flag 默认 ON、缺数据时组件自身不渲染）：
  - `ConfirmCard`（`confirm-card.tsx`）：消息 `metadata.plan` 存在才渲染两态卡（待确认渐变描边+字段两列+双按钮 / 已确认紧凑摘要+绿戳）；`asset-mappers.ts` 新增 `planFromMetadata`（无 title/fields 返回 undefined，退回建议芯片）；`conversation-studio.tsx` 接线（确认→提交 `confirmUtterance`，调整→填充输入框）；类型层 `AssetMessagePlan`/`AssetPlanField`/`AssetPlanRef`。
  - `AgentRunTimeline`（`agent-run-timeline.tsx`）：消费真实步骤事件（done/run/wait/fail 三态+shimmer）；`asset-mappers.ts` 新增 `videoJobTimelineSteps`（把 render_stage 映射成 ≥3 语义步，满足硬约定①）；`product-workspace.tsx` 在 orchestration-pending 分支接入（flag 关→回退旧 `VIDEO_JOB_STEPS` 步骤条）。
  - `AiBackgroundStatus`（`ai-background-status.tsx`）：侧边栏渐变描边胶囊；`assets-workspace-client.tsx` 用 `backgroundUnderstandingTasks` 从 `chatImageUploads`「processing」态派生，无任务隐藏整卡（真实信号，非假数据）。
  - `AssetPicker`（`asset-picker.tsx`）：受控素材选择器模态（AI 推荐区 + 图片库网格 + 去上传兜底），推荐为空时推荐区隐藏。**当前无调用方**——其触发点（分镜「换素材」）随阶段 5 胶片条落地，组件已就绪待接线。
  - 产物区生成态视觉：`product-workspace.tsx` 在真实 orchestration-pending 时给产物区加 `.generating`（极光呼吸 + 「生成中」活徽章）；打字光标/实时引用亮框依赖流式，`UI_V3_STREAMING_ENABLED` 默认 OFF（硬约定③ backlog），无流式时仅 shimmer+一次性出全文。
  - 文案失败态卡 + 图片产物形态：`product-preview.tsx` copy/image 分支失败态复用 `.shadcn-prototype-video-failed` 样式卡（`isFailedProduct` 读真实 status，回对话调整为恢复路径）；image 分支改为 hero 图卡+caption+来源块（`.shadcn-prototype-image-card`）。
  - mock：`market-rule` 对话补 confirmed 态 plan；新增 `failedCopyProduct` 挂到 `failed-generation` 对话演示文案失败卡。
  - 验证：typecheck ✓ / lint ✓（仅既有 no-img-element warning）/ test 46/46 ✓（新增 5 例：timeline 三态 + plan 解析/空 plan 回退）/ check:agents ✓ / build ✓。
- [x] **阶段 4 · item 1（生成步骤事件 `steps[]`）**（2026-07-08 第三个 session）：后端 `VideoJobRead` 新增 `steps: [{key,label,status,elapsed_seconds}]`（≥3 语义步 理解/规划/生成，满足 §12 硬约定①），由 `_video_job_steps()` 从 `render_stage` + 真实阶段时间戳派生——`jobs.py` 的 `_progress`/首末提交把每个 stage 首次进入时刻写进 `result_payload["step_marks"]`（无迁移，复用 JSON 列），elapsed 全部来自真实 timestamp，禁止假进度（§2.5）。前端：adapter `mapVideoJob` 统一解析 `steps`（旧后端缺字段→空数组自动降级）、`VideoJobResult`/`VideoJobStepResult`/`VideoJobLiveStatus` 补 `steps`、poller + retry 透传；`asset-mappers` 新增 `agentTimelineStepsFromBackend`（含 `8秒`/`1分12秒` 文案化 elapsed）；`product-workspace` 优先渲染后端真实步，缺位回退 `videoJobTimelineSteps(render_stage)`（§12 降级）。测试：后端 +4 例（running/completed/failed/queued 的 status+elapsed 派生）137 passed；前端 +3 例（backend steps 映射/分钟级+脏数据过滤/空数组降级）49 passed。验证全绿：后端 ruff ✓ / pytest 137 ✓；前端 typecheck ✓ / lint ✓（仅既有 no-img-element warning）/ test 49 ✓ / check:agents ✓ / build ✓。**未提交**（等用户确认；后端另有与本任务无关的既存未提交改动 asset_understanding/vision_service_client，未触碰）。
- [x] **阶段 4 · item 2（结构化确认卡 plan 对象）**（2026-07-08 第三个 session）：后端新增 `video_plan_to_confirm_card()`（`video_agent_planner.py`，紧邻 `summarize_video_plan_mg`），把 `video_plan` 塑形成前端 §5.2 契约 `{title,status,subtitle,fields:[{key,label,value,refs}],summary_fields,confirm_label,adjust_label,confirm_utterance}`——字段面向商家（视频形式=竖屏 9:16·风格 / 时长·分镜数 / 素材命中+缺口 / MG 动画 / 结尾引导），素材 refs 只列 `asset_reference.status=="matched"` 的已保存素材去重（stock 兜底不当「你的素材」，遵守根 AGENTS.md 权威约定），无 scenes→返回 None 触发 §12 建议芯片降级。`assets.py` 在编导稿草稿(`video_workflow_stage=="director_script_draft"`)的 assistant 消息 `metadata_json["plan"]` 挂载(消息 schema `metadata_json`→`metadata` 序列化,前端 `planFromMetadata(message.metadata.plan)` 直接消费,**前端零改动**——ConfirmCard/handleConfirmPlan/handleAdjustPlan 阶段 3 已就绪,确认按钮提交 `confirm_utterance="确认，生成视频工程"` 命中后端 `_is_director_script_confirmation`,闭环)。测试:后端 planner +4 例(核心字段/refs 只列 matched/summary_fields 紧凑/无 scenes 返回 None)、asset_conversation e2e +断言(编导稿 assistant 消息带 pending plan)；前端 typecheck ✓ / test 49 ✓(无改动)。后端 ruff:我的新增区零错误(既存 8 个 F401/F541/F402 属未提交的无关改动,未触碰)。**未提交**。
- [x] **阶段 4 · item 3（素材推荐端点，已验证已提交）**（2026-07-08 第三个 session 写码，第四个 session 验证+提交 `922f82b`）：后端 `rank_scene_asset_suggestions()`（`video_agent_planner.py`，复用 `_best_saved_material` 同一套评分：词命中 + 理解层 role/scene-type 契合，只读不改 plan/asset，返回 ranked top-N `{asset_id,title,media_type,preview_url,match_reason,matched_terms,match_confidence}`）；`GET /v1/video/projects/{asset_id}/segments/{segment_id}/asset-suggestions`（`video_orchestration.py`，`_find_plan_scene` 从 `video_plan.scenes`/`video_segments` JSON 按 scene id 定位——无 segments 表，用 `asset_id`+scene id 寻址；查询用户可复用图/视频素材 `asset_kind in (image,video) & original_ref not null & 未归档`；未知 project/segment→404；无素材→`suggestions:[]` 触发 §12 推荐区隐藏）；`app/tests/test_segment_asset_suggestions.py` 2 例（命中排序 + 空库降级）。前端 `AssetPicker` 契约 1:1 对应（`asset_id→id`/`preview_url→thumbnailUrl`/`match_reason→reason`），但**接线随阶段 5 胶片条落地**（现无调用方，先不加悬空 adapter 方法）。⚠️ **验证受阻**：写代码期间 Anthropic 工具分类器故障（Bash 全部 temporarily unavailable），ruff/pytest 未能运行；代码经通读检查但未执行，待分类器恢复后补跑 ruff + pytest 再提交。
- [x] **阶段 4 · item 4（局部重合成，已验证已提交）**（2026-07-08 第三个 session 写码，第四个 session 验证+提交 `922f82b`）：后端 `apply_segment_recompose(video_plan, segment_id, operation, ...)`（`video_agent_planner.py`，纯函数深拷贝 plan 后只patch目标 scene：`replace_material`→`materials`+`asset_reference`；`revoice`→`narration`+`subtitle_focus`（TTS 从 narration 重跑）；`toggle_mg`→`mg_decision.needed`；未知 segment/op→`SegmentRecomposeError`）+ `build_scene_material_for_asset(asset)`（复用 `_best_saved_material` 的 SceneMaterial 构造，把选中素材转成 render 读取的 material dict）；`POST /v1/video/projects/{asset_id}/segments/{segment_id}/recompose`（`video_orchestration.py`，patch plan→重写 `video_segments`→建 VideoRenderJob→复用**同一条已测试的** `_dispatch_job` 整条重编排，即 §12 允许的「退化为整条重编排」降级；AI 不重排，其他分镜手工编辑不受影响）。关键数据流已核实：render 读 `scene.materials→material_candidates`（不是 `asset_reference`），故换素材必须同时 patch materials（已做）。测试 `app/tests/test_segment_recompose.py`（7 单元 patch 用例 + 2 端点用例，端点 mock `_dispatch_job` 保持 hermetic）。⚠️ **同样验证受阻**（Bash 分类器故障），已逐行自审但未执行 ruff/pytest。
- [x] **待验证批次已清零**（2026-07-08 第四个 session）：Bash 恢复后按清单跑 `ruff check --line-length 100 app/`（15 个报错全部核实为既有代码：material_sources F401×8 + story planner v2 F541×6/F402×1 + assets.py `func` F401 在 HEAD 上即存在；本批次新增代码零错误）+ 目标 pytest 全绿（test_video_agent_planner/test_segment_asset_suggestions/test_segment_recompose 43 passed；test_asset_conversation/test_video_orchestration 128 passed）。已分三个主题提交（后端分支 `refactor/unified-material-sources`，未 push）：`349b512` 测试确定性（钉死 suggestion-candidates/story-planner-v2 开关）；`13bcd50` item 2 确认卡（planner 确认卡区 + assets.py 全部 + 两测试）；`922f82b` items 3+4 分镜端点（共享 `_find_plan_scene`，不可再拆）。**仍留在工作区未提交**（无关工作流，归属未确认）：asset_understanding/vision_service_client + test_vision_service_client（vision 理解层）、test_api_workflow/test_intelligence_e2e（采集）、evals/*、test_asset_conversation 的 4457/4492 两处理解态断言（与 asset_understanding 改动配套）。item 1 已提交（`1860bc4` 后端 + 前端）。
- [x] **阶段 4 · item 5（timeline 脏标记，后端完成已提交 `ce329d7`）**（2026-07-08 第四个 session）：`PUT /v1/video/projects/{id}`（手剪唯一落库口，全屏编辑器保存键）置 `metadata.timeline_dirty`；recompose 端点在 dirty 且请求未带 `confirm_overwrite:true` 时返回 409 `{code:"timeline_dirty", message:"…会覆盖你在剪辑器里做的手工剪辑（裁剪/分割）；素材、配音、字卡的修改不受影响…"}`（提示语按 §5.5 区分两层）；编排 worker 成功重建 `video_project` 后清除标记（失败不清，手剪仍在）。对话驱动的三个编排入口均建**新**资产不覆盖旧工程，retry 只出现在失败链路且必经 recompose 确认门，故只守 recompose 一个口。测试 `test_timeline_dirty.py` 4 例（保存置位/未确认 409 且 plan 不动 job 不建/带确认 202/worker 清位）。**前端确认弹窗留待阶段 5**：recompose 目前无前端调用方（AssetPicker/分镜卡接线时一并做，前端捕获 409 code=timeline_dirty → 弹窗 → 带 confirm_overwrite 重发），不做悬空组件。ruff ✓ / 新测试 4 ✓ / 回归 test_segment_recompose+test_video_reliability 24 ✓。
- [x] **阶段 4 · item 6（流式出稿 = backlog，按 §12 硬约定③处置）**：明确**本期不做**，`UI_V3_STREAMING_ENABLED` 保持默认 OFF（阶段 3 已挂 flag，无流式时 shimmer→一次性出全文→静态来源块的降级链路已实现并验证）。按规范 §12 硬约定③：「生成过程即品牌」原则降半档，**需产品知情**——排期建议：随后端 SSE 任务事件通道（阶段 4 item 1 的「传输先轮询后 SSE」后半段）一起立项，不单独排。
- [x] 阶段 5（完成，2026-07-08 第四个 session）：
  - [x] 删 `video-project-workspace.tsx` 死代码（前端 `6ea355a`：组件 636 行 + globals.css 死样式 665 行 + CLAUDE/AGENTS 两处提及，共 -1301 行；`video-project-mode`/`video-project-card` 是现役类保留）。验证全绿：typecheck ✓ / lint ✓（7 个既有 no-img-element warning）/ test 49 ✓ / check:agents ✓ / build ✓。
  - [x] **文档同步**（前端 `4e2edce`）：`MULTIMIX_WORKSPACE_DESIGN.md` 两条旧约定按规范 §10 修订（库列表状态胶囊+被引用次数；库详情=居中模态弹窗，产物详情=顶部浮层）；`docs/API.md` 新增 §12 阶段 4 后端契约（steps[]/plan 确认卡/asset-suggestions/recompose/timeline_dirty 409 流程）；`CLAUDE.md`+`AGENTS.md` 样式章节补 V3 token 与渐变纪律说明。
  - [x] **胶片条**（前端 `cf87a63`，flag `NEXT_PUBLIC_MULTIMIX_UI_V3_FILMSTRIP` 默认 ON，关=旧多轨 Timeline embed）：新 `app/editor/FilmStrip.tsx` + 纯逻辑 `filmstrip-utils.ts`（11 个单测）在 embed 模式替换 `<Timeline />`——单胶片轨按可见时长比例分宽、选中段裁剪把手（钳制 §5.5 的 2–15s，拖完 800ms 防抖 PUT 保存→后端置 `timeline_dirty`，正好闭环 item 5）、分割（播放头在段内用播放头否则取中点）/删除/撤销走引擎命令（`splitElements`/`deleteElements`/`command.undo`）；分镜属性卡三行（画面=换素材→复用 `AssetPicker`，推荐区喂 GET asset-suggestions、库网格喂 GET /v1/assets 过滤 image/video；配音=文本框+重新配音；MG=开关，当前态从 overlay 轨按 segmentId 推导）全部 POST recompose，409 `code=timeline_dirty` → `window.confirm`「会覆盖你的手工剪辑」→ 带 `confirm_overwrite` 重发；recompose 202 后自轮询任务真实状态（5s，无假进度），完成 `location.reload()` 载入重建工程，失败显示错误卡；并 postMessage `multimix-editor-recompose-started` 给父层（product-workspace 已加 case：禁用导出等新 ready）。配乐行按 §12 缺位隐藏（后端无 BGM 端点）；改字卡文案引导回对话（与 demo 一致）。segmentId 缺失的旧工程属性卡自动隐藏（§12）。
  - [x] **编辑器换肤**（前端 `1f98293`）：`app/editor/editor.css` 亮色 `:root`/`.panel` 全套 shadcn token + chrome 硬编码色（42+9 处）从冷灰蓝映射到 V3 暖色板（#FAF9F7 底/#201F1E 墨/#5B45E0 主/#7C5CFF ring），`.dark` 块不动（暗色模式本期范围外），零结构/行为改动。
  - 验证（两项合计）：typecheck ✓ / lint 0 errors（7 既有 warning）/ test 60 ✓（新增 11）/ check:agents ✓ / build ✓。**未做**：dev 起服后与 `docs/specs/ui/prototypes/current/screens/workspace-video.html` 编辑态、`docs/specs/ui/prototypes/current/screens/editor.html` 的截图走查（与阶段 1 同一欠账，不阻塞提交）。

**全部阶段完成，视觉走查已补。** 走查记录（2026-07-08 第五个 session，截图存 `multimix/ui-walkthrough/`，Playwright + 独立 3410 端口 mock 模式实例，未触碰开发者 3200/8199）：①宽度检查 1280/1440/1920 三档在起始页/文案工作台/图片库均无横向溢出（§9 验收 6 ✓）；②七屏对照 demo 基准稿无结构性偏差——确认卡两态/产物卡渐变环/来源块/输入坞/分镜卡/库状态胶囊+被引用次数/编辑器暖底换肤全部到位；③右上角深色圆是 `NEXTJS-PORTAL`（Next dev 指示器），非应用 UI；④走查抓到一个规范缺口并已修复：**起始页「素材已就绪」横条（§5.6）此前漏做**，已补 `materials-ready-strip.tsx`（读真实图片库状态，无已解析素材整条隐藏，前端 `e3bb72b`，typecheck/lint/test 60/build 全绿）。剩余遗留：① 前端 main 领先 origin/main 多个提交未 push、后端在 `refactor/unified-material-sources` 分支未合并未 push，是否推送由用户决定；② item 6 流式出稿在 backlog（§12 硬约定③已知会，验收 §9 第 2 条以降级形态通过：极光/shimmer 有，打字光标+实时引用亮框待流式）；③ 成片属性行 BGM 依赖后端能力，按 §12 隐藏。

新 session 开场提示词建议：「读 docs/superpowers/specs 与 plans 下的 2026-07-08 两份文档，按实施进度清单继续，从未勾选的第一项开始。」

- 日期：2026-07-08
- 依据：`docs/superpowers/specs/2026-07-08-multimix-ui-redesign-agentic-workbench-design.md`（设计定稿）
- 交互基准：`docs/specs/ui/prototypes/current/`（七屏可点击原型，像素与行为以此为准）
- 原则：**换肤不减功能**（规范 §11）、**数据不在就不渲染**（规范 §12）、adapter 是唯一后端边界（不因后端形态改 UI）

## 总览：五个阶段，前两个零后端依赖

| 阶段 | 内容 | 后端依赖 | 可独立发布 |
|---|---|---|---|
| 1 | 全局换肤（token + 组件样式重写） | 无 | ✅ 整体可回滚 |
| 2 | 数据补字段（分镜卡/来源块/状态上卡片） | 仅扩展返回 metadata | ✅ |
| 3 | 新前端组件（确认卡/时间线/胶囊/选择器） | 消费阶段 4 接口，缺位自动降级 | ✅ 按 flag |
| 4 | 后端能力（事件/结构化 plan/推荐/局部重合成） | 新增端点与事件 | 按 flag 灰度 |
| 5 | 胶片条（OpenCut embed 呈现层）+ 编辑器换肤 | 无新接口（引擎内操作） | 按 flag |

每阶段完成后必跑：`npm run typecheck && npm run lint && npm run test && npm run check:agents`；涉及构建面时加 `npm run build`；后端改动跑对应 pytest + ruff。UI 关键路径与 demo 基准稿截图对比。

---

## 阶段 1 · 全局换肤（纯前端，无逻辑改动）

**改动文件**
- `app/globals.css`：`:root` 替换为规范 §3 token（新增 `--ai-a/--ai-b/--ai-grad/--ai-soft` 等）；逐组件重写现役 `shadcn-prototype-*` 样式（沿用前缀，不新增顶层前缀）；`multimix-auth-*` 登录壳按 demo `login.html` 换肤；文件末尾追加 `prefers-reduced-motion` 全局降级
- `app/assets/components/*.tsx`：仅 markup 级调整——产物区操作按钮移至 header（决策 3）、按钮/徽章/芯片 class 对齐、空态文案
- 覆盖组件清单（对照 demo）：侧边栏（含折叠 rail/Home/⋯菜单/登出）、顶栏（面包屑+诊断）、拖拽分栏手柄、对话气泡/建议芯片/输入坞（双附件+托盘+停止键+拖拽覆盖层样式）、产物卡、详情浮层、四库（网格卡/状态胶囊/筛选芯片/模态详情）、视频进度步骤/失败卡、素材源管理页

**明确不做**：不动 `asset-workspace-adapter.ts`、`lib/api.ts`、任何数据结构；`editor-engine/vendor` 不碰

**验收**：七屏对应页面截图与 demo 基准稿并排对比无结构性偏差；`agent-ui-copy.test.ts` 等现有测试通过（文案变更同步更新测试）；1280–1920 无溢出

## 阶段 2 · 数据补字段（adapter 层扩展，接口不改签名）

**前端**
- `lib/asset-mappers.ts` + `app/assets/lib/asset-workspace-adapter.ts` + `asset-workspace-types.ts`：暴露 `understanding` 状态与被引用次数（列表层，决策 1）、产物 `sourceRefs` 到来源引用块、`video_segments` 摘要（序号/时长/台词/asset_reference 缩略/mg_decision/是否兜底）到分镜卡、素材命中率
- `asset-workspace-mock-data.ts` + `db/schema.sql` + `scripts/db-init.ts`：mock 与本地库补齐上述字段，保证离线模式完整展示
- 新纯展示组件：`SourceRefBlock`、`SegmentCards`（放 `app/assets/components/`，受控无状态）

**后端**：现有 GET 端点返回 metadata 扩展（只加字段不改老字段，旧前端天然兼容）

**验收**：mock 与真实后端两种模式下分镜卡/来源块/状态胶囊渲染一致；`asset-mappers.test.ts` 扩展用例

## 阶段 3 · 新前端组件（全部按降级规则实现）

- `ConfirmCard`：消息 `metadata.plan` 存在才渲染（两态：待确认/已确认）；否则退回现状建议芯片
- `AgentRunTimeline`：消费任务步骤事件；无事件不渲染。视频链路先接 `VIDEO_JOB_STEPS` 既有阶段
- `AiBackgroundStatus`（侧边栏胶囊）：轮询理解任务，无任务隐藏
- `AssetPicker`（素材选择器模态）：推荐区按端点可用性显隐；选择后调用换素材动作
- 产物区生成态视觉（极光/打字光标/实时引用亮框）：以「流式能力探测」开关包裹，无流式时仅 shimmer
- 文案失败态卡（复用视频失败卡样式）
- 图片产物工作台形态（`product-preview` image 分支按 demo 调整 + 多版本恢复已有能力接入详情浮层）

**flag**：新组件统一挂 `NEXT_PUBLIC_MULTIMIX_UI_V3_*` 或后端 `CHANGEIN_*` 开关，关闭 = 现状行为

## 阶段 4 · 后端能力（接口约定）

1. **生成步骤事件**：任务状态接口增加 `steps[]`（`key/label/status/elapsed`），语义化粒度 ≥ 3 步（理解/规划/生成），文案与视频链路统一结构；传输先轮询后 SSE
2. **结构化确认卡**：Agent 输出增加 `plan` 对象（platform/style/heroAsset/structure/refAssets…），走确认门；schema 进 `docs/API.md`
3. **素材推荐端点**：`GET /segments/{id}/asset-suggestions`（复用编排期匹配逻辑，只读）
4. **局部重合成**：`POST /segments/{id}/recompose`（换素材＝更新 `asset_reference` 后重合成该段；改配音＝更新配音稿重 TTS；MG＝更新 `mg_decision` 重渲 overlay）。目标耗时 ≤ 30s
5. **timeline 脏标记**：手剪后置 `timeline_dirty`，Agent 重排分镜前后端返回需确认标志，前端弹「会覆盖你的手工剪辑」
6. **流式出稿**：列 backlog 明确排期（不做则规范 §12 第三条硬约定生效，产品知情）
- 每项遵守根级 `AGENTS.md`：`asset_reference`/`mg_decision` 为权威，stock 只兜底

## 阶段 5 · 胶片条与编辑器换肤

- OpenCut embed（`?embed=1`）呈现层按 demo 胶片条重构：单胶片轨/裁剪把手/分镜属性卡/成片属性行，操作映射引擎既有命令（trim/split/delete/undo）；视觉参考 `docs/specs/ui/prototypes/current/screens/workspace-video.html` 编辑态与 `docs/specs/ui/prototypes/current/screens/editor.html`
- 全屏 `/editor` 主题换肤（token 对齐），功能不动
- 顺手清理：删除零引用的 `video-project-workspace.tsx`（约 650 行死代码，CLAUDE.md 已标注待决策，本方向下历史使命结束）

## 文档同步

- 修订 `docs/MULTIMIX_WORKSPACE_DESIGN.md`：库列表状态标签、详情形态两条旧约定按规范 §10 更新
- `docs/API.md` 增补阶段 4 接口契约；`CLAUDE.md` 样式前缀章节补 V3 token 说明

## 风险清单

| 风险 | 缓解 |
|---|---|
| globals.css 大改引发视觉回归 | 每组件改完立即截图比对 demo；分多次小 commit |
| 步骤事件粒度不足 → 时间线缩水 | 接口约定写死 ≥3 语义步，作为后端验收项 |
| 局部重合成成本超预期 | 降级为整条重编排 + 分钟级 loading 文案（规范 §12） |
| embed 呈现层改造工作量超预期 | 保留现有时间轴 embed 作为槽位兜底，胶片条独立 flag |
| 文案测试与 UI 文案脱节 | 文案改动与 `agent-ui-copy.test.ts` 同 PR 更新 |
