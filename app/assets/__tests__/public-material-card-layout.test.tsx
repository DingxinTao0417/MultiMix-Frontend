import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("public material result card layout", () => {
  it("separates the preview card from the save action", () => {
    const workshop = read("app/assets/components/library-workshop.tsx");
    const css = read("app/globals.css");

    expect(workshop).toContain('className="shadcn-prototype-public-result"');
    expect(workshop).toContain('className="shadcn-prototype-public-save"');
    expect(workshop).toContain('className="shadcn-prototype-public-card-content"');
    expect(css).not.toContain(".shadcn-prototype-public-results article > button");
    expect(css).toContain("grid-template-columns: repeat(3, minmax(0, 1fr));");
  });

  it("constrains long content and provides responsive columns", () => {
    const css = read("app/globals.css");

    expect(css).toMatch(/\.shadcn-prototype-public-card strong\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    expect(css).toMatch(/\.shadcn-prototype-public-meta\s*\{[^}]*text-overflow:\s*ellipsis/s);
    expect(css).toMatch(/@media \(max-width:\s*760px\)[\s\S]*?\.shadcn-prototype-public-results\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(max-width:\s*520px\)[\s\S]*?\.shadcn-prototype-public-results\s*\{[^}]*minmax\(0, 1fr\)/);
  });

  it("uses a controlled placeholder when an external preview fails", () => {
    const workshop = read("app/assets/components/library-workshop.tsx");

    expect(workshop).toContain("function PublicMaterialThumbnail");
    expect(workshop).toContain("onError={() => setLoadFailed(true)}");
    expect(workshop).toContain('className="shadcn-prototype-public-thumb-placeholder"');
  });
});
