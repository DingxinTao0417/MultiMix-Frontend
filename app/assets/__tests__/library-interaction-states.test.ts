import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const source = read("app/assets/components/library-workshop.tsx");
const css = read("app/globals.css");

describe("library interaction states", () => {
  it("distinguishes an empty library from active search or filter criteria", () => {
    expect(source).toContain("hasActiveLibraryCriteria");
    expect(source).toContain("没有找到匹配内容");
    expect(source).toContain("这个分类还没有内容");
    expect(source).toContain("清除搜索和筛选");
  });

  it("reports only the currently displayed count beside pagination", () => {
    expect(source).toContain("shadcn-prototype-library-results-footer");
    expect(source).toContain("当前显示");
    expect(source).toContain("加载更多内容");
    expect(source).toContain("正在加载更多…");
    expect(source).not.toContain("共 ${filteredRows.length}");
  });

  it("keeps result feedback visually lighter than resource cards", () => {
    expect(css).toMatch(/\.shadcn-prototype-library-results-footer\s*\{[^}]*border-top:\s*1px solid var\(--sp-border\);/s);
    expect(css).toMatch(/\.shadcn-prototype-library-results-footer span\s*\{[^}]*color:\s*var\(--sp-faint\);/s);
  });
});
