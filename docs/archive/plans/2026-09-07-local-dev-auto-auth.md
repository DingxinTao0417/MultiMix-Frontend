# 本地测试默认免登录实施计划

> Status: archived
> Owner: frontend
> Last verified: 2026-09-07

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本机显式 `dev-admin` 模式启动工作台时自动取得后端默认测试管理员令牌，不出现登录页；Supabase 与线上认证行为保持不变。

**Architecture:** 后端已有 `/v1/auth/local-dev-admin`，且仅在 `env=local`、`auth_provider=local` 和 SQLite 同时成立时可用，因此不新增认证接口或放宽后端安全边界。前端将 Supabase 初始化与当前模式解耦：`dev-admin` 明确优先使用本地令牌，其余模式继续仅在 Supabase 配置完整时使用 Supabase。`.env.local` 只保留一个本地模式值，开发服务器重启后生效。

**Tech Stack:** Next.js 15、React 19、Vitest、FastAPI 既有本地测试管理员接口。

## Global Constraints

- `dev-admin` 只能调用既有的 `/v1/auth/local-dev-admin`；接口自身的 `Settings.local_auth_is_safe` 必须继续是唯一后端安全门。
- 不改动 Supabase 线上认证配置、生产环境变量或生产部署。
- 本地免登录只在显式 `NEXT_PUBLIC_MULTIMIX_AUTH_MODE=dev-admin` 时生效；`local`、空值和未知值不得隐式开启。
- 测试先行：新增断言必须先因缺少辅助函数而失败，再写最小实现。

---

### Task 1: 固定认证模式的选择契约

**Files:**
- Modify: `app/lib/local-auth-session.ts`
- Test: `app/__tests__/local-auth-session.test.ts`

**Interfaces:**
- Produces: `shouldUseSupabaseAuth(authMode: string, isSupabaseConfigured: boolean): boolean`
- Consumes: 既有 `shouldAttemptLocalDevAdmin(authMode)`

- [x] **Step 1: 写失败测试**

```ts
it("keeps Supabase disabled in explicit dev-admin mode", () => {
  expect(shouldUseSupabaseAuth("dev-admin", true)).toBe(false);
  expect(shouldUseSupabaseAuth("local", true)).toBe(true);
  expect(shouldUseSupabaseAuth("", true)).toBe(true);
  expect(shouldUseSupabaseAuth("dev-admin", false)).toBe(false);
});
```

- [x] **Step 2: 运行失败测试**

Run: `npx vitest run app/__tests__/local-auth-session.test.ts`

Expected: FAIL，因为 `shouldUseSupabaseAuth` 尚未导出。

- [x] **Step 3: 写最小实现**

```ts
export function shouldUseSupabaseAuth(authMode: string, isSupabaseConfigured: boolean): boolean {
  return isSupabaseConfigured && !shouldAttemptLocalDevAdmin(authMode);
}
```

- [x] **Step 4: 运行通过测试**

Run: `npx vitest run app/__tests__/local-auth-session.test.ts`

Expected: PASS。

### Task 2: 让工作台按模式选择认证入口

**Files:**
- Modify: `app/multimix-app.tsx`
- Modify: `.env.local` (本机配置，不提交)
- Test: `app/__tests__/local-auth-session.test.ts`

**Interfaces:**
- Consumes: `shouldUseSupabaseAuth(AUTH_MODE, isSupabaseConfigured && Boolean(supabase))`
- Produces: 显式 `dev-admin` 时通过既有 `authLocalDevAdmin()` 自动建立 `multimix_local_user` 会话。

- [x] **Step 1: 复用 Task 1 的红测证明模式判断缺失**

Run: `npx vitest run app/__tests__/local-auth-session.test.ts`

Expected: Task 1 完成前 FAIL；Task 1 完成后 PASS，证明接入依据已经存在。

- [x] **Step 2: 写最小实现**

```ts
const useSupabaseAuth = shouldUseSupabaseAuth(
  AUTH_MODE,
  isSupabaseConfigured && Boolean(supabase),
);

if (useSupabaseAuth && supabase) {
  // 既有 Supabase session 恢复逻辑
}
```

`handleLogout` 和 `MultiMixAuth` 的忘记密码判断也只在 `useSupabaseAuth` 为真时调用 Supabase。将 `.env.local` 中重复的 `NEXT_PUBLIC_MULTIMIX_AUTH_MODE` 收口为唯一的 `dev-admin` 值。

- [x] **Step 3: 运行前端验证**

Run: `npx vitest run app/__tests__/local-auth-session.test.ts && npm run typecheck`

Expected: PASS。

### Task 3: 本机端到端验收

**Files:**
- Verify: `http://localhost:3220/`
- Verify: `http://127.0.0.1:8199/v1/auth/local-dev-admin`

**Interfaces:**
- Consumes: 前端 `dev-admin` 模式与后端安全受限的默认管理员令牌。
- Produces: 本地工作台直接进入创作页；后端非本地或非 SQLite 时继续拒绝该接口。

- [x] **Step 1: 重启独立前端服务**

Run: `npm run dev -- --port 3220`

Expected: 读取更新后的公开环境变量；不占用 3117 或 3200。

- [x] **Step 2: 验证本地免登录**

在浏览器打开 `http://localhost:3220/`，确认不出现“登录你的 AI 短视频创作工作台”，而是直接进入工作台；请求 `GET /v1/auth/local-dev-admin` 返回 200。

- [x] **Step 3: 验证安全边界**

Run: `python -m pytest app/tests/test_config.py -k "local_auth"`

Expected: PASS，非 SQLite 本地认证仍在应用启动前拒绝，`local-dev-admin` 不查询远程数据库。

## Self-review

- 覆盖默认身份、前端免登录、Supabase 不回退及后端安全边界。
- 计划不引入新认证接口、硬编码 token 或生产环境开关。
- 测试与实施接口名称一致：`shouldUseSupabaseAuth`。
