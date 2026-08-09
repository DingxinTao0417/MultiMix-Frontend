# 对话列表加载性能修复实施计划

> **For agentic workers:** 逐项执行并在完成后打勾；未经用户批准不得启用 Subagent，本计划采用当前会话内联执行。

**Goal:** 让对话列表优先从持久摘要缓存即时显示，并把后台刷新从“全量历史”降为轻量摘要请求。

**Architecture:** Supabase Postgres 继续作为权威数据源。后端增加摘要列表和单会话详情 API，并为完整会话预加载产物版本；前端缓存按账号隔离的摘要，先渲染旧数据再后台校验，选中会话时按需加载完整详情。Supabase 非对称 JWT 使用缓存 JWKS 本地验签，旧 HS256 token 保留远程验证。

**Tech Stack:** FastAPI、SQLAlchemy、Pydantic、PyJWT、Next.js、React、Vitest、Supabase Auth/Postgres。

## Global Constraints

- 不修改对话编排状态和当前工作对象语义。
- 不把 token、完整消息正文或完整产物写入浏览器持久缓存。
- 缓存按账号隔离，后台刷新失败时保留旧摘要并显示可恢复错误。
- 不新建或修改本地数据库文件。
- 不触碰当前两个仓库内与时间线、样式、mapper、视频编排有关的未提交修改。

---

### Task 1：后端摘要与详情 API

**Files:**

- Modify: `MultiMix-Backend/app/schemas.py`
- Modify: `MultiMix-Backend/app/api/assets.py`
- Modify: `MultiMix-Backend/app/tests/test_conversation_loading.py`

- [x] 添加失败测试：摘要查询不加载消息，详情查询一次性预加载消息、产物版本。
- [x] 运行 `python -m pytest app/tests/test_conversation_loading.py -q`，确认因接口缺失失败。
- [x] 实现 `GET /v1/assets/conversations/summaries` 与 `GET /v1/assets/conversations/{conversation_id}`。
- [x] 为现有完整列表和详情查询预加载 `ContentAsset.versions`，消除版本 N+1。
- [x] 再次运行测试并确认通过。

验证案例：2 个会话、4 个产物时，摘要 payload 不包含 `messages/products`；完整列表不再执行 4 次逐产物版本查询。

### Task 2：Supabase JWT 本地验签

**Files:**

- Modify: `MultiMix-Backend/app/services/supabase_auth.py`
- Modify: `MultiMix-Backend/app/tests/test_supabase_auth.py`
- Modify: `MultiMix-Backend/requirements.txt`
- Modify: `MultiMix-Backend/pyproject.toml`

- [x] 添加失败测试：RS256/ES256 token 走缓存 JWKS，本地验签成功后不调用 `/auth/v1/user`；HS256 仍走远程验证。
- [x] 运行定向测试并确认缺少本地验签路径。
- [x] 添加显式 `PyJWT[crypto]` 依赖并实现缓存 JWKS 验签。
- [x] 对签名、issuer、audience、过期时间校验失败直接拒绝；仅旧对称算法走远程兼容路径。
- [x] 再次运行测试并确认通过。

### Task 3：前端摘要缓存与按需详情

**Files:**

- Modify: `MultiMix-Frontend/app/assets/lib/asset-workspace-types.ts`
- Modify: `MultiMix-Frontend/app/assets/lib/asset-workspace-adapter.ts`
- Modify: `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`
- Create: `MultiMix-Frontend/app/assets/lib/conversation-summary-cache.ts`
- Create: `MultiMix-Frontend/app/assets/__tests__/conversation-summary-cache.test.ts`
- Modify: `MultiMix-Frontend/app/assets/__tests__/agent-ui-copy.test.ts`
- Modify: `MultiMix-Frontend/docs/API.md`

- [x] 添加失败测试：缓存按账号隔离、过期数据可先显示、损坏缓存被忽略、只保存摘要。
- [x] 运行定向 Vitest 并确认模块缺失或行为缺失。
- [x] 实现摘要类型、缓存读写、摘要请求和单会话详情请求。
- [x] 页面初始化先读缓存并立即渲染，后台刷新摘要；选中摘要时加载详情并合并回现有状态。
- [x] 创建/重命名/删除后同步更新或失效摘要缓存。
- [x] 更新 API 文档并运行定向测试。

验证案例：刷新时缓存列表立即可见；网络失败时保留缓存；点击会话后完整消息和产物可用；不同账号不共享摘要。

### Task 4：真实运行与回归

- [x] 运行后端定向测试、前端定向测试、完整前端测试、类型检查和 `docs:check`。
- [x] 运行后端相关完整测试集与前端生产构建。
- [x] 只重启当前 `8199` 后端与 `3200` 前端，不触碰其他端口。
- [x] 在当前 Supabase 数据下测量摘要接口与浏览器刷新：缓存列表先显示，后台刷新完成，完整会话可打开。
- [x] 将本计划全部打勾后移入 `docs/archive/plans/`。
