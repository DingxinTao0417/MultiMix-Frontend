import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function readAssetFile(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("agent conversation UI copy", () => {
  it("does not use explicit generating text placeholders", () => {
    const conversationStudio = readAssetFile("app/assets/components/conversation-studio.tsx");
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(conversationStudio).not.toContain('assistantText: "正在生成"');
    expect(workspaceClient).not.toContain('text: "正在生成"');
  });

  it("keeps user-facing creation labels out of prompt/script wording", () => {
    const productWorkspace = readAssetFile("app/assets/components/product-workspace.tsx");
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(productWorkspace).toContain("明确要文案、图片或视频后");
    expect(workspaceClient).not.toContain("短视频脚本");
    expect(workspaceClient).not.toContain("图片提示词");
  });

  it("shows video plan summary with folded scene details", () => {
    const productPreview = readAssetFile("app/assets/components/product-preview.tsx");

    expect(productPreview).toContain("shadcn-prototype-video-plan-summary");
    expect(productPreview).toContain("视频文案草稿");
    expect(productPreview).not.toContain("<span>视频方案</span>");
    expect(productPreview).toContain("查看分镜详情");
    expect(productPreview).toContain("自动补素材");
  });

  it("keeps material gap display lightweight", () => {
    const productPreview = readAssetFile("app/assets/components/product-preview.tsx");

    expect(productPreview).toContain("shadcn-prototype-video-plan-gap");
    expect(productPreview).toContain("字幕/标题卡占位");
    expect(productPreview).not.toContain("素材覆盖度面板");
    expect(productPreview).not.toContain("MG 参数");
  });

  it("keeps asset library controls compact and avoids duplicate topbar upload", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(workspaceClient).not.toContain('{uploading ? "上传中..." : "上传"}');
    expect(libraryWorkshop).toContain("shadcn-prototype-library-search compact");
    expect(globals).toContain("flex: 0 1 560px");
    expect(globals).toContain("max-width: 560px");
  });

  it("does not show left icons for copy rows and uses media thumbnails for image or video rows", () => {
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");

    expect(libraryWorkshop).toContain("row.kind === \"copy\" ? null");
    expect(libraryWorkshop).toContain("renderLibraryRowMedia(row, view)");
    expect(libraryWorkshop).toContain("shadcn-prototype-library-media-thumb");
  });

  it("uses asset library content type for media thumbnails and leaves non-media assets blank", () => {
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(libraryWorkshop).toContain("libraryRowMediaKind(row)");
    expect(libraryWorkshop).toContain("row.contentType === \"图片\"");
    expect(libraryWorkshop).toContain("row.contentType === \"视频\"");
    expect(libraryWorkshop).toContain("shadcn-prototype-library-media-thumb empty");
    expect(libraryWorkshop).toContain("with-video-media");
    expect(globals).toContain("grid-template-columns: 96px minmax(0, 1fr)");
    expect(globals).toContain(".shadcn-prototype-library-media-thumb.video");
  });
});
