# 项目化入口主分支集成

> Status: completed
> Owner: frontend
> Last verified: 2026-09-01

## 背景与根因

- 前端功能分支比 `main` 落后 8 个提交，新建入口同时被项目化改造和长视频统一上传入口改造修改。
- 合并只产生一个冲突，但错误选择会重新引入已删除的 `LongFormEntry` 或回退“新建视频项目”定位。

## 集成结果

- 保留“新建视频项目”主标题和“在同一对话里持续补素材、改文案和生成视频”的项目连续性说明。
- 保留最新主分支的统一上传、视频链接识别与 `LongFormComposerPrompt` 流程。
- 未恢复已删除的独立长视频入口，也未新增第三种视频类型。

## 涉及范围

- `app/assets/components/conversation-start.tsx`
- 最新 `main` 自动合并的长视频、视频审核、视觉/BGM 确认及测试治理改动

## 验证结果

- 前端全量 Vitest：107 个文件、792 个测试通过。
- Next.js 生产构建通过。
- AGENTS 同步、产品展示区样式契约和视频预览契约通过。
