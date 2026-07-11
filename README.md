# MultiMix

MultiMix 是一个面向短视频内容生产的对话式工作台。用户可以在同一个对话里提出创作需求、整理资料内容，并把生成出的文案、图片和视频产物沉淀到对应资源库中，方便后续检索、复用和继续生成。

当前仓库是 MultiMix 前端优先版本，使用本地 mock 数据展示完整产品体验；真实后端能力通过 adapter 层逐步接入。

## Demo Material Browser Automation

工作区根目录的 `demo_material_packs/` 支持两层浏览器验收：

```powershell
# 稳定状态回归：一次性 SQLite + 确定性 seed，执行四场景 UI/结构验证
npm run test:e2e:demo

# 真实模型：完整上传、vision/LLM 和生成链路，单场景手动触发
npm run test:e2e:demo:live -- --scenario 04

# 真实模型：全量场景手动触发
npm run test:e2e:demo:live -- --all
```

稳定层不调用模型；真实层不会进入普通测试门禁。两者都使用独立端口和一次性 SQLite，运行器会在创建前打印数据库完整路径，并在 `finally` 中清理本次进程、数据库及 sidecar。结果写入 `test-results/demo-material-packs/<run-id>/`。

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
npm run setup:demo
npm run dev -- --hostname 127.0.0.1 --port 3200
```
 
Open:

- `http://127.0.0.1:3200/`
- `http://127.0.0.1:3200/app/assets?conversation=product-chain&product=digital-human-video`

Local development auto-signs in with `demo@multimix.local`. The runtime user is stored in browser `localStorage` only.

`npm run setup:demo` creates `db/local/multimix.sqlite` from committed schema and mock data. Running it again resets the local database to the same demo workspace.

Optional local environment variables can be copied from `.env.example` into `.env.local`. `LLM_API` is reserved for a local or server-side generation proxy and must not be exposed through a `NEXT_PUBLIC_` variable.

## Data Boundary

- Mock workspace data is committed as source data under `app/assets/`.
- SQLite runtime files are generated under `db/local/` and ignored by git.
- Share demo data through schema, seed scripts, and mock source data instead of committing `.sqlite`, `.db`, or `.sqlite3` files.
- Keep service role keys, Railway tokens, Vercel tokens, and production secrets out of this repository.

## Future Backend Adapter

The current app is frontend-first with local mock data. Real services can be added behind adapters for:

- Supabase Auth
- Railway API
- generation jobs
- storage
- product/version persistence
