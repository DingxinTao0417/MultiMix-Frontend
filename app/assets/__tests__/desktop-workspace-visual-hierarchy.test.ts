import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");
const workspaceClient = readFileSync(new URL("../components/assets-workspace-client.tsx", import.meta.url), "utf8");

describe("desktop workspace visual hierarchy contract", () => {
  it("uses the approved desktop split and shared resize bounds", () => {
    expect(workspaceClient).toContain("DESKTOP_CHAT_PANEL_MIN = 480");
    expect(workspaceClient).toContain("DESKTOP_CHAT_PANEL_MAX = 720");
    expect(workspaceClient).toContain("DESKTOP_ARTIFACT_PANEL_MIN = 420");
    expect(workspaceClient).toContain("DESKTOP_CHAT_PANEL_RATIO = 0.52");
    expect(css).toMatch(/\.shadcn-prototype-workspace\.conversation-mode\s*\{[^}]*minmax\(480px, var\(--chat-panel-width, clamp\(480px, 52%, 720px\)\)\)[^}]*minmax\(420px, 1fr\)/s);
  });

  it("prevents conversation products and image results from shrinking into floating cards", () => {
    expect(css).toMatch(/\.shadcn-prototype-thread article\.assistant\s*\{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.shadcn-prototype-product-card-list\s*\{[^}]*width:\s*min\(100%, 560px\);/s);
    expect(css).toMatch(/\.shadcn-prototype-product-preview\.image\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*align-content:\s*start;[^}]*justify-content:\s*stretch;/s);
  });

  it("defines one readable component scale for the covered desktop surfaces", () => {
    expect(css).toContain("--sp-control-compact: 30px");
    expect(css).toContain("--sp-control-default: 36px");
    expect(css).toContain("--sp-control-primary: 40px");
    expect(css).toContain("--sp-text-meta: 12px");
  });
});
