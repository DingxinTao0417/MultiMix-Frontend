# MultiMix

MultiMix 是一个面向短视频内容生产的对话式工作台。用户可以在同一个对话里提出创作需求、整理资料内容，并把生成出的文案、图片和视频产物沉淀到对应资源库中，方便后续检索、复用和继续生成。

当前仓库运行时只展示真实后端数据；测试数据仅存在于自动化测试 fixture 中，不参与页面初始化或错误降级。

## Test Tiers

默认快速检查完全离线，不读取真实供应商凭证：

```powershell
npm run test:fast
```

该入口覆盖前端 Vitest、demo 纯函数断言，以及 `scripts/__tests__` 中的全部 runner/安全契约。CI 使用同一入口。

离线浏览器 E2E（如 `test:display-coverage`、`test:e2e:product-positioning`、`test:e2e:admin-product-metrics`）统一清空 Supabase、LLM、视觉、TTS、公共素材与 Modal 凭证，并使用一次性 SQLite/ArtifactStore。运行通过后自动清理 runtime；失败时保留，可用以下命令查看和删除：

```powershell
npm run e2e:runs
npm run e2e:cleanup -- <suite>/<run-id> --confirm
```

工作区根目录的 `demo_material_packs/` 只保留真实模型质量评估，不再提供会固定写入 passed 的 stable 浏览器模式：

```powershell
# 真实模型：完整上传、vision/LLM 和生成链路，单场景手动触发（会消耗额度）
$env:MULTIMIX_ALLOW_PAID_E2E="true"
npm run test:e2e:demo:live -- --scenario 04

# 全量四场景会产生更多调用，只用于明确的质量评估
npm run test:e2e:demo:live -- --all
```

生产视频 E2E 同样要求 `MULTIMIX_ALLOW_PAID_E2E=true`。它涵盖 PDF 独立图片提取、分镜、工程、渲染与导出，不进入默认 CI；帮助命令 `npm run test:e2e:video-pipeline-production -- --help` 不需要付费授权。结果写入 `test-results/`，失败运行只有在本地 SQLite 与远端 checkpoint 都有效时才允许恢复。

## Product Features

### 对话驱动

入口统一为“新建对话”。用户不需要先选择“创作”还是“资料整理”，可以直接输入：

- 创作需求：生成短视频、口播稿、封面图、编导稿、数字人视频等。
- 资料整理：整理产品资料、品牌信息、用户画像、客户要求、风格偏好等。

系统根据对话意图判断下一步：

- 明确要产物时，直接生成文案、图片或视频产物。
- 明确是资料整理时，沉淀到资产库的“对话沉淀”。
- 同时包含资料和产出要求时，先沉淀资料，再生成产物。
- 意图不明确时，先追问用户确认方向。

### 资源库

MultiMix 将来源资料和生成产物分开管理。

资产库按来源分类：

- `上传资料`
- `采集资料`
- `对话沉淀`

资产库不显示用途标签。内容类型、检索关键词、解析状态和索引状态放在详情层或检索层，用于后续搜索和 LLM 检索。

文案库用于保存：

- `选题方案`
- `文案稿`
- `配音稿`
- `编导稿`

图片库用于保存：

- `封面图`
- `素材图`
- `分镜图`

视频库用于保存：

- `混剪视频`
- `数字人视频`
- `MG动画视频`
- `实景拍摄视频`
- `生成视频素材`

### 自动沉淀

生成出的产物会自动进入对应库：

- 文案产物进入文案库。
- 图片产物进入图片库。
- 视频产物进入视频库。

新产物默认是草稿。用户确认、保存或使用后，可以作为已确认版本继续复用。后续修改应保留版本，不直接覆盖旧内容。

### 展示方式

- 对话区展示消息、建议操作和产物卡。
- 右侧展示当前选中的单个产物。
- 产物切换通过对话里的产物卡完成。
- 文案库、图片库和视频库列表只显示一个正式分类。
- 库详情用居中模态弹窗打开；工作台产物详情用顶部「详情」浮层，不挤压主预览区域。
- 数字人视频属于视频类型，详情只展示口播文稿，不展示分镜部分。

完整产品定位、交互规则和资源库分类见 `docs/MULTIMIX_WORKSPACE_DESIGN.md`。

## Local Development

```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 3200
```
 
Open:

- `http://127.0.0.1:3200/`
- `http://127.0.0.1:3200/app/assets`

Local development uses the configured authentication mode. The workspace only displays data returned by `NEXT_PUBLIC_API_BASE_URL`.

Optional local environment variables can be copied from `.env.example` into `.env.local`.

## Data Boundary

- Runtime workspace data comes only from the configured backend.
- Automated tests keep small, purpose-specific fixtures under test directories; production modules must not import them.
- Do not commit `.sqlite`, `.db`, or `.sqlite3` files.
- Keep service role keys, Railway tokens, Vercel tokens, and production secrets out of this repository.

## Backend Adapter

Real services are accessed behind the workspace adapter, including:

- Supabase Auth
- Railway API
- generation jobs
- storage
- product/version persistence
