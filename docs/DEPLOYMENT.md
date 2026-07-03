# MultiMix 部署指南

MultiMix 是两个并排的独立仓库：

- **前端**：`multimix_frontend`（Next.js 15，本仓库），部署到 **Vercel**。
- **后端**：`multimix_backend`（FastAPI，以 ChangeIn 为基座并入视频编排），独立仓库，部署到 **Railway**。
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

1. Railway 新建服务，指向 `multimix_backend` 仓库根目录，Railway 会读 `railway.json` 用 `Dockerfile.lean`。
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
   # 视频素材源（可选，不配则只出字幕轨）
   CHANGEIN_PEXELS_API_KEY=<key>
   CHANGEIN_PIXABAY_API_KEY=<key>
   # 云 TTS（可选，不配则用估算时长）
   CHANGEIN_TTS_PROVIDER=openai
   CHANGEIN_TTS_API_KEY=<key>
   CHANGEIN_TTS_BASE_URL=https://api.openai.com/v1
   # 对象存储（生成媒体/上传文件；不配走容器本地 artifacts，重启丢失）
   CHANGEIN_S3_ENDPOINT_URL / CHANGEIN_S3_BUCKET / CHANGEIN_S3_ACCESS_KEY / CHANGEIN_S3_SECRET_KEY
   ```
4. healthcheck 路径 `/healthz`（railway.json 已配）。

### 视频编排 worker（异步生成）

`/video/generate` 默认走 RQ 队列。生产要起一个独立 worker 服务（同镜像，不同启动命令）：

```
CHANGEIN_VIDEO_ORCHESTRATION_INLINE=false
启动命令: python -m app.services.video_studio.worker
```

需要 Railway Redis 插件并配 `CHANGEIN_REDIS_URL`。若不想跑 worker，把 INLINE 设 `true`，generate 在请求内同步执行（注意 Railway 请求超时）。

## 前端部署到 Vercel

1. Vercel 导入 `multimix_frontend` 仓库，root directory 留空（指向仓库根的 Next.js）。
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

## 端到端冒烟（本地）

1. 后端（在 `multimix_backend` 仓库内）：
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
- 视频生成的素材来自 Pexels/Pixabay 远程 URL（剪辑器直接 fetch）或后端 artifact 代理（`/v1/video/media`）。
- 监控/采集模块（ChangeIn 原功能）默认关闭；要启用需用全功能 Dockerfile + Redis + 各 worker + Reader 服务，见 ChangeIn 原文档。
- 知识库语义检索目前是关键词匹配（`asset_conversation.match_assets` + `knowledge_retrieval.match_knowledge_chunks`），向量检索为后续增强。
