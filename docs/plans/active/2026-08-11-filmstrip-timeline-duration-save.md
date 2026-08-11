# 嵌入式时间轴分割保存修复

> Status: active-plan
> Owner: frontend
> Last verified: 2026-08-11

## 背景与根因

生产隔离验收中，30 秒视频工程首次导出 MP4 后，对第一个分镜执行“分割”会显示两段均为 `0.0s`，随后自动保存失败。

根因位于 `app/editor/filmstrip-utils.ts` 与 `app/editor/FilmStrip.tsx`：编辑器内核的 `duration` 是时间线占位时长，`trimStart` / `trimEnd` 是源媒体偏移，不能从 `duration` 再次扣除。分割命令会把两半的源偏移写入 trim 字段并把各自的时间线时长减半；现有 `visibleDuration` 再扣一次后得到 0，导致分割点、条带显示和提交结果错误，最终被工程质量门拒绝。

时长修复上线后的第二次隔离生产验收显示了独立根因：编辑器内核在分割时保留左半段的 element id、为右半段生成新 id；而 MultiMix 将 `segmentId`、分镜文案、安全区和编导决策等后端往返字段保存在按 element id 索引的 side map 中。右半段没有继承这些字段，序列化提交后缺少 `segmentId` 与对应审计信息。后端按工程就绪契约正确返回 409，前端只能显示泛化的“保存失败”。

## 范围与改法

- `app/editor/filmstrip-utils.ts`
  - 将展示、分割和布局使用的时长统一为时间线占位时长。
  - 让裁剪计算显式返回新的时间线时长；源媒体可用长度由“当前时间线时长 + 两侧源偏移”推导，裁剪仍维持 2–15 秒约束。
- `app/editor/FilmStrip.tsx`
  - 裁剪提交同时更新 `duration`；分割边界、条带宽度与总时长继续使用时间线占位时长。
- `editor-engine/vendor/buildProject.ts`
  - 提供一个受限的分割元数据继承函数：把原 element 的所有按 element id 保存的后端往返字段复制给分割产生的右半段；不复制按 media id 管理的文件路径。
- `app/editor/FilmStrip.tsx`
  - 使用 `splitElements` 返回的右半段 id，在自动保存前调用该继承函数。左半段沿用原 id，无需额外处理。
- `app/assets/__tests__/filmstrip-utils.test.ts`
  - 先增加“分割后带源偏移的两个片段仍保留各自时间线时长”的失败复现。
  - 增加左右裁剪会同步改变时间线时长的回归测试。
- `editor-engine/vendor/serializeProject.test.ts`
  - 先增加一条生产回归：分割后右半段以新 id 参与序列化时，仍带有原分镜的 `segmentId`、文案、安全区和编导决策；旧实现应失败。

## 风险与取舍

- 不改后端 `PUT /v1/video/projects/{id}` 的质量门或 MP4 失效逻辑；生产验收已证明这部分有效，前端应提交正确的时间线数据而非放宽校验。
- 不修改 OpenCut 分割命令：它已正确将 `duration` 作为时间线占位并将 trim 作为源偏移处理。
- 不把后端 409 改成警告或绕过就绪校验；该校验同时保护视频工程、分镜审计与 MP4 失效后的重新导出一致性。
- 保持现有最短 2 秒、最长 15 秒的交互约束，并覆盖未裁剪与已裁剪两种情况。

## 验证

1. TDD：新增测试先在旧实现上失败，确认失败原因是错误地从时间线时长扣 trim；最小实现后通过。
2. 运行隔离前端单元测试、类型检查、lint 和构建。
3. 运行使用一次性 SQLite 与独立端口的本地浏览器验收：分割 -> 自动保存成功 -> 旧 MP4 失效 -> 重新导出成功。
4. 本地通过后，再创建或复用隔离生产验收项目完成相同流程；不得触碰既有用户项目。验收需确认分割后两个片段仍归属同一分镜、自动保存成功、旧 MP4 失效且重新导出成功。
