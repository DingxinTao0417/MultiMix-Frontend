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
    <path data-part="forward-arrow" d="M164 63l20 33-20 33" stroke-width="12"/>
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
