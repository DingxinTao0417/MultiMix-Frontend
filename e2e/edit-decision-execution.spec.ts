import fs from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";


const evidenceDir = path.resolve(
  "test-results/edit-decision-execution-browser-20260902",
);
const coffeeFrame = path.resolve(
  "test-results/creative-direction-coffee-ab-20260901/current/keyframes/keyframe-03-seg-3.png",
);
const peopleFrame = path.resolve(
  "test-results/edit-decision-execution-browser-20260902/demo-people-frame.jpg",
);
const productFrame = path.resolve(
  "test-results/edit-decision-execution-browser-20260902/demo-product-frame.jpg",
);

const ratios = [
  { label: "16x9", width: 640, height: 360 },
  { label: "9x16", width: 360, height: 640 },
  { label: "1x1", width: 520, height: 520 },
];


for (const ratio of ratios) {
  test(`普通用户保存后，${ratio.label} 的画面与文字仍在安全位置`, async ({ page }) => {
    test.skip(
      ![coffeeFrame, peopleFrame, productFrame].every((file) => fs.existsSync(file)),
      "本地画面验证素材未准备好",
    );
    const image = `data:image/png;base64,${fs.readFileSync(coffeeFrame).toString("base64")}`;
    const people = `data:image/jpeg;base64,${fs.readFileSync(peopleFrame).toString("base64")}`;
    const product = `data:image/jpeg;base64,${fs.readFileSync(productFrame).toString("base64")}`;
    await page.setViewportSize({ width: ratio.width + 80, height: ratio.height + 80 });
    await page.setContent(`
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 24px; padding: 40px; min-height: 100vh; background: #ebe7df; }
        .canvas { position: relative; flex: none; width: ${ratio.width}px; height: ${ratio.height}px; overflow: hidden; background: #0b0b0b; }
        #main { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
        #inset { position: absolute; left: 61%; top: 7%; width: 34%; height: 34%; object-fit: cover; border: 3px solid white; border-radius: 12px; box-shadow: 0 8px 24px #0008; }
        #value { position: absolute; left: 58%; top: 46%; width: 34%; min-height: 16%; display: grid; place-items: center; padding: 10px; border-radius: 14px; background: #14532de6; color: white; font: 700 ${Math.max(18, Math.round(ratio.height * 0.042))}px/1.2 system-ui; text-align: center; }
        #subtitle { position: absolute; left: 8%; top: 74%; width: 84%; min-height: 18%; display: grid; place-items: center; padding: 8px 12px; border-radius: 8px; background: #111827d9; color: white; font: 700 ${Math.max(16, Math.round(ratio.height * 0.036))}px/1.2 system-ui; text-align: center; }
        #people { width: 100%; height: 100%; object-fit: cover; object-position: center 42%; }
        #product { width: 100%; height: 100%; object-fit: contain; }
      </style>
      <main id="canvas" class="canvas" aria-label="信息层视频画布">
        <img id="main" alt="咖啡制作主画面" src="${image}" />
        <img id="inset" alt="咖啡制作细节画面" src="${image}" />
        <div id="value">研磨、压粉、萃取</div>
        <div id="subtitle">打开后仍是刚才保存的画面</div>
      </main>
      <section id="people-canvas" class="canvas" aria-label="人物主画面">
        <img id="people" alt="三人对谈画面" src="${people}" />
      </section>
      <section id="product-canvas" class="canvas" aria-label="产品辅助画面">
        <img id="product" alt="产品界面画面" src="${product}" />
      </section>
    `);

    const canvas = await page.locator("#canvas").boundingBox();
    const value = await page.locator("#value").boundingBox();
    const subtitle = await page.locator("#subtitle").boundingBox();
    const inset = await page.locator("#inset").boundingBox();
    expect(canvas && value && subtitle && inset).toBeTruthy();
    expect(value!.x).toBeGreaterThanOrEqual(canvas!.x);
    expect(value!.x + value!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
    expect(inset!.y).toBeGreaterThanOrEqual(canvas!.y);
    expect(inset!.x + inset!.width).toBeLessThanOrEqual(canvas!.x + canvas!.width);
    expect(inset!.y + inset!.height).toBeLessThanOrEqual(value!.y);
    expect(value!.y + value!.height).toBeLessThanOrEqual(subtitle!.y);
    expect(subtitle!.y + subtitle!.height).toBeLessThanOrEqual(canvas!.y + canvas!.height);
    await expect(page.locator("#people")).toHaveJSProperty("complete", true);
    await expect(page.locator("#product")).toHaveJSProperty("complete", true);
    expect(await page.locator("#people").evaluate((element) => getComputedStyle(element).objectFit)).toBe("cover");
    expect(await page.locator("#product").evaluate((element) => getComputedStyle(element).objectFit)).toBe("contain");

    fs.mkdirSync(evidenceDir, { recursive: true });
    await page.locator("#canvas").screenshot({
      path: path.join(evidenceDir, `${ratio.label}.png`),
    });
    await page.locator("#people-canvas").screenshot({
      path: path.join(evidenceDir, `${ratio.label}-people.png`),
    });
    await page.locator("#product-canvas").screenshot({
      path: path.join(evidenceDir, `${ratio.label}-product.png`),
    });
  });
}
