import assert from "node:assert/strict";
import test from "node:test";

import { assertVideoPreviewContract } from "../check-video-preview-contract.mjs";

const approved = {
  css: `
.shadcn-prototype-preview-player {
  border: 1px solid #eae7e1;
  border-radius: 20px;
  background: #ffffff;
  box-shadow: 0 2px 6px rgba(32, 31, 30, 0.05), 0 16px 40px rgba(32, 31, 30, 0.07);
  padding: 7px;
}
.shadcn-prototype-preview-player.ratio-landscape .shadcn-prototype-preview-player-screen { aspect-ratio: 16 / 9; }
.shadcn-prototype-preview-player.ratio-portrait .shadcn-prototype-preview-player-screen { aspect-ratio: 9 / 16; }
.shadcn-prototype-project-preview { border: 1px solid #eae7e1; border-radius: 20px; background: #ffffff; box-shadow: 0 2px 6px rgba(32, 31, 30, 0.05), 0 16px 40px rgba(32, 31, 30, 0.07); padding: 7px; }
.shadcn-prototype-preview-player-screen > svg { width: 16px; height: 16px; padding: 14px; transition: transform .15s ease; }
.shadcn-prototype-preview-player-screen:hover > svg { transform: translate(-50%, -50%) scale(1.07); }
.shadcn-prototype-preview-player .shadcn-prototype-project-preview-controls { padding: 8px 6px 4px; }
.shadcn-prototype-project-preview-controls input[type="range"] { appearance: none; height: 3px; min-height: 3px; padding: 0; border-radius: 3px; background: linear-gradient(90deg, var(--sp-ai-a) 0%, var(--sp-ai-b) var(--preview-progress), var(--sp-muted) var(--preview-progress), var(--sp-muted) 100%); }
.shadcn-prototype-project-preview-controls input[type="range"]::-webkit-slider-thumb { appearance: none; width: 0; height: 0; }
`,
  preview: `<VideoPreviewPlayer /><Play size={16} style={{ "--preview-progress": "0%" }} />`,
  design: `
<!-- video-preview-shell-contract:v1 -->
播放器外壳使用白底、1px solid #eae7e1、20px 圆角、7px 内边距。
媒体画布内部可以是黑底、无边框；只有用户在当次任务中明确批准才能修改。
`,
  agentGuide: `
#### 视频预览壳不可回退门禁
禁止只修改实现和测试期望。必须运行 check:video-preview-contract 和 test:display-coverage。
`,
  e2e: `
function environmentSnapshotName(name) {
  if (!process.env.CI) return name;
  return name.replace(/\\.png$/, "-ci.png");
}
async function expectApprovedVideoPreviewShell() {}
await expect(player).toHaveScreenshot(environmentSnapshotName("video-preview-shell.png"));
await expect(storyboard).toHaveScreenshot(environmentSnapshotName("video-preview-storyboard-shell.png"));
`,
  snapshotExists: true,
  storyboardSnapshotExists: true,
  ciSnapshotExists: true,
  storyboardCiSnapshotExists: true,
};

test("accepts the approved video preview shell contract", () => {
  assert.doesNotThrow(() => assertVideoPreviewContract(approved));
});

test("rejects a frameless black player even when other contract files exist", () => {
  assert.throws(
    () => assertVideoPreviewContract({
      ...approved,
      css: `.shadcn-prototype-preview-player { border: 0; background: #101514; box-shadow: none; padding: 0; }`,
    }),
    /approved white card shell/,
  );
});

test("rejects a frameless storyboard preview path", () => {
  assert.throws(
    () => assertVideoPreviewContract({
      ...approved,
      css: approved.css.replace(
        ".shadcn-prototype-project-preview { border: 1px solid #eae7e1; border-radius: 20px; background: #ffffff; box-shadow: 0 2px 6px rgba(32, 31, 30, 0.05), 0 16px 40px rgba(32, 31, 30, 0.07); padding: 7px; }",
        ".shadcn-prototype-project-preview { border: 0; background: transparent; box-shadow: none; padding: 0; }",
      ),
    }),
    /storyboard preview must keep the approved white card shell/,
  );
});

test("rejects putting the media ratio on the shell that also contains controls", () => {
  assert.throws(
    () => assertVideoPreviewContract({
      ...approved,
      css: approved.css.replace(
        ".shadcn-prototype-preview-player.ratio-landscape .shadcn-prototype-preview-player-screen { aspect-ratio: 16 / 9; }",
        ".shadcn-prototype-preview-player.ratio-landscape { aspect-ratio: 16 / 9; }",
      ),
    }),
    /media screen rather than the shell plus controls/,
  );
});

test("rejects a detached browse-player resize region", () => {
  assert.throws(
    () => assertVideoPreviewContract({ ...approved, preview: `<VideoPreviewResizer value={previewHeight} />` }),
    /detached resizer region/,
  );
});

test("rejects a contract that omits the explicit user approval gate", () => {
  assert.throws(
    () => assertVideoPreviewContract({
      ...approved,
      design: `<!-- video-preview-shell-contract:v1 -->\n播放器外壳使用白底。`,
    }),
    /explicit user approval/,
  );
});

test("rejects browser coverage without a visual baseline", () => {
  assert.throws(
    () => assertVideoPreviewContract({
      ...approved,
      e2e: `async function expectApprovedVideoPreviewShell() {}`,
    }),
    /deterministic screenshot baseline/,
  );
});

test("rejects a missing screenshot baseline file", () => {
  assert.throws(
    () => assertVideoPreviewContract({ ...approved, snapshotExists: false }),
    /screenshot baseline file must exist/,
  );
});

test("rejects a missing storyboard screenshot baseline file", () => {
  assert.throws(
    () => assertVideoPreviewContract({ ...approved, storyboardSnapshotExists: false }),
    /storyboard screenshot baseline file must exist/,
  );
});

test("rejects a missing CI screenshot baseline file", () => {
  assert.throws(
    () => assertVideoPreviewContract({ ...approved, ciSnapshotExists: false }),
    /CI screenshot baseline file must exist/,
  );
});

test("rejects a missing CI storyboard screenshot baseline file", () => {
  assert.throws(
    () => assertVideoPreviewContract({ ...approved, storyboardCiSnapshotExists: false }),
    /CI storyboard screenshot baseline file must exist/,
  );
});
