# 产品设计文档去重与现行规则校正

> Status: archived
> Owner: frontend
> Last verified: 2026-10-11

## 背景与根因

工作台主文档持续追加决策后，形成了重复的决策清单、日期附录和跨文档的双份细则。2026-07-08 的 V3 设计仍标记为 current，其中部分页面和进度描述被后续设计取代；附件格式与预览缺口描述也出现了事实冲突。此轮只清理文档，不改变产品行为、原型、实现或播放器外壳合同。

## 涉及文件与关键位置

- `docs/MULTIMIX_WORKSPACE_DESIGN.md:143,304-317,447-487,571-670`：附件格式、视频对比、重复决策、历史附录和非产品信息。
- `docs/specs/ui/agentic-workbench-design.md:73-94,130-141,162-238`：旧导航、旧进度、已废止就绪横条及实施记录。
- `docs/specs/ui/video-artifact-browse-and-edit-states.md:49-60,103-118`：对比细则权威承载处、图形主画面与待补素材状态。
- `docs/specs/ui/product-positioning.md:154-170,183-201`：历史同步记录、能力状态及过期实施判断。
- `docs/specs/ui/README.md:9`、`docs/specs/ui/prototypes/README.md:8`、`docs/specs/ui/prototypes/current/README.md:10` 与前端文档入口：规范归属说明。

## 具体改法

1. 以当前前后端上传格式和跨端素材合同为依据，校正附件与视频预览的过期描述。
2. 将 V3 文件收敛为视觉设计规范：改正旧导航、进度和就绪横条；删除已完成的实施路径及可从归档计划读取的旧保全/降级记录，保留现行视觉规则。
3. 主文档的版本对比只保留用户可见模式和专项规格链接；压缩重复决策清单；把日期附录中仍独有的规则并回正文后删去附录。`video-preview-shell-contract:v1` 原文不动。
4. 产品定位文件只保留当前定位、边界与证据等级；历史同步过程引用归档计划和 QA。修正“开放问题”中已决定的陈述，更新必要入口链接。

执行中范围补充：当前原型目录的两个入口仍将旧 V3 文件写成唯一规范，故同步更新 `docs/specs/ui/README.md` 与 `docs/specs/ui/prototypes/current/README.md`，不改原型画面。

完成后将本计划移至 `docs/archive/plans/2026-10-11-product-design-doc-consolidation.md`，保留本轮变更与检查记录。

## 风险与取舍

- 双份描述可能含有独有细节；删除前逐条核对并迁入唯一现行段落或保留引用。
- 当前原型和受保护的播放器外壳合同继续作为验收依据，不因去重变更视觉方向。
- 文档清理不等于能力已通过新的真实用户验证；已有工程/生产证据与待验证项保持区分。

## 验证方式

- 静态核对各文件之间的文档链接、状态头和唯一权威段落。
- 运行 `npm --prefix MultiMix-Frontend run docs:check`。
- 运行 `npm --prefix MultiMix-Frontend run check:video-preview-contract`，确认受保护合同未受影响。无需启动 E2E 环境或临时数据库；本轮没有产品代码或 UI 变化。

## 任务

- [x] T1：建立计划与开发占用，核定文档清理边界。
- [x] T2：校正过期事实和 V3 当前规则冲突。
- [x] T3：合并重复段落并更新当前文档入口。
- [x] T4：运行文档与播放器合同检查，复核最终 diff，释放占用。

## 完成结果

- 校正当前附件格式、图形主画面预览、V3 视觉规范与进度/资源库的冲突说明；把版本对比细则、历史实施记录和重复决策各归入唯一现行位置。
- 保留 `video-preview-shell-contract:v1` 原文、当前原型与实现；没有修改产品代码、截图基线或商业材料。
- `npm --prefix MultiMix-Frontend run docs:check`、`npm --prefix MultiMix-Frontend run check:video-preview-contract`、`git diff --check` 均通过。没有 UI/代码变更，因此未启动 E2E 环境或临时数据库。
- 开发占用核对通过并已释放；本计划已归档，归档后的文档检查见最终验证。
