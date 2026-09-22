# 工作台产物导航与展示区收敛

> Status: active-plan
> Owner: frontend
> Last verified: 2026-09-22

## 背景与根因

桌面工作台应保持在一个视口内，聊天和右侧展示区只在各自内容超高时独立滚动。当前右侧将创意方向选择器作为产物展示区的额外网格行；它既占用结果空间，又带有自己的滚动面，用户会看到不属于结果的空白滚动。

对话产物卡的通用 `assistant span` 样式覆盖了卡片内部的图标和文字布局，造成图标/文本排列不稳定。卡片目前也只使用类型图标，未消费已有的图片或视频代表帧。

创意方向属于助手与用户对编导稿的讨论和选择，不是展示区里的一级结果。现行前端设计文档 §5 的“右侧默认显示”约定与本次用户确认的产品方向冲突，需同步更正。

## 涉及文件与关键位置

- `app/globals.css`：工作台滚动边界、对话产物卡和创意方向样式。
- `app/assets/components/conversation-studio.tsx`：按生成该产物的助手消息显示产物卡和创意方向选择器。
- `app/assets/components/product-workspace.tsx`：移除右侧展示区的创意方向选择器。
- `app/assets/components/creative-direction-selector.tsx`：保持既有选择与请求语义，可在聊天消息中复用。
- `app/assets/components/assets-workspace-client.tsx`：把“应用创意方向”回调传给聊天区。
- `app/assets/__tests__/creative-direction-selector.test.tsx`：覆盖位置迁移和不重复渲染。
- `docs/MULTIMIX_WORKSPACE_DESIGN.md`、`docs/specs/ui/prototypes/current/screens/workspace-*.html`：更新权威交互与当前原型。

## 具体改法

1. 保持桌面外层工作台锁定视口；聊天记录和右侧长内容继续使用各自的 `overflow: auto`。移除创意方向在右侧造成的额外网格行和嵌套滚动。不得取消聊天历史或超长结果的必要局部滚动。
2. 将助手消息的通用文字样式收窄到消息正文，避免覆盖产物卡内部的缩略图、文字堆叠和箭头。卡片的图标/缩略位保持方形、居中且不参与文本排版。
3. 为产物卡增加只消费真实预览的缩略位：图片使用已生成图片预览；视频优先使用已有代表帧/海报。缺失或加载失败时回退类型图标，禁止客户端伪造缩略图或请求额外生成。
4. 在生成编导稿的助手消息中、产物卡之后渲染创意方向选择器；默认显示当前采用方向，展开与“应用此方向”沿用原候选 ID + fingerprint 请求。右侧只展示当前编导稿或视频结果，不再渲染选择器。
5. 将设计文档和两个当前工作台原型改为“创意方向在对应聊天消息中”，并保留“展示区只显示当前产物”的边界。

## 风险与取舍

- 只展示已有代表帧，部分文本或尚未生成媒体的产物仍显示类型图标；这是比伪造预览更可信的降级。
- 不改变后端创意方向候选、选择请求或 fingerprint 契约，只迁移前端入口位置。
- 不改变窄屏自然页面滚动规则；本次“无主页面滚动”限定桌面工作台。

## 验证方式

- 单元测试：创意方向只在聊天内显示，应用回调携带原 ID 和 fingerprint，右侧不重复显示。
- 样式/静态测试：产物卡文字与缩略位布局不被助手文本样式覆盖；桌面外层仍为视口边界。
- 运行 `npm run test -- creative-direction-selector`、相关展示区测试、`npm run docs:check`、`npm run lint`、`npm run typecheck`；必要时运行浏览器截图/E2E 验证桌面滚动边界和缩略图回退。
