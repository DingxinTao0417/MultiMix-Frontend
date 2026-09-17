import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/library-workshop.tsx", import.meta.url), "utf8");

describe("library filter groups", () => {
  it("separates content type and processing status into named groups", () => {
    expect(source).toContain('role="group" aria-label="内容类型"');
    expect(source).toContain('role="group" aria-label="处理状态"');
    expect(source).not.toContain("shadcn-prototype-library-filter-sep");
  });
});
