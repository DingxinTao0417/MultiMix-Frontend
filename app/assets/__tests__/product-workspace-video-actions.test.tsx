// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("video browse actions", () => {
  it("keeps the editor closed until planned MG overlays reach a terminal state", () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
        videoJobLive={{
          jobId: "main-job",
          status: "completed",
          renderStage: "done",
          steps: [{ key: "mg_overlay", label: "生成并添加 MG 动效", status: "run", elapsedSeconds: null, retryJobId: null }],
          errorMessage: null,
          completionConfirmed: false,
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "MG 合成中…" })).toBeDisabled();
  });

  it("opens the material picker without leaving the finished-video browse surface", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    const localCandidates = {
      scope: "local",
      segment_id: "segment-1",
      groups: {
        current: [],
        recommended: [{
          candidate_id: "cand-12",
          source_type: "saved_asset",
          source_asset_id: 12,
          provider: "library",
          provider_item_id: "12",
          media_type: "image",
          title: "施工过程记录",
          preview_url: "",
          width: 0,
          height: 0,
          duration: 0,
          license: "",
          author: "",
          attribution_url: "",
          verification_status: "persisted",
          relevance_status: "recommended",
          relevance_reason: "匹配施工过程",
          requires_trim: false,
          already_persisted: true,
          selectable: true,
        }],
        library: [],
        public: [],
      },
      provider_statuses: [],
      next_cursor: null,
    };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("material-candidates") && url.includes("scope=local")) {
        return new Response(JSON.stringify(localCandidates), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("material-candidates")) {
        return new Response(JSON.stringify({ scope: "public", segment_id: "segment-1", groups: { current: [], recommended: [], library: [], public: [] }, provider_statuses: [], next_cursor: null }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    render(
      <ProductWorkspace
        copied={false}
        onCopyProduct={vi.fn(async () => undefined)}
        onSaveProduct={vi.fn(async () => undefined)}
        product={product}
        selectedConversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "换素材" })[0]!);

    expect(screen.getByLabelText("分镜预览")).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "为分镜 #1 换素材" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /施工过程记录/ })).toBeInTheDocument());
  });
});
