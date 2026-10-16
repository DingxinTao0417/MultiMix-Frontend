# MultiMix Frontend Docs

> Status: current
> Owner: frontend
> Last verified: 2026-10-16（设计文档清理、规则归并与入口核对）

前端文档只描述工作台产品、UI、adapter、路由、环境变量和部署。跨仓库权威入口见[后端文档地图](../../MultiMix-Backend/docs/README.md)，共享规则以该入口列出的authority为准。

- `MULTIMIX_WORKSPACE_DESIGN.md`：前端工作台的当前产品行为、交互规则、资源库和播放器外壳合同。
- `specs/ui/product-positioning.md`：唯一产品总纲，维护定位、用户与市场、首发三类视频、输入与操作、可信要求及暂缓边界；实施状态和验收证据由计划与QA维护。
- `specs/ui/multimix-logo-identity.md`：LOGO 权威规范。概念与颜色、纯图标与 badge 的构图基准、使用规则与最小尺寸、交付文件清单、已否决的设计方向，以及产品内品牌展示版导出。改动 `public/brand/` 下任何资产前必读。
- `specs/ui/agentic-workbench-design.md` 与 `specs/ui/prototypes/current/`：当前视觉语言、对话加载/回复动效和可点击原型；页面行为以工作台设计及专项规格为准，探索材料按原型探索索引区分历史与后续方案。
- `API.md`：adapter、类型、helper、运行时真实数据与加载/空/错误/未配置状态、测试 fixture 边界、URL、环境变量和后端接入契约。
- [视频清晰度审查与增强（暂停）](../../MultiMix-Backend/docs/specs/video-clarity-review-and-enhancement.md)：模型未指定，审查面板及增强确认入口关闭；历史媒体保留，未发布。历史软件6/7不代表真实增强验收通过，重新开启须新决定。
- [视频内容局部修改](../../MultiMix-Backend/docs/specs/video-element-editing-future-capability.md)：口型、烧录文字/Logo、改色、动作迁移、换人和复杂物品的分批验证路线、开源候选、工具分工及统一确认/候选应用/恢复；不自动扩大首发P0或销售承诺。
- `DEPLOYMENT.md`：Vercel/Railway 部署与本地端到端冒烟。

- [历史视频通知与下载](plans/active/2026-09-26-historical-video-notice-and-download.md)：历史通知的离线验证已记录，产品下载验收因素材质量失败停止，仍未完成；原会话接续，本轮只保存文档。
- [加载间隔诊断（已取消）](qa/2026-10-11-video-media-gap-diagnostic.md)与[归档计划](archive/plans/2026-10-11-video-media-sixty-second-gap.md)：2026-10-12用户取消，历史3/5不代表性能问题已修复。
- [文档证据与恢复库存](../../MultiMix-Backend/docs/qa/2026-10-13-documentation-inventory-closeout.md)：前端15条文档记录、2份stash及.tmp清点；其他会话代码和工作树保留。

前端专属缺口、整改范围和验证状态记录在 `plans/active/`；后端与跨端计划统一见[后端active目录](../../MultiMix-Backend/docs/plans/active/)。已完成计划进入各自对应的 `archive/`，不维护容易与代码漂移的第二份 GAPS 清单。

前端 `AGENTS.md` 是规则源，`CLAUDE.md` 只通过 `@AGENTS.md` 导入它；修改入口规则时只改 `AGENTS.md`，再运行 `npm run check:agents` 校验入口结构。
