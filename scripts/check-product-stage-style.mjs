import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const preview = readFileSync(new URL("../app/assets/components/product-preview.tsx", import.meta.url), "utf8");
const markdownDocument = readFileSync(new URL("../app/assets/components/markdown-product-document.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../app/assets/components/product-workspace.tsx", import.meta.url), "utf8");

assert.ok(markdownDocument.includes("shadcn-prototype-copy-document shadcn-prototype-markdown shadcn-prototype-stage-scroll-surface"), "copy documents must use the shared product-stage scroll surface");
assert.ok(preview.includes("shadcn-prototype-video-browse shadcn-prototype-stage-scroll-surface"), "video browse must use the shared product-stage scroll surface");
assert.ok(workspace.includes('product.mode === "video" && !previewShowsBrowse ? "shadcn-prototype-stage-scroll-surface" : ""'), "plain video previews must use the shared product-stage scroll surface without nesting it around video browse");
assert.ok(workspace.includes('!showEditorEmbed && previewShowsBrowse ? ('), "all video-project browse paths must render without the generic video scroll wrapper");
assert.ok(workspace.includes('{!isTextEditing && hasVideoProject && editorRequested ? ('), "video browse must mount the editor bridge only after explicit edit or export intent");
assert.match(css, /\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-stage-scroll-surface\s*\{[^}]*width:\s*calc\(100% \+ 24px\);[^}]*margin-right:\s*-24px;[^}]*padding-right:\s*var\(--shadcn-prototype-stage-scroll-right-padding, 24px\);/s, "the product stage must expand into the product pane's right inset");
assert.match(css, /\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-artifact \.shadcn-prototype-product-main\s*\{[^}]*overflow:\s*visible;/s, "the product main must not clip the expanded stage scrollbar");
assert.match(css, /\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-product-preview\.copy\s*\{[^}]*overflow:\s*visible;/s, "the copy preview wrapper must not clip its inner scroll surface");
assert.doesNotMatch(css, /\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-(?:product-preview\.video|copy-document)\s*\{[^}]*margin-right:/s, "product-mode-specific scrollbar offset rules are not allowed");
assert.match(css, /\.shadcn-prototype-product-actions\s*\{[^}]*gap:\s*7px;/s, "product header actions must use the demo's 7px gap");
assert.match(css, /\.shadcn-prototype-artifact \.shadcn-prototype-product-header \.shadcn-prototype-product-actions > button\s*\{[^}]*height:\s*30px;[^}]*min-height:\s*30px;[^}]*padding:\s*0 13px;[^}]*font-size:\s*12px;/s, "header action buttons must override the generic 34px card-header rule");
assert.match(css, /\.shadcn-prototype-artifact \.shadcn-prototype-product-header \.shadcn-prototype-product-actions > button\.primary\s*\{[^}]*background:\s*var\(--sp-text\);[^}]*color:\s*#ffffff;/s, "primary product actions must use the demo's dark filled style");
assert.doesNotMatch(css, /video-project-mode[^}]*height:\s*26px/s, "video projects must not shrink header actions to 26px");
assert.match(css, /\.shadcn-prototype-preview-player\s*\{[^}]*border:\s*1px solid #eae7e1;[^}]*border-radius:\s*20px;[^}]*background:\s*#ffffff;[^}]*box-shadow:\s*0 2px 6px rgba\(32, 31, 30, 0\.05\), 0 16px 40px rgba\(32, 31, 30, 0\.07\);[^}]*padding:\s*7px;/s, "video preview players must keep the approved white card shell");
assert.match(css, /\.shadcn-prototype-preview-player\.ratio-landscape\s+\.shadcn-prototype-preview-player-screen\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*9;/s, "landscape ratio must apply to the media screen, not the shell plus controls");
assert.match(css, /\.shadcn-prototype-preview-player\.ratio-portrait\s+\.shadcn-prototype-preview-player-screen\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16;/s, "portrait ratio must apply to the media screen, not the shell plus controls");
assert.doesNotMatch(preview, /VideoPreviewResizer|previewHeight/, "browse preview must not reserve detached resizer space below the player");

console.log("Product stage style contract passed.");
