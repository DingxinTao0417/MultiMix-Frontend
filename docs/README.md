# MultiMix Frontend Docs

> Status: current
> Owner: frontend
> Last verified: 2026-10-10

前端文档只描述工作台产品、UI、adapter、路由、环境变量和部署。跨仓库权威入口见[后端文档地图](../../MultiMix-Backend/docs/README.md)，共享规则以该入口列出的authority为准。

- `MULTIMIX_WORKSPACE_DESIGN.md`：前端工作台的当前产品行为、交互规则、资源库和播放器外壳合同。
- `specs/ui/product-positioning.md`：对话式 AI 短视频定位、统一文案，以及用户任务、产品能力、底层技术、技术壁垒与验证证据的产品地图。
- `specs/ui/multimix-logo-identity.md`：LOGO 权威规范。概念与颜色、纯图标与 badge 的构图基准、使用规则与最小尺寸、交付文件清单、已否决的设计方向，以及产品内品牌展示版导出。改动 `public/brand/` 下任何资产前必读。
- `specs/ui/agentic-workbench-design.md` 与 `specs/ui/prototypes/current/`：当前视觉语言和可点击原型；页面行为以工作台设计及专项规格为准。
- `API.md`：adapter、类型、helper、测试 fixture 边界、URL、环境变量和后端接入契约。
- [视频清晰度审查与确认后增强](../../MultiMix-Backend/docs/specs/video-clarity-review-and-enhancement.md)：跨端统一产品规格，覆盖建议/确认、前后对比与明确采用；设计已确认，专项能力尚未实现/验收。
- `DEPLOYMENT.md`：Vercel/Railway 部署与本地端到端冒烟。

前端专属缺口、整改范围和验证状态记录在 `plans/active/`；后端与跨端计划统一见[后端active目录](../../MultiMix-Backend/docs/plans/active/)。已完成计划进入各自对应的 `archive/`，不维护容易与代码漂移的第二份 GAPS 清单。

前端 `AGENTS.md` 由 `../CLAUDE.md` 生成；修改入口规则时先改 `CLAUDE.md`，再运行 `npm run sync:agents` 和 `npm run check:agents`。
