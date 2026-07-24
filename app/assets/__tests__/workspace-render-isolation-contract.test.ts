import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readAssetFile(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("workspace heavy-subtree render isolation", () => {
  it("uses one library dynamic import and refreshes it through a revision prop", () => {
    const client = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const workshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const dynamicImports = client.match(/dynamic\(\(\) => import\("\.\/library-workshop"\)/g) ?? [];

    expect(dynamicImports).toHaveLength(1);
    expect(client).toContain("refreshRevision={libraryRefreshKey}");
    expect(client).not.toContain('key={`${activeView}-${libraryRefreshKey}`}');
    expect(client).toContain("useStableCallback");
    expect(workshop).toContain("export default memo(LibraryWorkshop)");
  });
});
