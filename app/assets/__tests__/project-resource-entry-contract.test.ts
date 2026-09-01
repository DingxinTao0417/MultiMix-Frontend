import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("project resource entry contract", () => {
  it("opens the full asset library when adding material to a project", () => {
    const source = readFileSync(
      join(process.cwd(), "app/assets/components/assets-workspace-client.tsx"),
      "utf8",
    );
    const addSourceHandler = source.match(/onAddSource=\{\(\) => \{([\s\S]*?)\n\s*\}\}/)?.[1] ?? "";

    expect(addSourceHandler).toContain('setActiveView("assets")');
    expect(addSourceHandler).not.toContain('setActiveView("image")');
  });
});
