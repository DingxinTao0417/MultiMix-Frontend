# 项目化工作台回归收口

> Status: completed
> Owner: frontend
> Last verified: 2026-09-01

## 背景与根因

- 项目化工作台已经把全局资源操作统一为“加入项目…”，但两条旧测试仍断言“加入对话”。
- 项目列表缓存已经要求 `project_state`，但断网测试夹具仍使用旧摘要结构，因此缓存被正确丢弃。
- 项目化文案已统一为“项目加载失败”，一条恢复测试仍断言旧文案“对话加载失败”。

## 涉及文件与关键位置

- `app/assets/__tests__/library-workshop-performance.test.tsx:134`
- `app/assets/__tests__/library-video-creation-actions.test.tsx:50`
- `app/assets/__tests__/runtime-write-capability-gating.test.tsx:557`

## 具体改法

- 将资源库旧按钮断言更新为“加入项目…”，保留回调参数断言，确保只改名称、不放松行为验证。
- 给断网缓存夹具补充合法的 `project_state`，继续验证缓存可浏览但不可写。
- 将加载失败断言更新为“项目加载失败”，继续验证重新加载后写入能力恢复。

## 风险与取舍

- 未修改生产实现，避免为了兼容旧测试回退已确认的项目化产品语言与缓存契约。
- 未放宽缓存校验；缺失项目状态的旧缓存继续失效，防止侧栏展示错误进度。

## 验证结果

- 原失败文件：3 个文件、25 个测试通过。
- 前端全量单测：105 个文件、760 个测试通过。
- TypeScript 类型检查通过。
- ESLint：0 个错误；4 个既有未使用参数警告。
- Next.js 生产构建通过。
- AGENTS 同步、产品展示区样式契约、视频预览契约与跨仓文档检查通过。
