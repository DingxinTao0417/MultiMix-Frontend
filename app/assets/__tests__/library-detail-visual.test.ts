import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const source = read("app/assets/components/library-workshop.tsx");
const css = read("app/globals.css");

describe("library detail visual hierarchy", () => {
  it("uses one fixed-header, scrolling-body, fixed-footer shell", () => {
    expect(source).toContain("shadcn-prototype-library-detail-dialog");
    expect(source).toContain("shadcn-prototype-library-detail-header");
    expect(source).toContain("shadcn-prototype-library-detail-body");
    expect(css).toMatch(/\.shadcn-prototype-library-detail-dialog\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto;/s);
    expect(css).toMatch(/\.shadcn-prototype-library-detail-body\s*\{[^}]*overflow:\s*auto;/s);
  });

  it("keeps detail sections at their natural block height so adjacent sections cannot overlap", () => {
    expect(css).toMatch(/\.shadcn-prototype-library-detail-body\s*\{[^}]*grid-auto-rows:\s*max-content;/s);
    expect(css).toMatch(/\.shadcn-prototype-library-content\s*\{[^}]*min-height:\s*max-content;/s);
  });

  it("keeps one primary action and moves management actions into an overflow menu", () => {
    expect(source.match(/shadcn-prototype-library-detail-primary/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
    expect(source).toContain("shadcn-prototype-library-detail-overflow");
    expect(source).toContain("更多操作");
    expect(css).toMatch(/\.shadcn-prototype-library-detail-primary\s*\{[^}]*background:\s*var\(--sp-text\);/s);
    expect(css).toMatch(/\.shadcn-prototype-library-detail-overflow-menu\s*\{[^}]*position:\s*absolute;/s);
  });

  it("preserves every existing detail capability", () => {
    for (const action of ["用于创作", "加入项目…", "重新解析素材", "下载", "查看来源", "删除", "打开剪辑器", "导出口播稿"]) {
      expect(source).toContain(action);
    }
  });
});
