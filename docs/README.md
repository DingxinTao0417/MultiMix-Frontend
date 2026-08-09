# MultiMix Frontend Docs

前端文档只描述工作台产品、UI、adapter、路由、环境变量和部署。跨仓库权威入口见 `MultiMix-Backend/docs/README.md`。

- `MULTIMIX_WORKSPACE_DESIGN.md`：前端工作台产品定位、交互规则、资源库分类和数据边界。
- `API.md`：adapter、类型、helper、测试 fixture 边界、URL、环境变量和后端接入契约。
- `DEPLOYMENT.md`：Vercel/Railway 部署与本地端到端冒烟。

前端专属缺口、整改范围和验证状态记录在 `plans/active/`；跨端或后端任务见 `MultiMix-Backend/docs/plans/active/`。已完成计划进入各自仓库的 `archive/`，不维护容易与代码漂移的第二份 GAPS 清单。

前端 `AGENTS.md` 由 `../CLAUDE.md` 生成；修改入口规则时先改 `CLAUDE.md`，再运行 `npm run sync:agents` 和 `npm run check:agents`。
