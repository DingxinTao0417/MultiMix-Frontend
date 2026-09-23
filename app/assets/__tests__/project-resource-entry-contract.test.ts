import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("project resource entry contract", () => {
  it("keeps resource management separate from the chat attachment entry", () => {
    const drawer = readFileSync(
      join(process.cwd(), "app/assets/components/project-resources-drawer.tsx"),
      "utf8",
    );

    expect(drawer).not.toContain("onAddSource");
    expect(drawer).not.toContain("添加素材");
  });
});
