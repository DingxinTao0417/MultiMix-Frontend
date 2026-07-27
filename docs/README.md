# MultiMix Frontend Docs

前端文档只描述工作台产品、UI、adapter、路由、环境变量和部署。跨仓库权威入口见工作区根目录 `../../docs/README.md`。

- `MULTIMIX_WORKSPACE_DESIGN.md`：前端工作台产品定位、交互规则、资源库分类和数据边界。
- `API.md`：adapter、类型、helper、测试 fixture 边界、URL、环境变量和后端接入契约。
- `DEPLOYMENT.md`：Vercel/Railway 部署与本地端到端冒烟。

当前缺口、整改范围和验证状态统一记录在工作区根目录 `../../docs/plans/active/`。已完成或过期的审查进入 `../../docs/archive/`；不在前端仓库长期维护容易与代码漂移的第二份 GAPS 清单。

前端 `AGENTS.md` 由 `../CLAUDE.md` 生成；修改入口规则时先改 `CLAUDE.md`，再运行 `npm run sync:agents` 和 `npm run check:agents`。
