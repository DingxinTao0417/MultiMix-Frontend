# 工作台前端复审整改

> Status: archived
> Owner: frontend
> Last verified: 2026-10-09

## 背景与根因

2026-10-08 只读实测发现：375×667 首次打开待确认编导稿时，确认按钮越过对话滚动区底边（`conversation-studio.tsx:1277`、`globals.css:1869`），点击中部命中输入区；对话切换/详情加载后没有滚动锚定。`lib/api.ts:96,125,152` 只有 JSON 请求通知登录过期，Blob、Form 请求缺失；进度上传的 XHR 同样未通知。`apiForm` 对 502/503/504 自动重试，但 `asset-workspace-adapter.ts:2164` 的单文件上传不传幂等键；后端 `/assets/upload` 已支持 `Idempotency-Key`（`MultiMix-Backend/app/api/assets.py:2574`）。诊断入口按邮箱猜权限（`assets-workspace-client.tsx:1071`），与后端 `is_admin || is_pilot` 不一致。320px 资料操作目标偏小（`globals.css:3664`），新建页能力条隐藏滚动条且缺可发现性提示（`globals.css:1382`）。

生产依赖审计另有 `@tailwindcss/typography@0.5.20` 固定使用 `postcss-selector-parser@6.0.10` 的 moderate 告警；上游当前版本仍固定 6.0.10。此项先验证兼容的定向覆盖升级，不盲降 typography 或改动编辑器排版。

## 范围与具体改法

1. **对话可见性**：`app/assets/components/conversation-studio.tsx` 为对话滚动容器建立 ref；项目切换或详情从加载转为就绪时定位到最新消息；后续消息仅在用户仍靠近底部时跟随，用户向上阅读时不强拉。保留既有确认语义、卡片及输入区布局。先补组件测试，浏览器窄屏验收归入任务 7。
2. **登录过期一致性**：`lib/api.ts` 统一 401 通知与错误状态，覆盖 JSON、Blob、Form；`app/assets/lib/asset-workspace-adapter.ts` 的进度上传 XHR 同步处理 401。补 401 单测，确保普通校验失败不误登出。
3. **上传幂等**：单文件上传每次用户动作创建一个稳定的 `Idempotency-Key`，`apiForm` 同一动作的自动重试复用此键；批量/对话现有 XHR 键保持不变。补 503 后重试与非重试 422 的请求头断言；不改后端或素材理解状态。
4. **诊断权限**：`assets-workspace-client.tsx` 从现有 `GET /auth/me` 的 `is_admin/is_pilot` 决定是否展示，去除邮箱猜测；请求失败默认隐藏，授权用户仍可主动打开诊断，普通页面不发昂贵的 probe。补权限测试。
5. **窄屏可用性**：`app/globals.css` 增大项目资料操作触控目标和间距；新建页能力条增加轻量横向可滚动提示但保持被动说明、不变成筛选器。组件测试先覆盖文案与控件，320/375/390px 布局实测归入任务 7。
6. **依赖告警**：在 `package.json` / `package-lock.json` 上尝试局部覆盖到已修复解析器版本，只在编辑器 CSS 构建与回归通过后保留；若上游 API 不兼容则不以强制覆盖冒险，记录剩余风险与后续升级条件。
7. **验收与清理**：运行相关 Vitest、lint、typecheck、构建、docs:check、依赖审计及隔离浏览器用例；如需独立本地 E2E，使用一次性 SQLite、独立端口，先告知路径并在结束时清理进程、库和测试产物。无生产部署、提交、合并或推送。

## 风险与取舍

- 自动滚动只跟随最新内容且尊重用户手动阅读；不能只给确认卡叠加 z-index 掩盖滚动根因。
- 401 与网络/422 分开处理；上传重试仅在有幂等键时允许，避免“服务端已保存但网关报错”造成重复。
- 角色读取失败时隐藏内部诊断入口，不用邮箱或环境猜权限；权限只影响可见性，不改变后端授权。
- 依赖覆盖是 6.x 到 7.x 的主版本替换，必须通过编辑器排版和 CSS 构建验证；不把 moderate 告警误报成已确认生产可利用漏洞。

## 验证方式

- 组件：切换项目/详情加载定位底部，用户上滚后新消息不跳底，回到底部后恢复跟随；API 三类 401 均触发一次过期事件；上传重试两次使用同一幂等键；非管理员无诊断入口。
- 浏览器：展示用例 `display-case-01-director-draft` 在 320×568、375×667、390×844 首屏可见且可点击确认按钮（不实际提交付费生成）；桌面 1440×900 不回退。资料抽屉与新建页窄屏可读、可操作、无横向溢出。
- 工程：`npm run typecheck`、`npm run lint`、相关 Vitest、`npm run build`、`npm run docs:check`、`npm run security:dependencies`，必要时复跑展示区 E2E。测试产物与临时库清理后确认前后端 git 状态。

## 实施与验收结果（2026-10-09）

- 对话滚动锚定在项目切换、详情加载和底部跟随时生效；手动阅读历史消息不会被强制拉回。320×568、375×667、390×844 首屏确认按钮中心点均位于可点击的对话滚动区内。
- API JSON、Blob、Form 和进度上传 XHR 的 401 均通知登录外壳；资料库单文件上传与 502/503/504 重试共用同一幂等键，无键请求不自动重试。
- 诊断入口读取 `/auth/me` 的 `is_admin` / `is_pilot`，非特权邮箱即使包含 `+admin` 也不展示。
- 窄屏项目资料操作至少 44px 高；新建页能力条提供滑动提示且页面不横向溢出。
- `@tailwindcss/typography` 局部覆盖 `postcss-selector-parser@7.1.6`；`npm ci`、生产构建、编辑器定向测试与 `npm audit --omit=dev` 通过，审计为 0 条。npm 11 重算了锁文件中的可选平台包与 peer/libc 元数据；通过干净安装验证，不另行改业务依赖版本。
- `npm run test:fast`：1476 项 Vitest、8 项 demo Vitest、260 项脚本检查通过（1 项按原条件跳过）；`npm run check:agents`、`npm run test:product-stage-style`、lint、typecheck、build、docs:check 均通过。
- 隔离 `test:display-coverage`：41 项组件测试及 40 项浏览器 E2E 通过，原有重启恢复专项 1 项按脚本条件跳过。展示用例临时 SQLite 和前后端进程均由脚本清理；没有连接开发主库或生产环境。
- 未执行真实生产账号、真实网络故障或付费生成。当前工作仅为本地文件修改，未提交、合并、推送或部署。
