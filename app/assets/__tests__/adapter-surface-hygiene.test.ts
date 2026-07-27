import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const retiredMembers = [
  "getSnapshot",
  "getConversation",
  "listConversationProducts",
  "getConversationProduct",
  "createConversation",
  "reviseProduct",
  "generateVideo",
  "createTextAsset",
  "getLatestIngestJob",
] as const;

describe("asset workspace adapter surface hygiene", () => {
  it("does not reintroduce retired, uncalled facade methods", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../lib/asset-workspace-adapter.ts", import.meta.url)),
      "utf8",
    );
    const presentMembers = retiredMembers.filter((member) => (
      new RegExp(`\\b${member}\\s*\\(`).test(source)
    ));

    expect(presentMembers).toEqual([]);
    expect(source).not.toContain('"/video/generate"');
  });
});
