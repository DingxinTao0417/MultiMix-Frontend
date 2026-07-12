import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const preview = readFileSync(new URL("../components/product-preview.tsx", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/product-workspace.tsx", import.meta.url), "utf8");
const conversationStudio = readFileSync(new URL("../components/conversation-studio.tsx", import.meta.url), "utf8");
const agentRunTimeline = readFileSync(new URL("../components/agent-run-timeline.tsx", import.meta.url), "utf8");

describe("product stage style contract", () => {
  test("keeps confirmation and execution cards on one shared responsive width", () => {
    expect(conversationStudio).toContain("shadcn-prototype-workflow-card-message");
    expect(css).toMatch(/\.shadcn-prototype-thread article\.shadcn-prototype-workflow-card-message\s*\{[^}]*width:\s*min\(560px, 92%\);/s);
    expect(css).toMatch(/\.shadcn-prototype-workflow-card-message > :is\(\s*\.shadcn-prototype-confirm-card,\s*\.shadcn-prototype-agent-run\s*\)\s*\{[^}]*width:\s*100%;/s);
  });

  test("uses one aligned status grid and SVG icons across execution states", () => {
    expect(agentRunTimeline).toContain("import { Check, ChevronDown, Sparkles, X }");
    expect(agentRunTimeline).not.toContain(">✕</span>");
    expect(css).toMatch(/\.shadcn-prototype-agent-run-head\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto 15px;/s);
    expect(css).toMatch(/\.shadcn-prototype-agent-run-step\s*\{[^}]*grid-template-columns:\s*30px minmax\(0, 1fr\) auto;/s);
    for (const className of ["ok", "active", "wait", "failmark"]) {
      expect(css).toMatch(new RegExp(`\\.shadcn-prototype-agent-run-${className}\\s*\\{[^}]*width:\\s*18px;[^}]*height:\\s*18px;`, "s"));
    }
    expect(css).toMatch(/\.shadcn-prototype-agent-run-title-dot\s*\{[^}]*width:\s*6px;[^}]*height:\s*6px;[^}]*border-radius:\s*999px;/s);
    expect(css).toMatch(/\.shadcn-prototype-thread \.assistant \.shadcn-prototype-agent-run-title\s*\{[^}]*color:\s*var\(--sp-text\);[^}]*font-size:\s*17px;[^}]*font-weight:\s*700;/s);
    expect(css).toMatch(/\.shadcn-prototype-thread \.assistant \.shadcn-prototype-agent-run-ic\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
    expect(css).toMatch(/\.shadcn-prototype-thread \.assistant \.shadcn-prototype-agent-run-ic > :is\([^)]*agent-run-ok[^)]*agent-run-failmark[^)]*\)\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
  });

  test("uses the same title size for the video plan and video generation progress", () => {
    expect(css).toMatch(/\.shadcn-prototype-confirm-done-head\s*\{[^}]*color:\s*var\(--sp-text\);[^}]*font-size:\s*17px;[^}]*font-weight:\s*700;/s);
    expect(css).toMatch(/\.shadcn-prototype-confirm-ok\s*\{[^}]*color:\s*var\(--sp-green\);[^}]*background:\s*var\(--sp-green-soft\);/s);
    expect(css).toMatch(/\.shadcn-prototype-thread \.shadcn-prototype-confirm-done-head > strong\s*\{[^}]*color:\s*var\(--sp-text\);/s);
    expect(css).toMatch(/\.shadcn-prototype-thread \.assistant \.shadcn-prototype-confirm-ok\s*\{[^}]*color:\s*var\(--sp-green\);/s);
    expect(css).toMatch(/\.shadcn-prototype-agent-run-head\s*\{[^}]*color:\s*var\(--sp-text\);[^}]*font-size:\s*13\.5px;/s);
    expect(css).toMatch(/\.shadcn-prototype-agent-run-tx\s*\{[^}]*font-size:\s*14px;[^}]*font-weight:\s*600;/s);
    expect(css).toMatch(/\.shadcn-prototype-agent-run-tm\s*\{[^}]*font-size:\s*13px;[^}]*font-weight:\s*500;[^}]*font-variant-numeric:\s*tabular-nums;/s);
    expect(css).toMatch(/\.shadcn-prototype-agent-run-step \.shadcn-prototype-agent-run-ok\s*\{[^}]*transform:\s*scale\(0\.88\);[^}]*opacity:\s*0\.78;/s);
  });

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

  test("keeps the video preview above an independently scrolling storyboard list", () => {
    expect(css).toMatch(/\.shadcn-prototype-video-browse\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.shadcn-prototype-video-browse\s*>\s*\.shadcn-prototype-product-video\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(css).toMatch(/\.shadcn-prototype-video-browse\s*>\s*\.shadcn-prototype-segment-cards\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1 1 auto;/s);
    expect(css).toMatch(/\.shadcn-prototype-video-browse\s*>\s*\.shadcn-prototype-segment-cards\s*>\s*ol\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  });

  test("fits lightweight segment media and its fallback inside the preview frame", () => {
    expect(css).toMatch(/\.shadcn-prototype-project-preview-screen\s*>\s*:(?:is|where)\(img, video\)\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*cover;/s);
    expect(css).toMatch(/\.shadcn-prototype-project-preview-screen\s*>\s*\.shadcn-prototype-video-placeholder-screen\s*\{[^}]*height:\s*100%;/s);
  });
});
