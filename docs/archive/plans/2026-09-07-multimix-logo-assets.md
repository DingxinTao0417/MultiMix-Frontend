# MultiMix Logo Assets Implementation Plan

> Status: current
> Owner: frontend
> Last verified: 2026-09-07

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce the approved MultiMix black-and-white logo as portable SVG masters, transparent PNG exports, and one visual usage preview.

**Architecture:** A small deterministic Node generator owns the vector geometry and uses the repository's existing Playwright runtime only for raster export. A Node test locks filenames, SVG safety, exact colors, dimensions, and transparent corners so the deliverables can be regenerated without font or design drift.

**Tech Stack:** Node.js 22+, SVG, `@playwright/test`, Node test runner

## Global Constraints

- The approved mark is a rounded continuous `M` plus a separate right-facing arrow.
- The wordmark is exactly `MultiMix`, with both `M` characters uppercase.
- Master colors are only `#151515` and `#FFFFFF`; no gradient is allowed.
- SVG files must use vector paths only: no `<text>`, external fonts, embedded images, filters, or baked background.
- PNG logo exports must have a real transparent alpha channel.
- Do not modify navigation, login, favicon, video rendering, or existing exported media.
- Do not modify `MultiMix-商业计划.md`, `MultiMix-融资路演版.pptx`, or `MultiMix-投资人阅读版.pptx`.

---

## Background and root cause

MultiMix currently has a product name and interface color tokens but no approved, reusable external brand mark. Video and image exports therefore lack a consistent product signature. The approved solution favors a deterministic vector source over a generative raster so small-size geometry, spelling, transparency, and black/white inversion remain exact.

## File map

- `scripts/generate-multimix-logo-assets.mjs`: single source of truth for SVG geometry, PNG raster export, and preview composition.
- `scripts/__tests__/multimix-logo-assets.test.mjs`: artifact contract for structure, colors, dimensions, and transparency.
- `public/brand/multimix-logo-horizontal-{black,white}.svg`: horizontal vector masters.
- `public/brand/multimix-logo-icon-{black,white}.svg`: icon vector masters.
- `public/brand/*.png`: transparent raster exports and opaque preview sheet.
- `docs/specs/ui/multimix-logo-identity.md`: already-approved usage specification; only update verification status if implementation reveals a necessary correction.

### Task 1: Add the failing artifact contract

**Files:**
- Create: `scripts/__tests__/multimix-logo-assets.test.mjs`
- Test: `scripts/__tests__/multimix-logo-assets.test.mjs`

**Interfaces:**
- Consumes: files under `public/brand/`.
- Produces: a Node test contract runnable with `node --test scripts/__tests__/multimix-logo-assets.test.mjs`.

- [x] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";

const root = process.cwd();
const brandDir = path.join(root, "public", "brand");
const variants = [
  ["multimix-logo-horizontal-black.svg", "#151515"],
  ["multimix-logo-horizontal-white.svg", "#FFFFFF"],
  ["multimix-logo-icon-black.svg", "#151515"],
  ["multimix-logo-icon-white.svg", "#FFFFFF"],
];

function pngMetadata(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
  };
}

test("SVG masters are portable path-only black/white assets", async () => {
  for (const [filename, color] of variants) {
    const svg = await readFile(path.join(brandDir, filename), "utf8");
    assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, new RegExp(color, "i"));
    assert.doesNotMatch(svg, /<(text|image|foreignObject)\b/i);
    assert.doesNotMatch(svg, /(font-family|filter=|linearGradient|radialGradient)/i);
    assert.match(svg, /data-part="mark"/);
    if (filename.includes("horizontal")) assert.match(svg, /data-part="wordmark"/);
  }
});

test("PNG exports have exact dimensions and transparent corners", async () => {
  const expected = new Map([
    ["multimix-logo-horizontal-black.png", [1800, 480]],
    ["multimix-logo-horizontal-white.png", [1800, 480]],
    ["multimix-logo-icon-black.png", [1024, 1024]],
    ["multimix-logo-icon-white.png", [1024, 1024]],
  ]);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [filename, [width, height]] of expected) {
      const buffer = await readFile(path.join(brandDir, filename));
      assert.deepEqual(pngMetadata(buffer), { width, height, colorType: 6 });
      const src = `data:image/png;base64,${buffer.toString("base64")}`;
      const alpha = await page.evaluate(async (imageSrc) => {
        const image = new Image();
        image.src = imageSrc;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, 1, 1).data[3];
      }, src);
      assert.equal(alpha, 0, `${filename} must have a transparent corner`);
    }
  } finally {
    await browser.close();
  }
});

test("preview sheet is a 1920x1080 PNG", async () => {
  const buffer = await readFile(path.join(brandDir, "multimix-logo-preview.png"));
  const metadata = pngMetadata(buffer);
  assert.equal(metadata.width, 1920);
  assert.equal(metadata.height, 1080);
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `node --test scripts/__tests__/multimix-logo-assets.test.mjs`

Expected: FAIL with `ENOENT` for `public/brand/multimix-logo-horizontal-black.svg`.

### Task 2: Generate vector masters and raster exports

**Files:**
- Create: `scripts/generate-multimix-logo-assets.mjs`
- Create: `public/brand/multimix-logo-horizontal-black.svg`
- Create: `public/brand/multimix-logo-horizontal-white.svg`
- Create: `public/brand/multimix-logo-icon-black.svg`
- Create: `public/brand/multimix-logo-icon-white.svg`
- Create: `public/brand/multimix-logo-horizontal-black.png`
- Create: `public/brand/multimix-logo-horizontal-white.png`
- Create: `public/brand/multimix-logo-icon-black.png`
- Create: `public/brand/multimix-logo-icon-white.png`
- Create: `public/brand/multimix-logo-preview.png`

**Interfaces:**
- Consumes: Node.js and the repository's installed `@playwright/test` package.
- Produces: `node scripts/generate-multimix-logo-assets.mjs` regenerates every file under `public/brand/` listed above.

- [x] **Step 1: Write the deterministic generator**

```js
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = process.cwd();
const outDir = path.join(root, "public", "brand");
const BLACK = "#151515";
const WHITE = "#FFFFFF";

const mark = (color) => `
  <g data-part="mark" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M28 146V50c0-10 12-15 19-8l39 39 39-39c7-7 19-2 19 8v96" stroke-width="20"/>
    <path d="M158 61l26 35-26 35" stroke-width="13"/>
  </g>`;

const wordmark = (color) => `
  <g data-part="wordmark" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round">
    <path d="M226 135V57l30 39 30-39v78"/>
    <path d="M311 86v31c0 12 7 19 18 19s18-7 18-19V86"/>
    <path d="M371 57v78"/>
    <path d="M399 70v48c0 12 7 18 18 18"/>
    <path d="M388 87h29"/>
    <path d="M443 87v48"/>
    <path d="M478 135V57l30 39 30-39v78"/>
    <path d="M565 87v48"/>
    <path d="M596 87l38 48M634 87l-38 48"/>
  </g>
  <g fill="${color}"><circle cx="443" cy="66" r="7"/><circle cx="565" cy="66" r="7"/></g>`;

function iconSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192" role="img" aria-label="MultiMix icon">${mark(color)}</svg>\n`;
}

function horizontalSvg(color) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 672 192" role="img" aria-label="MultiMix logo">${mark(color)}${wordmark(color)}</svg>\n`;
}

async function renderTransparent(browser, svg, output, width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${width}px;height:${height}px}</style>${svg}`);
  await page.screenshot({ path: output, omitBackground: true, clip: { x: 0, y: 0, width, height } });
  await page.close();
}

async function renderPreview(browser, blackHorizontal, whiteHorizontal, blackIcon, whiteIcon) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>
    *{box-sizing:border-box} body{margin:0;background:#ece8e1;color:#151515;font-family:Arial,sans-serif;padding:72px}
    h1{font-size:42px;margin:0 0 12px} p{font-size:20px;color:#655f57;margin:0 0 40px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:28px}.panel{height:300px;border-radius:28px;padding:42px;display:grid;place-items:center;overflow:hidden}
    .light{background:#faf8f4;border:1px solid #ded8cf}.dark{background:#151515}.horizontal svg{width:640px;max-width:100%;height:auto}
    .icons{display:flex;gap:34px;align-items:center;justify-content:center}.icon{width:164px;height:164px;border-radius:28px;padding:18px;display:grid;place-items:center}
    .icon svg{width:100%;height:100%}.scene{position:relative;background:linear-gradient(135deg,#dad0c0,#99b5b1 45%,#2f4b50);isolation:isolate}
    .scene:before{content:"";position:absolute;width:430px;height:210px;border-radius:60% 35% 45% 30%;background:rgba(255,255,255,.25);filter:blur(10px);left:80px;top:35px}
    .watermark{position:absolute;right:30px;bottom:26px;width:220px;padding:10px 13px;background:rgba(0,0,0,.74);border-radius:11px;box-shadow:0px 3px 14px rgba(0,0,0,.2)}
    .watermark svg{width:100%;display:block}.label{position:absolute;left:28px;top:24px;font-size:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.86)}
  </style></head><body>
    <h1>MultiMix Logo System</h1><p>Black & white master assets · horizontal lockup · icon · watermark application</p>
    <div class="grid">
      <section class="panel light horizontal">${blackHorizontal}</section>
      <section class="panel dark horizontal">${whiteHorizontal}</section>
      <section class="panel light icons"><div class="icon">${blackIcon}</div><div class="icon" style="background:#151515">${whiteIcon}</div></section>
      <section class="panel scene"><div class="label">Video watermark preview</div><div class="watermark">${whiteHorizontal}</div></section>
    </div>
  </body></html>`);
  await page.screenshot({ path: path.join(outDir, "multimix-logo-preview.png"), fullPage: false });
  await page.close();
}

await mkdir(outDir, { recursive: true });
const svgFiles = new Map([
  ["multimix-logo-horizontal-black.svg", horizontalSvg(BLACK)],
  ["multimix-logo-horizontal-white.svg", horizontalSvg(WHITE)],
  ["multimix-logo-icon-black.svg", iconSvg(BLACK)],
  ["multimix-logo-icon-white.svg", iconSvg(WHITE)],
]);
for (const [filename, svg] of svgFiles) await writeFile(path.join(outDir, filename), svg, "utf8");

const browser = await chromium.launch({ headless: true });
try {
  for (const tone of ["black", "white"]) {
    await renderTransparent(browser, svgFiles.get(`multimix-logo-horizontal-${tone}.svg`), path.join(outDir, `multimix-logo-horizontal-${tone}.png`), 1800, 480);
    await renderTransparent(browser, svgFiles.get(`multimix-logo-icon-${tone}.svg`), path.join(outDir, `multimix-logo-icon-${tone}.png`), 1024, 1024);
  }
  await renderPreview(browser, svgFiles.get("multimix-logo-horizontal-black.svg"), svgFiles.get("multimix-logo-horizontal-white.svg"), svgFiles.get("multimix-logo-icon-black.svg"), svgFiles.get("multimix-logo-icon-white.svg"));
} finally {
  await browser.close();
}

for (const filename of svgFiles.keys()) await readFile(path.join(outDir, filename), "utf8");
console.log(`Generated ${svgFiles.size} SVG masters, 4 transparent PNG exports, and 1 preview sheet in ${outDir}`);
```

- [x] **Step 2: Run the generator**

Run: `node scripts/generate-multimix-logo-assets.mjs`

Expected: `Generated 4 SVG masters, 4 transparent PNG exports, and 1 preview sheet`.

- [x] **Step 3: Run the artifact contract**

Run: `node --test scripts/__tests__/multimix-logo-assets.test.mjs`

Expected: 3 tests PASS.

### Task 3: Visual and documentation verification

**Files:**
- Verify: `public/brand/multimix-logo-preview.png`
- Verify: `docs/specs/ui/multimix-logo-identity.md`
- Move after completion: move this active plan into `docs/archive/plans/` without changing its filename.

**Interfaces:**
- Consumes: generated SVG/PNG deliverables and the approved identity specification.
- Produces: visually inspected, documented assets with the completed plan archived.

**Execution note:** The first original-detail preview showed the arrow stroke visually touching the `M` at large size. Before accepting the preview, add a focused failing contract for a visible negative-space gap, move the arrow to `M164 63l20 33-20 33` with `12 px` stroke, regenerate every derivative, and rerun the full artifact contract.

- [x] **Step 1: Inspect the preview image**

Open `public/brand/multimix-logo-preview.png` at original detail. Confirm the `M`, forward arrow, and exact `MultiMix` wordmark are legible on light, dark, and complex backgrounds; confirm the watermark is subordinate to the simulated content.

- [x] **Step 2: Inspect minimum-size renders**

Run: `node --test scripts/__tests__/multimix-logo-assets.test.mjs`

Expected: 3 tests PASS, including `1024x1024` icon and transparent-corner validation. Then open the icon SVG at `24 px` and horizontal SVG at `96 px` in a browser or image viewer and confirm the mark remains distinguishable.

- [x] **Step 3: Run documentation checks**

Run: `npm run docs:check`

Expected: `Docs check passed.`

- [x] **Step 4: Archive the completed plan**

Move this plan from `docs/plans/active/` into `docs/archive/plans/` without changing its filename, change the status header to `Status: current`, and run `npm run docs:check` again.

- [x] **Step 5: Commit the implementation**

Use the workspace submit guard, stage only the generator, test, approved brand assets, specification entry if changed, and archived plan, then commit with:

```bash
git commit -m "feat: add MultiMix logo assets"
```

Do not stage or modify the unrelated existing frontend worktree changes.
