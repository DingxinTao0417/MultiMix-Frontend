# 乐观草稿会话详情刷新 404 修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-04

## 背景与根因

E2E `e2e-disabled-bgm-catalog-export-20260804-13` 已成功导出 MP4，却在最终浏览器控制台检查时
发现对 `draft-...` 会话的详情与 snapshot 请求均返回 404。

`assets-workspace-client.tsx` 在首次发送消息时为即时 UI 建立客户端乐观草稿 ID；服务端返回正式
会话 ID 后会替换该行。详情刷新 effect 只排除了 `new`，没有排除尚未持久化的 `draft-*`，故在
替换前向服务端读取一个本就不存在的会话。

## 涉及文件与具体改法

1. `MultiMix-Frontend/app/assets/lib/conversation-detail-load-policy.ts`
   - 定义单一、可单测的结构规则：只有非 `new`、非客户端 `draft-*` 且尚未加载详情的会话才能
     发出详情/snapshot 请求。
2. `MultiMix-Frontend/app/assets/lib/__tests__/conversation-detail-load-policy.test.ts`
   - 先复现 `draft-*` 会触发读取的错误；覆盖正式会话仍可读取、已加载和 `new` 均不会重复读取。
3. `MultiMix-Frontend/app/assets/components/assets-workspace-client.tsx`
   - 详情刷新 effect 只消费上述规则。正式会话返回后仍按既有 generation 对账与详情加载流程执行。
4. `MultiMix-Frontend/app/assets/__tests__/workspace-new-conversation-routing.test.tsx`
   - 更新既有工作台路由契约：详情 effect 应调用统一加载策略，而不是保留只排除已加载详情的旧分支。
5. 真实 E2E
   - 使用独立 SQLite 复测草稿替换、视频生成与导出，控制台不再出现 `draft-*` 404。

## 风险与取舍

- `draft-*` 是本地乐观 ID 协议，不是服务端会话；该判断属于确定性身份边界，不是业务语义推断。
- 不把 404 静默吞掉作为修复；根因是停止发送不合法请求。
- 不改变正式会话、直接链接历史会话或重试详情加载的逻辑。

## 验证方式

- TDD 运行新的纯策略单测，再运行相关工作台测试、类型与静态检查。
- 新隔离 E2E 验证 MP4 导出和浏览器控制台；保留运行数据库与素材，直到用户确认清理。

## 执行状态

- [x] 保留 E2E 证据并定位 404 根因
- [x] TDD 策略用例
- [x] 接入详情刷新逻辑
- [x] 自动化验证：详情策略 5 项、类型检查与 ESLint 通过
- [ ] 真实隔离 E2E：新运行 `e2e-optimistic-draft-detail-fetch-20260804-14` 在编导稿质量门被模型拒绝，未进入草稿替换阶段；运行数据库与素材已保留。
- [ ] 既有路由契约同步：`workspace-new-conversation-routing.test.tsx` 仍断言已移除的旧分支；该文件当前被 `streaming-video-preview-loading` 开发占用，待其释放后再更新，避免并发修改。
