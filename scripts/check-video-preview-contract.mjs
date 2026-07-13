import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function requireContract(condition, message) {
  if (!condition) throw new Error(`Video preview contract violation: ${message}`);
}

export function assertVideoPreviewContract({
  css,
  design,
  agentGuide,
  e2e,
  preview = "",
  snapshotExists = true,
  storyboardSnapshotExists = true,
}) {
  const shell = css.match(/\.shadcn-prototype-preview-player\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
  const storyboardShell = css.match(/\.shadcn-prototype-project-preview\s*\{(?<body>[^}]*)\}/s)?.groups?.body ?? "";
  requireContract(
    /border:\s*1px solid #eae7e1;/.test(shell)
      && /border-radius:\s*20px;/.test(shell)
      && /background:\s*#ffffff;/.test(shell)
      && /box-shadow:\s*0 2px 6px rgba\(32, 31, 30, 0\.05\), 0 16px 40px rgba\(32, 31, 30, 0\.07\);/.test(shell)
      && /padding:\s*7px;/.test(shell),
    "the player must keep the approved white card shell",
  );
  requireContract(
    /border:\s*1px solid #eae7e1;/.test(storyboardShell)
      && /border-radius:\s*20px;/.test(storyboardShell)
      && /background:\s*#ffffff;/.test(storyboardShell)
      && /box-shadow:\s*0 2px 6px rgba\(32, 31, 30, 0\.05\), 0 16px 40px rgba\(32, 31, 30, 0\.07\);/.test(storyboardShell)
      && /padding:\s*7px;/.test(storyboardShell),
    "the storyboard preview must keep the approved white card shell",
  );
  requireContract(
    /\.shadcn-prototype-preview-player\.ratio-landscape\s+\.shadcn-prototype-preview-player-screen\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;/.test(css)
      && /\.shadcn-prototype-preview-player\.ratio-portrait\s+\.shadcn-prototype-preview-player-screen\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16;/.test(css)
      && !/\.shadcn-prototype-preview-player\.ratio-(?:landscape|portrait)\s*\{[^}]*aspect-ratio:/.test(css),
    "the ratio must belong to the media screen rather than the shell plus controls",
  );
  requireContract(
    !preview.includes("VideoPreviewResizer") && !preview.includes("previewHeight"),
    "browse mode must not reserve a detached resizer region below the player",
  );
  requireContract(
    preview.includes("<Play size={16}")
      && preview.includes('"--preview-progress"')
      && /\.shadcn-prototype-preview-player-screen > svg\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*padding:\s*14px;[^}]*transition:\s*transform \.15s ease;/.test(css)
      && /\.shadcn-prototype-preview-player-screen:hover > svg\s*\{[^}]*scale\(1\.07\)/.test(css)
      && /\.shadcn-prototype-preview-player \.shadcn-prototype-project-preview-controls\s*\{[^}]*padding:\s*8px 6px 4px;/.test(css)
      && /input\[type="range"\]\s*\{[^}]*appearance:\s*none;[^}]*height:\s*3px;[^}]*min-height:\s*3px;[^}]*padding:\s*0;[^}]*var\(--preview-progress\)/.test(css),
    "the play button and progress controls must match the workspace-video prototype",
  );
  requireContract(
    design.includes("video-preview-shell-contract:v1"),
    "the frontend design must carry video-preview-shell-contract:v1",
  );
  requireContract(
    /用户在当次任务中明确批准/.test(design),
    "the design must require explicit user approval for contract changes",
  );
  requireContract(
    agentGuide.includes("视频预览壳不可回退门禁")
      && agentGuide.includes("check:video-preview-contract")
      && agentGuide.includes("test:display-coverage"),
    "the agent guide must protect the shell and require contract plus browser checks",
  );
  requireContract(
    e2e.includes("expectApprovedVideoPreviewShell"),
    "browser coverage must assert the approved player shell",
  );
  requireContract(
    /toHaveScreenshot\(["']video-preview-shell\.png["']/.test(e2e),
    "browser coverage must keep a deterministic screenshot baseline",
  );
  requireContract(
    /toHaveScreenshot\(["']video-preview-storyboard-shell\.png["']/.test(e2e),
    "browser coverage must keep a deterministic storyboard screenshot baseline",
  );
  requireContract(snapshotExists, "the screenshot baseline file must exist");
  requireContract(storyboardSnapshotExists, "the storyboard screenshot baseline file must exist");
}

const scriptPath = fileURLToPath(import.meta.url);
const frontendRoot = path.resolve(path.dirname(scriptPath), "..");

export function checkRepositoryContract(root = frontendRoot) {
  const snapshotPath = path.join(root, "e2e", "display-area.spec.ts-snapshots", "video-preview-shell-win32.png");
  const storyboardSnapshotPath = path.join(root, "e2e", "display-area.spec.ts-snapshots", "video-preview-storyboard-shell-win32.png");
  assertVideoPreviewContract({
    css: readFileSync(path.join(root, "app", "globals.css"), "utf8"),
    design: readFileSync(path.join(root, "docs", "MULTIMIX_WORKSPACE_DESIGN.md"), "utf8"),
    agentGuide: readFileSync(path.join(root, "CLAUDE.md"), "utf8"),
    e2e: readFileSync(path.join(root, "e2e", "display-area.spec.ts"), "utf8"),
    preview: [
      readFileSync(path.join(root, "app", "assets", "components", "product-preview.tsx"), "utf8"),
      readFileSync(path.join(root, "app", "assets", "components", "video-preview-player.tsx"), "utf8"),
    ].join("\n"),
    snapshotExists: existsSync(snapshotPath),
    storyboardSnapshotExists: existsSync(storyboardSnapshotPath),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkRepositoryContract();
  console.log("Video preview contract passed.");
}
