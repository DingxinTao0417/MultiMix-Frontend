# 可理解的视频制作进度

> Status: active-plan
> Owner: frontend
> Last verified: 2026-09-21

## 背景与根因

视频任务卡当前把后端已持久化的阶段事件压缩为“准备画面 / 制作视频”等笼统分组。逐镜进度已在同一链路写入，但阶段摘要仍不能回答用户正在做什么，长时间外部调用时只能看到重复的等待描述。

## 目标与边界

在不改变任务状态、重试策略或质量门的前提下，直接消费已有公开阶段事件：卡片摘要显示当前真实阶段及已耗时；展开后逐项显示已完成和进行中的用户可见阶段。逐镜进度由正在进行的同工作区改动提供，本计划不改动该共享文件。

## 涉及文件与改法

1. `app/assets/lib/video-progress-presentation.ts`：不再将阶段事件折叠为固定两组；从安全的公开 `AgentRunStep.label` 生成阶段清单，摘要选择最近进行中的阶段并使用已有耗时标签。保留队列、断连、失败、取消、完成状态及其既有文案。
2. `app/assets/__tests__/video-progress-card.test.tsx`：覆盖摘要显示真实当前阶段与已耗时、展开后保留逐阶段完成记录，以及现有失败/断连回归。

## 风险与取舍

只使用服务端已投影的公开 label，不显示内部 stage key、供应商、提示词或诊断。没有阶段事件的历史任务继续使用既有通用状态，避免把缺失数据伪造成进度。

## 验证

先以组件测试复现当前“活动阶段被折叠”的问题，再运行 `video-progress-card` 与 `asset-generation-job-ui` 定向测试。该变更不触发真实模型或视频生成。

## 2026-09-23：提交前合同对齐

### 背景与根因

提交前全量单测发现，新实现已经直接展示公开阶段，但旧的
`video-progress-presentation` 单测和 `video-confirmation-execution-card` 规范仍固定要求最多四个
归并阶段，三者没有在计划实施时同步。与此同时，当前实现会直接展示未知事件的原始 label，
这超出了“只显示服务端已登记公开阶段”的计划边界；排队状态也遗漏了已持久化任务原有的
“可以离开后回来查看”提示。另一个上传提示失败来自旧测试仍使用“识别分镜”术语，实际实现
已经按外部视频对话舒适度合同改为普通用户可理解的“整理成片段”。

后端测试启动失败不是产品代码问题：命令误用了系统 Python 及不兼容的 Starlette 0.41.3；
仓库 `.venv` 使用声明范围内的 Starlette 1.3.1，包含测试配置要求的警告类型。

L2 首轮并行回归还暴露两个不同现象：资源竞争使资源库性能用例超时，隔离运行后已通过；
运行时写能力用例则可稳定复现。后者的测试数据没有声明生成任务 `retryable=true`，却仍期待
新版显式重试合同显示按钮。产品实现正确地对缺失/false 失败关闭，根因是测试 fixture 未同步
新增的后端权威重试字段，而不是恢复写能力后丢失按钮状态。

前端脚本回归还发现，生产 E2E 合同仍要求 runner 内复制一份具体错误码白名单；runner 已改为
调用后端共享的 `generation_job_is_retryable` / `generation_job_is_regenerable`，共享模块才是当前
唯一重试口径。旧断言会迫使测试运行器重新引入第二套硬编码，根因是合同测试没有随共享判定
迁移，而不是 runner 放宽了恢复资格。

### 涉及文件与具体改法

1. `app/assets/lib/video-progress-presentation.ts`：只对已登记的公开阶段使用服务端 label；未知
   事件降级为当前任务的通用工作阶段，不暴露原始 key/label。排队状态恢复可离开提示。
2. `app/assets/__tests__/video-progress-presentation.test.ts`：用真实公开 label 覆盖逐阶段展示，
   保留未知事件不泄漏、失败/断连、完成谓词和排队提示回归。
3. `app/assets/__tests__/agent-ui-copy.test.ts`：按已确认的普通用户语言断言“整理成片段”，不把
   “识别分镜”重新带回界面。
4. `docs/specs/ui/video-confirmation-execution-card.md`：同步当前设计为“已登记公开阶段逐项显示、
   未知阶段通用降级”，移除已经被本计划取代的固定四阶段上限。
5. `app/assets/__tests__/runtime-write-capability-gating.test.tsx`：需要验证可重试恢复的 fixture
   显式设置 `retryable=true`；继续保留缺失/false 时不展示重试的失败关闭覆盖。
6. `scripts/__tests__/video-pipeline-production-env-contract.test.mjs`：断言生产 runner 调用共享
   重试/重新生成判定，不再要求复制具体错误码集合；同步保留任务的持久历史合同：允许已失败的
   前序任务通过 `restart_of_generation_job_id` 串联到唯一最新完成任务；可重新生成任务的新任务
   尝试次数从 1 开始，可重试任务才在原次数上加 1。错误码边界继续由后端单元测试证明。
7. `e2e/video-pipeline-retained-director-retry.spec.ts`：按服务端给出的 `regenerable` 选择
   `regenerate` 或 `retry`，并核对对应请求恰好一次；报告记录实际活动任务 ID 与条件化尝试次数，
   避免重新生成新任务仍被误报为原任务重试。
8. 后端不修改配置或依赖；所有 pytest 命令显式使用 `.venv\\Scripts\\python.exe`。

### 风险与取舍

- 服务端新增阶段如果尚未进入前端登记集合，会先显示通用工作阶段；这比泄漏内部名称安全，
  但需要在新增公开阶段时同步前端合同。
- 逐阶段详情可能比旧四阶段更长，只在用户主动展开时展示；摘要仍保持单一当前状态。
- 不修改任务状态、完成谓词、重试目标、供应商等待预算或任何付费链路。

### 验证方式

- L1：聚焦运行 `video-progress-presentation`、`video-progress-card`、`agent-ui-copy`。
- L2：前端 `test:fast`、类型、lint、`check:agents`；后端使用项目 `.venv` 运行离线 pytest。
- 不执行浏览器 E2E、真实模型或视频生成；本轮结论只覆盖离线回归与本地合并。


## 2026-09-22：真实验收运行器端口身份校验（active）

### 背景与根因

恢复 `20260921-full-acceptance-idea-r6` 时，隔离后端端口 `8427` 同时出现两个
Uvicorn 监听进程。当前 `assertPortFree` 只在启动前尝试绑定一次端口；Windows 的
地址复用行为下，它不能证明服务启动后响应来自本次子进程，因而测试请求可能落到错误的
隔离运行时。该结果不属于产品失败，不能用于评价编导稿或成片。

### 涉及文件与具体改法

1. `scripts/demo-e2e/environment-manager.mjs`：在现有启动前空闲检查基础上，提供跨平台的
   监听 PID 查询和 `assertPortOwnedByChild`。Windows 读取 `netstat`，Unix 优先读取
   `lsof`；无法观察、无监听、多个监听或 PID 不等于预期子进程时都失败关闭。另提供有界的
   `waitForPortFree`，用于受控重启后等待旧监听真正退出。
2. `scripts/run-video-pipeline-production-e2e.mjs`：后端 healthz 成功后立即验证端口所有者
   唯一性，并在生命周期 ledger 记录端口、子进程 PID 与本次数据库 URL 的不可逆指纹；
   恢复中断任务的后端重启先等待端口释放，再重复同一身份验证。验证失败时不启动前端或
   Playwright。
3. `scripts/__tests__/demo-e2e-environment.test.mjs` 与
   `scripts/__tests__/video-pipeline-production-env-contract.test.mjs`：TDD 覆盖唯一 PID
   成功、多个/错误 PID 拒绝、端口释放等待，以及生产验收 runner 在首次和受控重启后都调用
   身份验证并记录数据库身份。

### 风险与验证

- E2E 运行环境缺少系统监听查询工具时会停止测试，而不是猜测端口安全；这是测试可信度的
  必要取舍，不影响产品运行。
- 不修改产品 API、数据库内容、编导策略、质量门或重试规则。身份指纹只写测试运行 ledger，
  不包含数据库路径、用户内容、提示词或密钥。
- L1：环境管理器与 runner 源码合同测试；L2：脚本测试套件。随后按已登记的 L3 记录，从
  r6 同一隔离数据库的编导稿断点恢复；若环境校验再次失败，停止在启动阶段并保留原断点。


### 实施记录（2026-09-22）

- 已增加启动后监听身份检查：端口必须只有一个 listener，且 PID 必须等于运行器刚启动的子进程；否则在前端和 Playwright 启动前受控失败。
- 已增加受控重启后的端口释放等待，并在运行 ledger 记录端口、进程 ID 与隔离数据库 URL 的 SHA-256 指纹。
- L1/L2：环境管理器、生产运行器合同测试和全量脚本测试通过；上次中断遗留的 Next 临时类型引用已按既有修复工具恢复，未触碰保留 SQLite 或产品状态。


### 范围补充：中断运行的安全接管

本次端口污染因强制停止运行器而留下 `active` 生命周期状态；现有恢复器只有终态才能重开，
会把已经没有进程的保留断点永久卡住。为避免直接修改运行记录作为临时绕过，
`scripts/e2e-run-lifecycle.mjs` 会为新运行记录保存运行器 PID 租约。显式 `--resume` 仅在
记录的持有 PID 已退出时接管遗留 active 状态；持有进程仍存活、缺少显式恢复意图或运行时
数据库/产物不存在时继续失败关闭。对旧记录没有 PID 的情况，只允许显式恢复并写入审计事件。
对应扩展 `scripts/__tests__/e2e-run-lifecycle.test.mjs`：覆盖活租约拒绝、已退出租约接管和
旧 active 记录的显式兼容接管。它不改变产品任务、SQLite 内容或质量门。


### 2026-09-22 失败后修订：监听进程树身份

启动后实测表明 8427 只有一个健康 listener，但 Windows 下 Uvicorn listener PID 是运行器直接
子进程的后代而非同一 PID。此前“PID 必须相等”的校验把这一受控进程树误判为端口污染；
它没有进入产品或供应商阶段，r6 继续复用。

修复收敛为 `environment-manager.mjs` 的通用进程树校验：跨平台读取 PID/PPID 表，唯一 listener
只要是运行器启动根进程或任意后代即可通过；多个 listener、没有 listener、无法读取进程树或
listener 不在该树中一律失败关闭。运行 ledger 同时记录根 PID 与 listener PID。测试覆盖直接
子进程、受控后代、错误树和多 listener；不按 Uvicorn、端口或 r6 样本定制。验证通过后才再次
恢复同一已确认的 `director_generation` 断点。


### 2026-09-22 失败后修订：运行期数据库身份作用域

进程树校验已通过后，启动阶段暴露数据库指纹辅助函数越过 `try` 内局部 `databaseUrl` 的作用域，
因此在写入 lifecycle ledger 时抛出 `ReferenceError`。修复不改变身份内容：在数据库 URL 建立后
计算 SHA-256 指纹，并把它作为 `waitForVerifiedBackend` 的显式参数传入；辅助函数不再捕获
运行期局部变量。生产运行器合同测试锁定该参数边界和首次/重启调用，随后恢复 r6。

### 2026-09-23 本地分支合并回归

合并外部视频对话与桌面工作区分支后，完整前端回归暴露 6 项合同不一致。根因是旧主线测试仍引用
已由桌面工作区设计删除的素材就绪条、旧侧栏网格行数、旧素材卡圆角和旧产物标题拼接方式；同时
`globals.css` 保留了一段更早的 `.shadcn-prototype-conversation-main` 定义，遮蔽了后续权威的
双列项目行合同。

本轮只删除这段重复旧样式，并把测试改为验证当前可见结构：产物卡本身位于建议按钮之前、失败
修改仍保留可打开的稳定产物，以及新项目页不再引用已删除的素材就绪条。不改变播放器受保护
外壳、视频画布比例或控件合同。风险是弱化文本拼接断言后漏掉关键状态，因此保留产物类型、完成
状态、版本号、链接和 DOM 顺序的独立断言。先运行 4 个失败文件，再运行 `test:fast`、类型、lint、
agent/docs 检查和受保护播放器三项合同检查。

展示区断点复测随后只在 Windows 截图基线发现 2 项尺寸差异。当前权威桌面规格已将三栏布局的
侧栏固定为 `264px`，相较旧基线的 `294px` 恰好释放 30px 给预览区；实际截图中的白色外壳、
1px 边框、20px 圆角、7px 内边距、双层阴影、44px 播放按钮和 3px 进度轨均保持受保护合同，
结构合同与样式测试也已通过。另一个时长差异来自当前三段成片的真实总时长 9 秒，旧基线仍为
早期 3 秒占位状态。因而本轮不改产品样式或媒体行为，只将
`video-preview-shell-win32.png` 与 `video-preview-storyboard-shell-win32.png` 同步为当前权威
布局的实测截图，并从展示区失败断点复测。若出现新的结构、交互或视觉差异，立即停止，不扩大
基线更新范围。
