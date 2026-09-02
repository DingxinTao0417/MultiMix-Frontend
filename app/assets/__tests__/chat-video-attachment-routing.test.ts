import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { resolveChatVideoAttachmentPurpose } from "../lib/chat-video-attachment-routing";
import type { AssetConversation } from "../lib/asset-workspace-types";

const workspaceClient = readFileSync(
  new URL("../components/assets-workspace-client.tsx", import.meta.url),
  "utf8",
);

describe("chat video attachment routing", () => {
  it("routes an established explainer project through ordinary video asset upload", () => {
    expect(workspaceClient).toContain("resolveChatVideoAttachmentPurpose");
    expect(workspaceClient).toContain('videoPurpose === "visual_material"');
    expect(workspaceClient).toMatch(
      /uploadAsset\(\s*token,\s*upload\.file,\s*"video"/,
    );
    expect(workspaceClient).toContain("addProjectSource(token, conversationId, assetId)");
  });

  it("does not build a long-form analysis action from an explainer visual material", () => {
    expect(workspaceClient).not.toContain("resolveLongFormAnalyzeAction");
    expect(workspaceClient).toContain("const effectiveLongFormAction = longFormAction;");
  });

  it("waits for video understanding before saving the material into the project", () => {
    expect(workspaceClient).toContain("persistReadyVisualMaterial");
    expect(workspaceClient).toMatch(
      /if \(job\.status === "completed"\)[\s\S]*await persistReadyVisualMaterial/,
    );
  });

  it("uses only structured project state to distinguish explainer material", () => {
    const conversation = {
      product: { contentType: undefined, metadata: {} },
      products: [],
      messages: [{ role: "assistant", text: "", plan: {
        kind: "video_parameter_confirmation",
        title: "确认视频参数",
        status: "pending",
        fields: [],
      } }],
    } as unknown as AssetConversation;

    expect(resolveChatVideoAttachmentPurpose(conversation)).toBe("visual_material");
  });

  it("keeps a project without an established type on the neutral creation-source path", () => {
    const conversation = {
      product: { contentType: undefined, metadata: {} },
      products: [],
      messages: [],
    } as unknown as AssetConversation;

    expect(resolveChatVideoAttachmentPurpose(conversation)).toBe("creation_source");
  });
});
