# MultiMix 部署指南

> Status: current
> Owner: workspace
> Last verified: 2026-07-17

MultiMix 是两个并排的独立仓库：

- **前端**：`MultiMix-Frontend`（Next.js 15，本仓库），部署到 **Vercel**。
- **后端**：`MultiMix-Backend`（FastAPI，以 ChangeIn 为基座并入视频编排），独立仓库，部署到 **Railway**。
- **剪辑器**：video-studio 的 OpenCut 引擎，作为 `/editor` 路由嵌在前端里（浏览器端 WebCodecs 导出，无需服务端渲染）。

## 模块开关

后端用 feature flag 控制启用哪些模块（后端仓库 `app/config.py`）：

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `CHANGEIN_MODULES_MONITORING_ENABLED` | `true` | 信息采集/监控（Watch/Collection/Reader，需 Playwright）。MultiMix 部署可设 `false`。 |
| `CHANGEIN_MODULES_VIDEO_ORCHESTRATION_ENABLED` | `true` | 视频编排模块（`/v1/video/*`）。 |
| `CHANGEIN_VIDEO_ORCHESTRATION_INLINE` | `false` | `true` 时 `/video/generate` 在请求内同步执行（本地/无 worker 时用）；生产配 worker 后设 `false`。 |

## 后端部署到 Railway

后端仓库有两个 Dockerfile：

- `Dockerfile` —— 全功能（含 Playwright/cloakbrowser/ffmpeg），监控模块需要。
- `Dockerfile.lean` —— 精简（只知识库 + 视频编排），构建更快。`railway.json` 默认用它。

步骤：

1. Railway 新建服务，指向 `MultiMix-Backend` 仓库根目录，Railway 会读 `railway.json` 用 `Dockerfile.lean`。
   API 服务必须在 Railway 服务设置中显式配置启动命令：
   `python -c "import os; os.execvp('python', ['python', '-m', 'uvicorn', 'app.main:app', '--host', '0.0.0.0', '--port', os.environ.get('PORT', '8000')])"`。
   `railway.json` 不保存启动命令，因为同仓的 API 与 video worker 需要使用不同命令，config-as-code 会覆盖服务级设置。
2. 加 Railway Postgres 插件 → 自动注入 `DATABASE_URL`（后端读 `POSTGRES_URL`/`CHANGEIN_DATABASE_URL`）。
3. 配环境变量：
   ```
   CHANGEIN_ENV=production
   CHANGEIN_SECRET_KEY=<32+ 随机字符串>
   CHANGEIN_WEB_BASE_URL=https://<你的 vercel 域名>
   CHANGEIN_MODULES_MONITORING_ENABLED=false
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
4. Railway 常规 healthcheck 使用 `/healthz`（`railway.json` 已配）；发布门还必须检查 `/healthz/db` 和 `/healthz/material-search`。素材搜索 readiness 不调用外部 provider，不消耗配额；生产缺少 Redis、远程 ArtifactStore、自动采用 provider key、LLM 语义验证器或 provider registry 时返回 `503`。
5. API 与 video worker 必须从同一 commit 构建同一镜像 digest，不能分别从不同分支或不同构建产物发布。

### 视频编排 worker（异步生成）

`/video/generate` 默认走 RQ 队列。生产要起一个独立 worker 服务（同镜像，不同启动命令）：

```
CHANGEIN_VIDEO_ORCHESTRATION_INLINE=false
启动命令: python -m app.services.video_studio.worker
```

需要 Railway Redis 插件并配 `CHANGEIN_REDIS_URL`。生产必须使用独立 worker 且 `INLINE=false`；`INLINE=true` 只用于本地开发，不能作为线上省略 worker 的降级方案。

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
   python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt
   CHANGEIN_ENV=local CHANGEIN_MODULES_MONITORING_ENABLED=false \
     CHANGEIN_VIDEO_ORCHESTRATION_INLINE=true CHANGEIN_DEEPSEEK_API_KEY=<key> \
     .venv/bin/python -m uvicorn app.main:app --port 8199
   ```
2. 前端：
   ```
   NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8199 npm run dev -- --port 3200
   ```
3. 流程：注册登录 → 资产库上传 PDF/MD → 对话生成图文/文案（引用上传知识）→ `/v1/video/generate` 生成视频项目 → 视频库出现该项目 → 点「打开剪辑器」→ `/editor` 拖拽编辑 → 浏览器导出 MP4。

> 注意：本地反复重启 `next start` 容易留下僵尸进程占用旧端口、提供过期构建。换端口或 `pkill -f next` + 清 `.next` 再起。

## 已知边界

- 真正的 MP4 出片走**浏览器端 WebCodecs 导出**（剪辑器内「导出视频」），不依赖服务端 ffmpeg。
- 公共素材在进入工程前必须下载、校验并持久化到远程 ArtifactStore；剪辑器通过后端 `/v1/video/media` 读取持久化引用，不把 provider 原片 URL 作为工程权威地址。
- 监控/采集模块（ChangeIn 原功能）默认关闭；要启用需用全功能 Dockerfile + Redis + 各 worker + Reader 服务，见 ChangeIn 原文档。
- 知识库语义检索目前是关键词匹配（`asset_conversation.match_assets` + `knowledge_retrieval.match_knowledge_chunks`），向量检索为后续增强。
