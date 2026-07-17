# MultiMix 功能缺口与待完善清单

> 最后更新: 2026-07-17
> 基于全仓库代码审查生成，覆盖 frontend + backend。

---

## 🔴 P0 — 核心功能缺失

### 1. 视频编辑器：转场 / 滤镜 / 调色未实现

**位置:** `editor-engine/vendor/editor/components/editor/panels/assets/index.tsx:23-38`

三个编辑面板 Tab 均渲染硬编码占位符：

| 功能 | 当前状态 |
|------|---------|
| Transitions（转场） | `"Transitions view coming soon..."` |
| Filters（滤镜） | `"Filters view coming soon..."` |
| Adjustment（调色） | `"Adjustment view coming soon..."` |

**影响:** 用户无法在编辑器内添加转场效果、应用滤镜或进行色彩调整，编辑体验严重不完整。

### 2. 素材替换 drag-and-drop 未实现

**位置:** `editor-engine/vendor/editor/hooks/timeline/use-timeline-drag-drop.ts:321`

拖拽新素材到时间线替换现有片段时，只弹出 toast `"Replace media source is coming soon!"`，不执行实际替换。

### 3. 部分命令撤销 (Undo) 不可用

**位置:** `editor-engine/vendor/editor/lib/commands/base-command.ts:5`

`Command` 基类的 `undo()` 默认抛出：
```typescript
throw new Error("Undo not implemented for this command");
```
任何未覆写 `undo()` 的子类命令在用户按 Ctrl+Z 时都会直接报错。

---

## 🔴 P0 — 后端核心模块零测试覆盖

### 4. 素材源适配器（17 个）无测试

**位置:** `app/services/material_sources/*.py`

以下所有第三方 API 适配器完全没有任何测试覆盖：

```
pexels.py, pixabay.py, unsplash.py, nasa.py, esa.py,
archive_org.py, mixkit.py, coverr.py, videvo.py,
life_of_vids.py, mazwai.py, openverse.py, wikimedia.py,
europeana.py, nara.py, pond5.py, shutterstock.py
```

**影响:** 任何一个外部 API 变更（响应格式、认证方式、限流规则）都会导致素材搜索静默失败，无法及时发现。

### 5. 视频工作室模块（8 个）无测试

**位置:** `app/services/video_studio/*.py`

```
jobs.py, builder.py, compositor.py, exporter.py,
project.py, timeline.py, audio.py, subtitles.py
```

视频渲染/合成的整条链路没有任何自动化测试覆盖。

### 6. Remotion Modal 渲染模块无测试

**位置:** `app/services/remotion_modal/*.py`

MG 动效渲染（Remotion on Modal）的客户端和 Modal 应用均无测试。

---

## 🟠 P1 — 体验与质量

### 7. 流式响应 (Streaming) 未接入

**位置:** `app/assets/lib/ui-flags.ts:37`

```typescript
UI_V3_STREAMING_ENABLED (默认 OFF) — "capability probe, 等待后端 streaming 支持"
```

当前对话消息采用**轮询模式**——AI 生成完整回复后一次性返回，用户无逐字输出体验，长文案场景下等待无反馈。

### 8. Agent 执行时间线降级模式未实现

**位置:** `app/assets/lib/ui-flags.ts:16`

`UI_V3_AGENT_TIMELINE` 开关已定义但**在任何组件中都未被检查**。`AgentRunTimeline` 总是无条件渲染，不存在注释中描述的 "bare '生成中' shimmer" 降级模式。

### 9. 前端 E2E 测试覆盖严重不足

**当前覆盖:**
- ✅ 视频展示区 8 个用例 (`e2e/display-area.spec.ts`)
- ✅ 1 个 demo 素材包场景

**完全未覆盖的关键路径:**
- ❌ 用户注册 / 登录 / 登出
- ❌ 资产库浏览 / 搜索 / 筛选
- ❌ 文件上传流程 (PDF / Word / 图片 / 视频)
- ❌ 对话创建 / 删除 / 切换 / 重命名
- ❌ 编辑器交互 (时间线拖拽、素材替换、导出)
- ❌ 胶片条 (FilmStrip) 交互
- ❌ 管理员页面 (`/admin/public-sources`)
- ❌ 错误状态展示与重试

### 10. 静默异常吞没（排查困难）

| 位置 | 异常类型 | 行为 |
|------|---------|------|
| `collection_runner.py` Playwright 操作 | `except Exception: pass` × N | 浏览器抓取失败完全静默 |
| `collection_runner.py` Redis 操作 | `except RedisError: pass` | Redis 挂了只降级不报警 |
| `feed.py` 解析入口 | `except Exception: return []` | 上游以为"无数据"而非"出错" |
| `monitor.py` 结构化加载 | `except OSError/ValueError: return []` | 同上 |
| `check_lock.py` 锁获取 | `except RedisError: return` | 并发锁失效静默 |

### 11. 后端无直接测试的辅助模块

| 模块 | 风险 |
|------|------|
| `rate_limit.py` | 速率限制失效可能导致资源滥用 |
| `check_lock.py` | 并发控制失效可能导致数据竞争 |
| `bootstrap.py` | 初始化逻辑变更无法验证 |
| `email_verification.py` | 邮件验证流程无回归保障 |
| `official_templates.py` | 模板过滤逻辑未被测试 |

---

## 🟡 P2 — 代码卫生与安全

### 12. 硬编码 API Key 泄露

**位置:** `editor-engine/vendor/editor/lib/blog/query.ts:18`

```typescript
const key = process.env.MARBLE_WORKSPACE_KEY ?? "cmd4iw9mm0006l804kwqv0k46";
```

真实的 MarbleCMS workspace key 作为 fallback 写死在源码中，属于安全风险。

### 13. 开发遥测端点未清理

**位置 (多处):**
```
editor-engine/vendor/editor/stores/keybindings-store.ts:67,105,138,227
editor-engine/vendor/editor/components/ui/use-overlay-open-change.ts:38
editor-engine/vendor/editor/hooks/use-keybindings.ts:25,58,99
editor-engine/vendor/editor/lib/actions/registry.ts:62
```

所有均硬编码指向 `http://127.0.0.1:7245/ingest/...`，这是上游 OpenCut 编辑器的开发环境遥测端点。在生产中会持续产生失败的 HTTP 请求。

### 14. 本地 SQLite 文件误提交

**位置:** `db/local/multimix.sqlite`

项目文档明确声明"前端不创建或读取本地 SQLite"，但该文件被提交到了仓库。

### 15. 文档幽灵引用

**位置:** `CLAUDE.md:112` / `AGENTS.md:112`

两份文档均引用了 `VideoProjectWorkspace` 组件并标注 "currently has no callers"，但此组件在代码库中**不存在**——文档已过时。

---

## 🟢 P3 — 功能边界与扩展

### 16. 官方模板数据过滤

**位置:** `app/services/official_template_content.py:1069-1073`

4 个行业模板中只有 2 个被激活：

| 模板 | 状态 |
|------|------|
| `embodied_ai_robotics_industry` | ✅ 激活 |
| `ecommerce_platform_customs_rules` | ✅ 激活 |
| `ai_tools_models_api` | ❌ 被过滤 |
| `competitor_site_pricing_features` | ❌ 被过滤 |

### 17. 自定义辅助线功能已实现但未接入

**位置:** `editor-engine/vendor/editor/lib/guides/registry.tsx:20-21`

```typescript
// todo: wire up custom guide fully, then uncomment this:
// customGuide,
```

`customGuide` 定义已完整实现，仅需在 registry 中取消注释并验证即可启用。

### 18. 视频编辑器模块级 TODO（vendored）

**位置:** `editor-engine/vendor/editor/`

| 文件 | 内容 |
|------|------|
| `hooks/actions/use-editor-actions.ts:405` | `// todo: potnetially unify these two actions:` |
| `lib/time.ts:162` | `// todo: how to tell frames apart from cs?` |
| `lib/db/schema.ts:6` | `// todo: implement fully anonymous sign-in for privacy` |

这些是上游 OpenCut 的遗留 TODO，在 vendored 后会持续存在。

---

## 📊 汇总

| 优先级 | 数量 | 关键项 |
|--------|------|--------|
| 🔴 P0 | 6 | 编辑器三大功能缺失、素材替换、Undo、后端核心模块无测试 |
| 🟠 P1 | 5 | 流式响应、E2E 覆盖、静默异常、降级模式、辅助模块测试 |
| 🟡 P2 | 4 | API Key 泄露、遥测未清理、SQLite 误提交、幽灵文档 |
| 🟢 P3 | 3 | 模板过滤、自定义辅助线、上游 TODO |
| **合计** | **18** | |
