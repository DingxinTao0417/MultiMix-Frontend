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
    expect(productPreview).toContain("编导稿摘要");
    expect(productPreview).toContain("编导稿草稿");
    expect(productPreview).toContain("当前是可编辑编导稿");
    expect(productPreview).not.toContain("<span>视频方案</span>");
    expect(productPreview).toContain("查看分镜详情");
    expect(productPreview).toContain("自动补素材");
  });

  it("keeps material gap display lightweight", () => {
    const productPreview = readAssetFile("app/assets/components/product-preview.tsx");

    expect(productPreview).toContain("shadcn-prototype-video-plan-gap");
    expect(productPreview).toContain("字幕/标题卡占位");
    expect(productPreview).toContain("个分镜自动加 MG");
    expect(productPreview).toContain("MG 风格：");
    expect(productPreview).toContain("MG：");
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
    expect(globals).toContain(".shadcn-prototype-library-grid.view-video");
    expect(globals).toContain(".shadcn-prototype-library-media-thumb.video");
  });

  it("supports chat source attachments inside the composer", () => {
    const conversationStudio = readAssetFile("app/assets/components/conversation-studio.tsx");
    const conversationStart = readAssetFile("app/assets/components/conversation-start.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(conversationStudio).toContain("shadcn-prototype-chat-image-attachment-button");
    expect(conversationStudio).toContain("shadcn-prototype-chat-file-attachment-button");
    expect(conversationStudio).toContain("IMAGE_UPLOAD_ACCEPT");
    expect(conversationStudio).toContain("SOURCE_UPLOAD_ACCEPT");
    expect(conversationStart).toContain("shadcn-prototype-start-dock-attach");
    expect(conversationStart).toContain("IMAGE_UPLOAD_ACCEPT");
    expect(conversationStart).toContain("SOURCE_UPLOAD_ACCEPT");
    expect(conversationStudio).toContain(".pptx");
    expect(conversationStudio).toContain("DOC_ONLY_INSTRUCTION");
    expect(conversationStudio).toContain("shadcn-prototype-chat-attachment-tray");
    expect(conversationStudio).toContain("shadcn-prototype-composer-control has-attachments");
    expect(conversationStudio).toContain("shadcn-prototype-chat-drop-hint");
    expect(conversationStudio).toContain("只上传资料时，我会先询问要基于它做什么");
    expect(globals).toContain(".shadcn-prototype-chat-attachment-tray");
    expect(globals).toContain("shadcn-prototype-composer-control.has-attachments");
    expect(globals).toContain("shadcn-prototype-composer-control.drag-active");
    expect(globals).toContain(".shadcn-prototype-chat-drop-hint");
    expect(globals).toContain(".shadcn-prototype-chat-file-attachment-button");
  });

  it("renders the demo-final start hero and input dock", () => {
    const conversationStart = readAssetFile("app/assets/components/conversation-start.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(conversationStart).toContain("今天想做什么内容？");
    expect(conversationStart).toContain("从一句话开始，MultiMix 会带着你的素材一起创作");
    expect(conversationStart).toContain("shadcn-prototype-start-dock");
    expect(conversationStart).toContain("支持拖入 PPT / 图片素材 · 只上传资料时，AI 会先问你要做什么");
    expect(conversationStart).toContain("shadcn-prototype-start-sugg-card");
    expect(globals).toContain(".shadcn-prototype-start-dock");
    expect(globals).toContain(".shadcn-prototype-start-sugg-grid");
    expect(globals).toContain("min-height: 52px");
  });

  it("uses uploaded documents as direct conversation source assets", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const adapter = readAssetFile("app/assets/lib/asset-workspace-adapter.ts");

    expect(workspaceClient).toContain("createMaterialPackage");
    expect(workspaceClient).toContain("materialPackageAsset");
    expect(workspaceClient).toContain("sourceAttachmentAssets");
    expect(workspaceClient).toContain("upload.fileKind === \"source\"");
    expect(workspaceClient).toContain("上传图片不能超过 20 张");
    expect(adapter).toContain("/assets/material-packages");
  });

  it("offers download and delete actions for every library detail view", () => {
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const adapter = readAssetFile("app/assets/lib/asset-workspace-adapter.ts");

    expect(adapter).toContain("downloadAsset(token: string, assetId: number): Promise<Blob>");
    expect(adapter).toContain("deleteAsset(token: string, assetId: number): Promise<void>");
    expect(adapter).toContain("/download");
    expect(adapter).toContain('method: "DELETE"');
    expect(libraryWorkshop).toContain("handleDownload");
    expect(libraryWorkshop).toContain("handleDelete");
    expect(libraryWorkshop).toContain("确认删除");
    expect((libraryWorkshop.match(/<Download size=\{14\} aria-hidden=\"true\" \/>下载/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((libraryWorkshop.match(/删除/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
