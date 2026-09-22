import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/library-workshop.tsx", import.meta.url), "utf8");
const workspaceClient = readFileSync(new URL("../components/assets-workspace-client.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../globals.css", import.meta.url), "utf8");

describe("library filter groups", () => {
  it("separates content type and processing status into named groups", () => {
    expect(source).toContain('role="group" aria-label="内容类型"');
    expect(source).toContain('role="group" aria-label="处理状态"');
    expect(source).not.toContain("shadcn-prototype-library-filter-sep");
  });

  it("uses one page hierarchy for all four libraries", () => {
    expect(workspaceClient).toContain("资源库");
    expect(workspaceClient).toContain("shadcn-prototype-library-breadcrumb-separator");
    expect(source).toContain("LIBRARY_VIEW_DESCRIPTIONS");
    expect(source).toContain("shadcn-prototype-library-page-header");
    expect(source).toContain("shadcn-prototype-library-page-actions");
    expect(source).toContain("shadcn-prototype-library-filter-bar");
    expect(css).toMatch(/\.shadcn-prototype-library-page-header\s*\{[^}]*grid-template-columns:\s*minmax\(240px, 1fr\) auto;/s);
    expect(css).toMatch(/\.shadcn-prototype-library-filter-bar\s*\{[^}]*background:\s*#f8f6f3;[^}]*border-radius:\s*14px;/s);
  });

  it("aligns cards and renders every non-content state inside the same visual shell", () => {
    expect(source.match(/shadcn-prototype-workshop-empty/g)?.length).toBeGreaterThanOrEqual(4);
    expect(source).toContain("shadcn-prototype-workshop-empty-icon");
    expect(css).toMatch(/\.shadcn-prototype-library-media-card\s*\{[^}]*border-radius:\s*14px;/s);
    expect(css).toMatch(/\.shadcn-prototype-library-text-card\s*\{[^}]*border-radius:\s*14px;/s);
    expect(css).toMatch(/\.shadcn-prototype-workshop-empty\s*\{[^}]*place-items:\s*center;[^}]*border:\s*1px solid var\(--sp-border\);/s);
  });
});
