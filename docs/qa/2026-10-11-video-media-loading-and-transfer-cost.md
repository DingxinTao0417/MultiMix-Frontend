# 视频加载速度与转送成本优化验证

> Status: qa
> Owner: frontend
> Last verified: 2026-10-11

## 结论范围

本轮优化代码2c2dc9c已推送并发布至正式域名，媒体Node函数实际在sin1。按用户当次授权完成一次现有工程完整冷准备及首帧：视频75,542ms，对照前轮同一内置浏览器118,389ms，单次少36.19%；视频请求35→12，正文仍36,077,615 bytes。L1/L2及完整前端检查通过。最终19/30新增后端HTTP，没有作品/字幕/工程写入。实际播放及缓存命中没有新增生产证明，账单收益未统计。

历史实施记录：[已归档优化计划](../archive/plans/2026-10-11-video-media-loading-and-transfer-cost.md)。前轮实际媒体证据见[超时修复验证](2026-10-10-video-media-body-timeout.md)。本轮安全数值证据见[冷准备与预算记录](evidence/2026-10-11-video-media-loading-and-transfer-cost/cold-preview.json)及[离线验证与源文件哈希](evidence/2026-10-11-video-media-loading-and-transfer-cost/offline-verification.json)。

## 基线与目标

Chrome 已有完整媒体：视频 36,077,615 bytes / 122,402 ms，音频 765,203 bytes / 1,360 ms。对应后端视频 35 GET/206，累计请求时长 13,112 ms；计时范围差异不能单独归因。

候选离线相同长度字节夹具完整拼装正确：默认 3 MiB，12 个闭合范围 GET。冷读字节不变，仅少 65.7% 请求。同编辑上下文内缓存命中仍以当前签名向后端读取 1 字节核验，总量/MIME/首字节与完整缓存一致后复用。该比例只适用于命中场景的正文传输，不是月账单节省率。

初版媒体函数仍在iad1；地域整改后的真实响应为hnd1::sin1，唯一当前Railway API在sin。项目全局元数据不代表单媒体函数地域，生产结论以已核对函数响应为准。

## 发布地域核验与修正

2ca92f800b05f614aeeac0e41ffe8d067c0f0e56推送后HEAD/origin/main/真实远端refs相等、ahead/behind=0/0、无冲突；Vercel dpl_CghyeCJtFLWRYYzYA5tCAmVKwEse READY并接正式域名。无token HEAD返回405，relay在取token/后端fetch之前拒绝，x-vercel-id提取地域hnd1::iad1；部署元数据iad1。本轮0新后端HTTP、0完整媒体准备，尚未消费一次冷读。

初版Node.js路由使用Edge-only preferredRegion，本地manifest sin1不能证明真实Node部署配置。已修正为vercel.json仅媒体函数glob的regions=[sin1]，同轮删除无效preferredRegion，并禁止项目全局regions字段。配置缺失时新合同测试1失败/33通过，修正后34通过；typecheck/lint/check:agents/build再次通过。2c2dc9c9db9f378521d55e5851d54e1d46d44ee4推送后HEAD/origin/main/远端main相等、ahead/behind=0/0、无冲突；dpl_FrQG2AX4hKZ9n4BAYkLWcpmDTbCD READY并接正式域名，无token HEAD返回405、0后端调用，地域hnd1::sin1。正式参考：[官方单函数地域](https://vercel.com/docs/functions/configuring-functions/region)、[官方Node迁移说明](https://github.com/vercel/vercel-plugin/blob/main/skills/vercel-functions/SKILL.md)。

账本复核：截至2026-10-11T00:49:00Z，前次1251基础上再纳入70条全部GET/OPTIONS，保守1321/1482；这些包含其他页面背景请求，不全部归为本会话。00:49:00Z–01:13:22Z新增19 HTTP，最终1340/1482、余142，本轮19/30。15为工程/媒体读取，4为产品自动统计（OPTIONS1/POST3），所有POST均为product-events，没有工程/作品/字幕写入。USD1为共享上限，实付费用未确认。

## 本轮生产 L3 实测

| 项目 | 结果 |
| --- | --- |
| 视频完整准备 | 36,077,615 bytes；75,542ms；12 GET/206；cache=miss |
| 音频完整准备 | 765,203 bytes；771ms；1 GET/206；cache=ineligible |
| 产品就绪 | metadata HTTP200；UI ready，真实首帧正常 |
| 同浏览器基线 | 118,389ms；本次减少42,847ms / 36.19%，只是一组冷读对照 |
| 后端视频计时 | 12个206累计7,249ms，单个475–878ms；不同于浏览器完整接收时间 |
| 请求及预算 | 视频35→12（少65.7%请求）；本轮19/30；共享1340/1482 |
| 写入/付费链路 | 0作品/字幕/工程写入；0新ASR、模型、视频生成和导出 |

复用前轮现有原片、音频与工程，上游没有改动。原片既有checkpoint及原件大小保持，产品接口正常重新签发当前登记身份的授权，每块仍由现有后端校验归属、引用、身份及存储stat，浏览器严格校验206/范围/总量/MIME/EOF。此次没有另算原片SHA，不能把长度一致写成新做的逐字节SHA对照。

01:01:47Z首次页面连接超时发生在应用加载前，后台0请求/0媒体。普通正式文档返回200后，只做一次有上限的页面恢复，01:07:26.842Z挂载，01:08:44.502Z ready，完成唯一冷读，无媒体重试。第4到第5视频响应相隔约60.1秒；这一等待尚未分解，不能把全部浏览器差额归因跨区或RTT，也不能说2–4分钟等待完全解决。

首帧由产品菜单Save snapshot保存本地，SHA256为86fc7e0b73289d9917f102431cef7478ce3ea6f4cff37435afdebe3c06e10de9，画面不上传Git。嵌入preview-only画布的播放键由外层工作台控制，当前直接入口没有普通同页播放按钮，空格无画面推进证据。为守住单次冷读，不新开外层播放器，不调用内部函数/消息：本轮覆盖完整准备/首帧，实际播放仍沿用前轮证据，不能称本轮播放复验通过。成功测试临时页已关闭。

## L1 记录

独立候选基于已发布前端及文档提交 9798a059，根共享 WIP 保留；没有外部模型或真实媒体请求。

- T2 红：新测试三项失败，实际 35 次请求、3 MiB 被拒绝、地域未配置。最小实现后 bootstrap + relay 共 66 项通过。
- T3 红：缓存复用七项失败；实现后新增核验、拒绝后清除且无重试、文件身份/用户隔离、重初始化复用及 dispose 清理测试通过。
- 当前命令：`npx vitest run editor-engine/vendor/bootstrap.test.ts lib/__tests__/private-media-cache.test.ts lib/__tests__/video-media-relay.test.ts app/editor/__tests__/editor-lifecycle.test.ts`，4 文件 / 100 项通过，0 生产外部调用。
- 容量边界：64 MiB / 8 项、固定 5 分钟且不超过授权期限；用户切换及 dispose 前的在途 scope 不能回写缓存。缓存只在当前编辑上下文，刷新或重建 iframe 不保证复用。
- 既有 200 静态消费者、完整 File、正文无进展/总期限、206/长度/MIME/连续范围校验保留；relay 不开放无界 200、任意 URL 或公共缓存。

## L2 与剩余验证

L2 已运行相关 8 文件 / 244 项（bootstrap/buildProject/serializeProject、cache/relay、生命周期/BGM/独立导出消费者）；复核中新增 cached-export 非法配置测试先红后绿、dispose 核验中止与半文件不缓存用例。最终候选 typecheck、lint、check:agents、build 及 test:fast（160 文件 / 1689 项、demo 8 项、脚本 260 项通过 / 1 跳过）全通过，构建函数配置已输出媒体 regions=[sin1]。根八个媒体源/测试文件与最终检查候选哈希一致；git diff --check通过。没有修改播放器样式、用户原件、字幕、后端或数据库，没有启动本地服务或测试数据库。这些仍只是离线及本地构建证据。

生产L3已按当次授权完成上述有限范围；没有恢复归档对话、修改作品或放宽质量门，未执行新导出/全链路。预先记录的回退点为发布前正式域名所指dpl_Hg1q8Eo3Zt8CmvEaMAaynVzP7mam（9798a059），没有此次媒体冷准备/首帧回归而未触发回退。

产品入口核对：浏览预览重试/切换编辑器会重建 iframe，当前缓存不能跨这些上下文。实际消费方是同一编辑器的素材明确修改后工程刷新；本轮不为验收缓存而修改作品或调用用户不可达的内部函数。因此缓存热读仅有离线合同证据，实际命中率与全页面复用收益未验证。

读取链路核对：当前 API 及前轮生产基线均用 `ArtifactStore.stat` + `stream_range`；Supabase stat 为 1 字节探测，正文按要求闭合范围读取，不读取完整原片再切片。命中核验返回浏览器 1 字节；若源在 Supabase，存储侧还会有 stat 的 1 字节和请求/响应头开销，不能把它写成所有链路合计只有 1 字节或直接换算账单。
