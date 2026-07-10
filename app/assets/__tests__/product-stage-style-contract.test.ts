import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const preview = readFileSync(new URL("../components/product-preview.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/product-workspace.tsx", import.meta.url), "utf8");

describe("product stage style contract", () => {
  test("uses one shared stage scroll surface across copy and video paths", () => {
    expect(preview).toContain("shadcn-prototype-copy-document shadcn-prototype-markdown shadcn-prototype-stage-scroll-surface");
    expect(preview).toContain("shadcn-prototype-video-browse shadcn-prototype-stage-scroll-surface");
    expect(workspace).toContain('product.mode === "video" && !previewShowsBrowse ? "shadcn-prototype-stage-scroll-surface" : ""');
    expect(workspace).toContain(") : previewShowsBrowse ? (");
    expect(css).toMatch(/\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-stage-scroll-surface\s*\{[^}]*width:\s*calc\(100% \+ 24px\);[^}]*margin-right:\s*-24px;[^}]*padding-right:\s*var\(--shadcn-prototype-stage-scroll-right-padding, 24px\);/s);
    expect(css).toMatch(/\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-artifact \.shadcn-prototype-product-main\s*\{[^}]*overflow:\s*visible;/s);
    expect(css).toMatch(/\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-product-preview\.copy\s*\{[^}]*overflow:\s*visible;/s);
    expect(css).not.toMatch(/\.shadcn-prototype-workspace\.conversation-mode \.shadcn-prototype-(?:product-preview\.video|copy-document)\s*\{[^}]*margin-right:/s);
  });

  test("matches the demo header action hierarchy", () => {
    expect(css).toMatch(/\.shadcn-prototype-product-actions\s*\{[^}]*gap:\s*7px;/s);
    expect(css).toMatch(/\.shadcn-prototype-artifact \.shadcn-prototype-product-header \.shadcn-prototype-product-actions > button\s*\{[^}]*height:\s*30px;[^}]*min-height:\s*30px;[^}]*padding:\s*0 13px;[^}]*font-size:\s*12px;/s);
    expect(css).toMatch(/\.shadcn-prototype-artifact \.shadcn-prototype-product-header \.shadcn-prototype-product-actions > button\.primary\s*\{[^}]*background:\s*var\(--sp-text\);[^}]*color:\s*#ffffff;/s);
    expect(css).not.toMatch(/video-project-mode[^}]*height:\s*26px/s);
  });
});