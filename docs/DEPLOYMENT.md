# MultiMix 部署指南

> Status: current
> Owner: workspace
> Last verified: 2026-07-30

MultiMix 是两个并排的独立仓库：

- **前端**：`MultiMix-Frontend`（Next.js 15，本仓库），部署到 **Vercel**。
- **后端**：`MultiMix-Backend`（FastAPI，以 ChangeIn 为基座并入视频编排），独立仓库，部署到 **Railway**。
- **剪辑器**：完整 OpenCut 引擎代码仍保留在 `/editor`，供后续完整剪辑模式使用；当前默认产品流程使用工作台内的浏览/轻编辑能力，不把完整编辑器作为主入口。

## 运行配置

视频、素材和对话主链始终启用。`CHANGEIN_VIDEO_ORCHESTRATION_INLINE` 只决定本地进程还是独立 worker 执行已经确认的视频工程任务；它不会切换产品功能或旧流程。生产必须设为 `false` 并使用独立 worker。

## 后端部署到 Railway

后端仓库有两个 Dockerfile：

- `Dockerfile` —— 全功能（含 Playwright/cloakbrowser/ffmpeg）。
- `Dockerfile.lean` —— 精简（只知识库 + 视频编排），构建更快。`railway.json` 默认用它。

步骤：

1. 在后端仓库 GitHub Actions 手动运行 `Publish backend image`，从 `main` 用 `Dockerfile.lean` 构建一次并发布私有 GHCR 镜像。记录运行摘要中的完整 `ghcr.io/...@sha256:<digest>`；生产禁止使用可漂移 tag。
2. Railway 的 API 与 video worker 必须都指向上述完全相同的 digest。私有 GHCR 拉取需在 Railway 配置只读 registry 凭据，并使用支持私有外部镜像的 Railway 套餐；条件不满足时不得切断当前正常运行的源码部署。
   API 服务必须在 Railway 服务设置中显式配置启动命令：
   `python -c "import os; os.execvp('python', ['python', '-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', os.environ.get('PORT', '8000')])"`。
   `railway.json` 不保存启动命令，因为同仓的 API 与 video worker 需要使用不同命令，config-as-code 会覆盖服务级设置。
3. 加 Railway Postgres 插件 → 自动注入 `DATABASE_URL`（后端读 `POSTGRES_URL`/`CHANGEIN_DATABASE_URL`）。
4. 配环境变量：
   ```
   CHANGEIN_ENV=production
   CHANGEIN_SECRET_KEY=<32+ 随机字符串>
   CHANGEIN_WEB_BASE_URL=https://<你的 vercel 域名>
   CHANGEIN_DATABASE_URL=<Railway Postgres 连接串>   # 或留空让它读 POSTGRES_URL
   # LLM（任选）
   CHANGEIN_DEEPSEEK_API_KEY=<key>
   # 或 CHANGEIN_LLM_BASE_URL / CHANGEIN_LLM_API_KEY / CHANGEIN_LLM_MODEL
   # 统一公共素材搜索（生产至少配置一个经合规策略允许自动采用的来源）
   CHANGEIN_PEXELS_API_KEY=<key>
   CHANGEIN_PIXABAY_API_KEY=<key>
   CHANGEIN_MATERIAL_SEARCH_PROVIDER_NAMES=pexels,pixabay_video
   # 云 TTS（可选，不配则用估算时长）
   CHANGEIN_TTS_PROVIDER=openai
   CHANGEIN_TTS_API_KEY=<key>
   CHANGEIN_TTS_BASE_URL=https://api.openai.com/v1
   # Redis（API/worker 共用队列、搜索缓存、分页 seen-set 与限流）
   CHANGEIN_REDIS_URL=<Railway Redis 连接串>
   # 对象存储（生产必填；S3 或 Supabase Storage 二选一，禁止容器本地 artifacts）
   CHANGEIN_S3_ENDPOINT_URL / CHANGEIN_S3_BUCKET / CHANGEIN_S3_ACCESS_KEY / CHANGEIN_S3_SECRET_KEY
   ```
5. Railway API 服务的 healthcheck 显式配置为 `/healthz`；video worker 不配置 HTTP healthcheck，改用部署终态与 RQ worker 启动日志验证。发布门还必须检查 API 的 `/healthz/db` 和 `/healthz/material-search`。素材搜索 readiness 不调用外部 provider，不消耗配额；生产缺少 Redis、远程 ArtifactStore、自动采用 provider key、LLM 语义验证器或 provider registry 时返回 `503`。
6. API 与 video worker 必须回读到同一镜像 digest。发布前记录两服务原 digest；回滚时两个服务同时改回同一个已验证旧 digest，禁止只回滚一个服务或现场重建旧 commit。

### 视频编排 worker（异步生成）

视频工程任务默认走 RQ 队列，唯一产品路径是“对话中确认编导稿 → 创建视频工程任务”。生产要起一个独立 worker 服务（同镜像，不同启动命令）：

```
CHANGEIN_VIDEO_ORCHESTRATION_INLINE=false
启动命令: python -m app.services.video_studio.worker
```

需要 Railway Redis 插件并配 `CHANGEIN_REDIS_URL`。生产必须使用独立 worker 且 `INLINE=false`；`INLINE=true` 只用于本地开发，不能作为线上省略 worker 的降级方案。

### 视频任务恢复 scheduler（必需）

再部署一个同镜像的常驻 Railway service，用于恢复“数据库已创建、但原始派发丢失”或
worker 中断后的 durable 视频任务：

```
CHANGEIN_VIDEO_ORCHESTRATION_INLINE=false
启动命令: python -m app.worker schedule
```

它与 API、video worker 共用同一个 Postgres、Redis、ArtifactStore 和 image digest。scheduler
只会幂等重派已有 `queued` 任务，worker 仍以原子 `queued -> running` claim 防止重复执行；它
不会新建工程、覆盖用户内容或把失败伪装为成功。发布前确认三项服务均为同一 digest，发布后从
scheduler 日志确认至少完成一轮恢复扫描。

### 素材 provider 发布前 preflight

常规健康检查不能调用上游 API。进入维护窗口前，由有 Railway shell/secret 权限的运维人员显式执行：

```bash
python -m app.material_search_cli preflight --providers pexels,pixabay_video
```

该命令会对每个指定 provider 发起一次最小搜索并消耗配额，校验配置、鉴权结果和候选 schema；失败时进程退出码为 `1`。输出不回显 key 或上游异常 URL。当前 adapter 协议不暴露响应头，命令会如实返回 `quota_observable=false`；剩余配额需同时到 provider 控制台核对。

## 前端部署到 Vercel

1. Vercel 导入 `MultiMix-Frontend` 仓库，root directory 留空（指向仓库根的 Next.js）。
2. Build 命令 `npm run build`，框架自动识别 Next.js。
3. 环境变量：
   ```
   NEXT_PUBLIC_API_BASE_URL=https://<railway 后端域名>
   NEXT_PUBLIC_MULTIMIX_AUTH_MODE=local
   # 接 Supabase Auth 时再加：
   # NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   ```
   **严禁**给 LLM/TTS/服务端 key 加 `NEXT_PUBLIC_` 前缀（会暴露到浏览器）。
4. 后端 CORS 已根据 `CHANGEIN_WEB_BASE_URL` + Vercel 域名正则放行（见 `config.py:allowed_origin_regex`）。
5. 前后端必须在同一个维护窗口切换：新前端只调用 `material-candidates + recompose` 并只提交 `candidate_id`，不能与仍依赖旧素材接口的任一后端版本混用。

## 端到端冒烟（本地）

1. 后端（在 `MultiMix-Backend` 仓库内）：
   ```
   python -m venv .venv && .venv/bin/python -m pip install -e ".[dev]"
   CHANGEIN_ENV=local \
     CHANGEIN_VIDEO_ORCHESTRATION_INLINE=true CHANGEIN_DEEPSEEK_API_KEY=<key> \
     .venv/bin/python -m uvicorn app.main:app --port 8199
   ```
2. 前端：
   ```
   NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8199 npm run dev -- --port 3200
   ```
3. 流程：注册登录 → 资产库上传 PDF/MD → 对话生成图文/文案（引用上传知识）→ 生成并确认编导稿 → 后台创建视频工程 → 视频库/展示区出现工程 → 浏览成片或分镜并执行轻量调整。完整 `/editor` 和浏览器导出只作为保留能力单独验证，不是当前默认验收路径。

> 注意：本地反复重启 `next start` 容易留下僵尸进程占用旧端口、提供过期构建。换端口或 `pkill -f next` + 清 `.next` 再起。

## 已知边界

- 完整编辑器的 MP4 导出走浏览器端 WebCodecs，不依赖服务端 ffmpeg；但完整编辑器当前不是默认产品入口。
- 公共素材在进入工程前必须下载、校验并持久化到远程 ArtifactStore；剪辑器通过后端 `/v1/video/media` 读取持久化引用，不把 provider 原片 URL 作为工程权威地址。
- 知识库语义检索目前是关键词匹配（`asset_conversation.match_assets` + `knowledge_retrieval.match_knowledge_chunks`），向量检索为后续增强。
