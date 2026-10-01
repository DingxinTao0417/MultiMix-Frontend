# 项目资料刷新失败与重复操作整改

> Status: archived
> Owner: frontend
> Last verified: 2026-10-01

## 背景与根因

上一轮只读复查确认：资料移出已提交、详情 GET 失败时，`app/assets/components/assets-workspace-client.tsx:2112-2127` 仅将详情标为未加载并关闭抽屉；`conversation-studio.tsx:1186-1224` 仍显示旧资料总数和可点击入口，`project-resources-drawer.tsx:91-110,243-263` 又按旧总数决定当前/历史范围，可能出现“素材 1”与空列表并存。该入口在重试详情前不可信。

同一抽屉 `project-resources-drawer.tsx:163-195,315-325` 仅禁用当前 pending 素材，用户可在第一份历史素材尚未完成时重新加入第二份；`assets-workspace-client.tsx:2086-2101` 的两个详情回包可乱序覆盖摘要。另有需求快照 GET 失败后的提示仅为文本（`assets-workspace-client.tsx:3089-3094`），没有直接恢复动作。初次实现 toast 按钮后，隔离浏览器发现模态抽屉仍打开，短暂 toast 中的操作不可可靠触达，因此恢复动作需要留在抽屉内。

## 涉及文件与具体改法

- `app/assets/components/conversation-studio.tsx`：项目详情 `detailsLoaded=false` 时不展示旧“资料 · 数量”入口；保留已有“重试加载”按钮。项目详情恢复后按服务端最新摘要重新出现。
- `app/assets/components/assets-workspace-client.tsx`：抽屉只在详情已加载时可挂载，防止晚到状态重新打开旧摘要。需求 GET 失败时记录当前项目的同步错误，向打开的抽屉提供持久“重新同步需求”操作；只重发只读 GET，不重复 PUT/DELETE，成功/再次失败均给出准确反馈。toast 保留结果提示，不再承载唯一恢复入口。
- `app/assets/components/project-resources-drawer.tsx`：成员关系操作 pending 时禁用全部资料变更动作，并在事件处理函数再次检查 pending 状态，避免同一抽屉并发加入/移出；需求同步失败时在抽屉内显示可操作的提示与重试按钮。
- `e2e/display-area.spec.ts`：扩展现有详情失败用例，断言重试前旧资料入口不可见、恢复后服务端真实历史资料可见；扩展需求 GET 失败用例，验证操作按钮只重新发 GET。
- `app/assets/__tests__/project-resources-drawer.test.tsx`：两份历史素材的 deferred readd 测试，断言首个请求 pending 时第二个不可提交，结束后可继续。

后端成员关系接口及数据库不变；不修改视频播放器或独立剪辑器。

## 风险与取舍

- 详情未同步时临时隐藏资料入口，避免旧数量误导；用户仍能通过同一对话中的“重试加载”恢复，正常项目的入口不变。
- 禁用整个抽屉的成员操作只持续单次写入及随后的刷新；牺牲短时间并行操作，换取摘要顺序与用户反馈一致性。
- 需求同步提示绑定当前项目抽屉，直到只读 GET 成功才消失；避免模态抽屉遮挡短暂 toast。关闭抽屉后，下次重新打开同一项目时仍可重试。

## 计划任务与验证

1. [x] 先补旧资料入口、双素材并发、需求 GET 恢复的失败回归：旧实现中抽屉第二份素材按钮未禁用；隔离浏览器中详情失败后旧“资料 · 1”仍可见，需求提示无“重新同步需求”操作。红测临时库已清理。
2. [x] 详情未同步时隐藏旧资料入口并阻止旧抽屉挂载；抽屉成员变更串行化；需求失败提示先接入只读重试。`typecheck`、lint、抽屉组件测试（15/15）和展示区组件测试（40/40）通过。
3. [x] 修正浏览器验收发现的模态抽屉重试可达性。定向 `test:display-coverage` 4/4 通过；`check:video-preview-contract`、`test:product-stage-style`、`docs:check`、typecheck、lint、抽屉组件测试和展示区组件测试通过。隔离运行的测试库与进程已清理，后端仓库保持干净。

本轮只做本地修复与验证，不自动提交、合并、推送或部署。
