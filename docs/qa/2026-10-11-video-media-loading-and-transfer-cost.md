# 视频加载速度与转送成本优化验证

> Status: qa
> Owner: frontend
> Last verified: 2026-10-11

## 结论范围

本轮用户要求优化速度和转送成本。首版2ca92f8已推送并发布至正式域名，但发布核验发现地域设置未生效，正在修正；一次生产冷预览尚未开始。L1/L2及完整前端检查已通过，不宣称真实加载已加速或账单已下降。当前计划完成4/5，用户已明确授权推送、发布及30请求上限的一次现有工程只读复测。

实施依据：[当前优化计划](../plans/active/2026-10-11-video-media-loading-and-transfer-cost.md)。前轮实际媒体证据见[超时修复验证](2026-10-10-video-media-body-timeout.md)。

## 基线与目标

Chrome 已有完整媒体：视频 36,077,615 bytes / 122,402 ms，音频 765,203 bytes / 1,360 ms。对应后端视频 35 GET/206，累计请求时长 13,112 ms；计时范围差异不能单独归因。

候选离线相同长度字节夹具完整拼装正确：默认 3 MiB，12 个闭合范围 GET。冷读字节不变，仅少 65.7% 请求。同编辑上下文内缓存命中仍以当前签名向后端读取 1 字节核验，总量/MIME/首字节与完整缓存一致后复用。该比例只适用于命中场景的正文传输，不是月账单节省率。

官方已发布部署元数据 regions=[iad1]，唯一当前 Railway API=sin；候选单媒体函数设 sin1，尚未确认生产产物生效。

## 发布地域核验与修正

2ca92f800b05f614aeeac0e41ffe8d067c0f0e56推送后HEAD/origin/main/真实远端refs相等、ahead/behind=0/0、无冲突；Vercel dpl_CghyeCJtFLWRYYzYA5tCAmVKwEse READY并接正式域名。无token HEAD返回405，relay在取token/后端fetch之前拒绝，x-vercel-id提取地域hnd1::iad1；部署元数据iad1。本轮0新后端HTTP、0完整媒体准备，尚未消费一次冷读。

初版Node.js路由使用Edge-only preferredRegion，本地manifest sin1不能证明真实Node部署配置。修正为vercel.json仅媒体函数glob的regions=[sin1]，同轮删除无效preferredRegion，并禁止项目全局regions字段。配置缺失时新合同测试1失败/33通过，修正后34通过；仍需实际发布响应核验。正式参考：[官方单函数地域](https://vercel.com/docs/functions/configuring-functions/region)、[官方Node迁移说明](https://github.com/vercel/vercel-plugin/blob/main/skills/vercel-functions/SKILL.md)。

账本复核：截至2026-10-11T00:49:00Z，前次1251基础上再纳入70条全部GET/OPTIONS，保守1321/1482、余161。这些包含用户/其他页面背景请求，不全部归为本会话；本轮最多30新增后端HTTP，仍只做一次现有工程冷预览。

## L1 记录

独立候选基于已发布前端及文档提交 9798a059，根共享 WIP 保留；没有外部模型或真实媒体请求。

- T2 红：新测试三项失败，实际 35 次请求、3 MiB 被拒绝、地域未配置。最小实现后 bootstrap + relay 共 66 项通过。
- T3 红：缓存复用七项失败；实现后新增核验、拒绝后清除且无重试、文件身份/用户隔离、重初始化复用及 dispose 清理测试通过。
- 当前命令：`npx vitest run editor-engine/vendor/bootstrap.test.ts lib/__tests__/private-media-cache.test.ts lib/__tests__/video-media-relay.test.ts app/editor/__tests__/editor-lifecycle.test.ts`，4 文件 / 100 项通过，0 生产外部调用。
- 容量边界：64 MiB / 8 项、固定 5 分钟且不超过授权期限；用户切换及 dispose 前的在途 scope 不能回写缓存。缓存只在当前编辑上下文，刷新或重建 iframe 不保证复用。
- 既有 200 静态消费者、完整 File、正文无进展/总期限、206/长度/MIME/连续范围校验保留；relay 不开放无界 200、任意 URL 或公共缓存。

## 剩余验证

L2 已运行相关 8 文件 / 244 项（bootstrap/buildProject/serializeProject、cache/relay、生命周期/BGM/独立导出消费者）；复核中新增 cached-export 非法配置测试先红后绿、dispose 核验中止与半文件不缓存用例。最终候选 typecheck、lint、check:agents、build 及 test:fast（160 文件 / 1689 项、demo 8 项、脚本 260 项通过 / 1 跳过）全通过，构建函数配置已输出媒体 regions=[sin1]。根八个媒体源/测试文件与最终检查候选哈希一致；git diff --check通过。没有修改播放器样式、用户原件、字幕、后端或数据库，没有启动本地服务或测试数据库。这些仍只是离线及本地构建证据。

生产 L3 已获本轮明确授权：复用指纹一致且普通用户可只读访问的现有工程，最多一次普通预览冷读，新增后端HTTP≤30；共享账本1251/1482（2026-10-10T18:51:05Z），字幕会话确认其后0新增应用HTTP。不恢复归档项目，不新增ASR/视频生成、字幕或作品写入；预算或上游指纹不足立即停止。发布失败或播放回归恢复发布前正式域名所指dpl_Hg1q8Eo3Zt8CmvEaMAaynVzP7mam（9798a059）。

产品入口核对：浏览预览重试/切换编辑器会重建 iframe，当前缓存不能跨这些上下文。实际消费方是同一编辑器的素材明确修改后工程刷新；本轮不为验收缓存而修改作品或调用用户不可达的内部函数。因此缓存热读仅有离线合同证据，实际命中率与全页面复用收益未验证。

读取链路核对：当前 API 及前轮生产基线均用 `ArtifactStore.stat` + `stream_range`；Supabase stat 为 1 字节探测，正文按要求闭合范围读取，不读取完整原片再切片。命中核验返回浏览器 1 字节；若源在 Supabase，存储侧还会有 stat 的 1 字节和请求/响应头开销，不能把它写成所有链路合计只有 1 字节或直接换算账单。
