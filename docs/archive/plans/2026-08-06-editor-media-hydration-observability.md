# 编辑器媒体下载超时与可观测性修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-06

## 背景与根因

视频工程预览须先把每个媒体 URL 下载为浏览器本地 `Blob/File`，再交给 WebCodecs 解码。当前 `MultiMix-Frontend/editor-engine/vendor/bootstrap.ts:13-28` 对每个媒体下载设置 90 秒 Abort 超时；超时、HTTP 错误、MIME 不匹配和网络异常都会在 `hydrateAssetFiles` 中被捕获并只输出一条缺少上下文的 warning。失败素材随后保留为没有 `file` 的条目，视频缓存将其视为不可用，画面黑屏，但工程仍能进入 ready。

90 秒不足以覆盖经受控媒体代理读取的大文件、云端冷读或网络抖动。现有日志没有成功/失败耗时、响应大小、HTTP 状态或可区分的失败类别，无法判断具体工程是下载超时、存储对象缺失、响应类型错误还是实际编解码不支持。

## 目标与边界

- 将单个媒体下载上限从 90 秒提升为 300 秒；仍保持每个资源独立中止，避免永久挂起。
- 为每个素材记录下载开始、完成或失败的结构化浏览器诊断，包含素材标识、URL、耗时、响应状态、MIME、字节数和失败类别。
- 保持当前“单个失败不阻断其他素材加载”的恢复行为；本次不改变工程 ready 判定或后端存储协议。
- 不记录查询参数以外的敏感响应内容，不输出媒体二进制内容。

## 涉及文件与具体改法

1. `MultiMix-Frontend/editor-engine/vendor/bootstrap.ts`
   - 将受控下载超时常量设为 300,000 毫秒。
   - 让下载函数返回响应元数据，并以单调时钟计算实际耗时。
   - 对成功下载输出 `console.info` 结构化记录；对失败输出包含失败类别（超时、HTTP、网络、MIME、缺少 URL）的 `console.warn` 结构化记录。
   - 不修改 URL 加载、Blob/File 创建及逐素材失败后继续其他素材的语义。

2. `MultiMix-Frontend/editor-engine/vendor/bootstrap.test.ts`
   - 先将卡在 90 秒的回归测试改为验证 300 秒才中止。
   - 覆盖成功素材的耗时/响应元数据日志，以及超时和 HTTP/MIME 失败原因的诊断字段，不依赖真实网络。

## 风险与取舍

- 300 秒会让真正失联的单条资源更晚结束；每批仍并行 6 条，且不会阻塞已完成素材的结果。它是对慢媒体读取的容忍，不是取消保护。
- 浏览器控制台日志用于现场诊断，不能替代服务端持久化监控；若问题持续，需要后续把这些诊断汇总到受控的前端遥测通道。
- 这次日志只能确认下载阶段；若下载成功而 WebCodecs 仍拒绝，现有视频缓存的“Skipping undecodable video media”日志将继续提供编解码阶段证据。

## 验证方式

- 运行 `vitest run editor-engine/vendor/bootstrap.test.ts`，验证 300 秒超时、成功记录和失败诊断。
- 运行前端类型检查，确认日志/响应类型不引入类型回归。
- 手工浏览器验证时检查每个素材对应一条 `media hydration succeeded` 或 `media hydration failed` 记录，并根据 `reason` 区分下载与实际解码问题。

## 执行记录（2026-08-06）

- 已将单资源中止阈值由 90,000 毫秒调整为 300,000 毫秒。
- 已实现浏览器控制台的逐素材结构化下载记录；成功记录状态、MIME、字节数和耗时，失败记录相同上下文及 `timeout`、`http`、`mime`、`network` 或 `missing-url` 原因。日志 URL 已剥离查询与 hash。
- `npx vitest run editor-engine/vendor/bootstrap.test.ts`：3 个回归用例通过，覆盖 300 秒超时、成功下载及 HTTP/MIME 失败分类。
- `npx tsc --noEmit`、`npx eslint --no-ignore editor-engine/vendor/bootstrap.ts editor-engine/vendor/bootstrap.test.ts`、`npm run docs:check`、`git diff --check` 均通过。
