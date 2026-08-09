# Next.js 开发与生产构建输出隔离实施计划

> **For agentic workers:** 本计划必须逐项执行并在完成后打勾；本工作区禁止未经用户批准启动 Subagent，因此采用当前会话内联执行。

**Goal:** 隔离 Next.js 开发与生产构建产物，恢复当前 `3200` 页面并防止 `next build` 再次破坏运行中的开发服务器。

**Architecture:** `next.config.mjs` 根据 Next.js phase 返回配置。development server 使用 `.next`，production build/server 使用 `.next-build`；两条链路不再共享可变静态资源目录。

**Tech Stack:** Next.js 15、Node.js test runner、PowerShell。

## 问题

本地 `next dev -p 3200` 长时间运行时，另一轮 `next build` 会复用并改写同一个 `.next` 目录。开发服务器随后仍生成引用开发模式 chunk 的 HTML，但磁盘上对应的 CSS 与 JavaScript 已被生产构建产物替换，导致静态资源返回 404。浏览器只能显示未加样式的服务端加载壳层，并且无法执行认证初始化。

## 设计

- 开发服务器继续使用默认 `.next`，避免改变现有开发模式的类型生成与工具约定。
- 生产构建和生产服务器使用 `.next-build`。
- `next.config.mjs` 根据 Next.js phase 选择输出目录：development server 使用 `.next`，其他生产 phase 使用 `.next-build`。
- 保留现有 webpack alias、GLSL loader 与其他配置不变。

这样 `next build` 与正在运行的 `next dev` 不会再写入同一目录，生产构建也仍可由 `next start` 从同一配置指定的目录启动。

## 回归约束

- 配置测试必须证明 development phase 与 production build/server phase 使用不同目录。
- 测试必须证明生产构建与生产服务使用同一个目录。
- 生产构建必须成功生成 `.next-build`。
- 重启 `3200` 后，首页引用的 CSS 与主要 JavaScript chunk 必须全部返回 200，页面必须离开“正在载入...”壳层。

## Task 1：配置回归测试与最小实现

**Files:**

- Create: `MultiMix-Frontend/lib/next-config-output.test.mjs`
- Modify: `MultiMix-Frontend/next.config.mjs`

**Interfaces:**

- Consumes: `PHASE_DEVELOPMENT_SERVER`、`PHASE_PRODUCTION_BUILD`、`PHASE_PRODUCTION_SERVER` from `next/constants.js`
- Produces: `createNextConfig(phase)` default export，返回 Next.js config object

- [x] **Step 1: 添加失败测试**

```js
import { describe, expect, it } from "vitest";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
  PHASE_PRODUCTION_SERVER
} from "next/constants.js";
import createNextConfig from "../next.config.mjs";
```

- [x] **Step 2: 验证测试因当前配置不是 factory 而失败**

Run: `npx vitest run lib/next-config-output.test.mjs`

Expected: FAIL at `typeof createNextConfig` because current default export is an object.

- [x] **Step 3: 实现 phase-based 输出目录**

在 `next.config.mjs` 引入 `PHASE_DEVELOPMENT_SERVER`，把现有配置对象改成配置 factory；保留现有 webpack 配置原样，并加入：

```js
distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next" : ".next-build"
```

- [x] **Step 4: 验证配置测试通过**

Run: `npx vitest run lib/next-config-output.test.mjs`

Expected: 1 test passed, 0 failed.

## Task 2：静态验证与生产构建

**Files:**

- Verify: `MultiMix-Frontend/next.config.mjs`
- Verify output: `MultiMix-Frontend/.next-build/`

- [x] **Step 1: 运行类型检查**

Run: `npm run typecheck`

Expected: exit code 0.

- [x] **Step 2: 运行生产构建**

Run: `npm run build`

Expected: exit code 0 and `.next-build/BUILD_ID` exists.

- [x] **Step 3: 确认生产构建未改写开发目录**

记录 `.next` 与 `.next-build` 路径，确认生产产物只写入 `.next-build`。

## Task 3：恢复当前开发服务器并验证原始症状

**Files/processes:**

- Stop only: PID currently listening on `0.0.0.0:3200` and its dedicated parent process
- Remove only: `MultiMix-Frontend/.next/` generated development cache
- Start: `npm run dev -- -p 3200`
- Do not touch: backend PID/port `8199`, other Next.js ports, databases

- [x] **Step 1: 再次确认 `3200` 与 `8199` 的监听 PID**

Run: `netstat -ano | findstr ':3200'` and `netstat -ano | findstr ':8199'`.

- [x] **Step 2: 停止仅属于当前 MultiMix 前端的 `3200` 进程链**

验证命令行包含 `Desktop\multimix\MultiMix-Frontend` 后，再停止该子进程及其专用父进程。

- [x] **Step 3: 清理被污染的开发缓存并重新启动**

解析并确认目标严格等于 `MultiMix-Frontend/.next` 后删除；后台启动 `npm run dev -- -p 3200`，日志写入临时日志文件用于验证。

- [x] **Step 4: 验证 HTTP 与静态资源**

首页必须返回 200；从 HTML 提取的 CSS 与 JavaScript URL 必须全部返回 200；`8199/healthz` 仍返回 200。

- [x] **Step 5: 验证页面离开加载壳层**

使用浏览器或等价的客户端执行验证，确认最终工作台可见且不再停留在未加样式的“正在载入...”页面。

- [x] **Step 6: 更新计划并归档**

完成所有检查框后，把本文件移入 `docs/archive/plans/`，运行 `npm --prefix MultiMix-Frontend run docs:check`。

## 边界

- 不修改或重启 `8199` 后端。
- 不新建或修改数据库。
- 不触碰其他端口上的开发者进程。
- 不包含当前前端仓库里已有的无关未提交测试修改。
