// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { trackProductEvent } from "@/lib/product-analytics";
import ConversationStart from "../components/conversation-start";
import ProductWorkspace from "../components/product-workspace";
import { conversationForDisplayProduct, displayProducts } from "./fixtures/display-products";


vi.mock("@/lib/product-analytics", () => ({
  getProductAnalyticsSessionId: () => "test-session",
  trackProductEvent: vi.fn(async () => undefined),
}));


afterEach(() => {
  cleanup();
  vi.mocked(trackProductEvent).mockClear();
});


describe("product analytics event points", () => {
  it("tracks workspace entry and a stable recommendation key without its prompt", async () => {
    const product = displayProducts["case-02-saved-asset-match"];
    render(
      <ConversationStart
        suggestions={["制作讲解型视频"]}
        conversation={conversationForDisplayProduct(product)}
        token="token"
      />,
    );

    await waitFor(() => expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "workspace_opened",
      sessionId: "test-session",
      properties: { entry_surface: "new_conversation" },
    }));
    fireEvent.click(screen.getByRole("button", { name: /制作讲解型视频/ }));

    expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "recommendation_selected",
      properties: { recommendation_key: "explainer-video" },
    });
    expect(JSON.stringify(vi.mocked(trackProductEvent).mock.calls)).not.toContain(
      "制作一条讲解型视频，先根据我的素材和目标确认比例、时长与配音。",
    );
  });

  it("tracks opening source evidence with only the public asset id", () => {
    const base = displayProducts["case-06-project-ready-no-mp4"];
    const product = {
      ...base,
      backendAssetId: 402,
      sourceSummary: {
        headline: "2 项素材依据",
        note: "来源可追溯",
        refs: [{ id: "source-1", title: "门店素材", referenceCount: 1 }],
      },
    };
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

    fireEvent.click(screen.getAllByText("2 项素材依据").at(-1)!);

    expect(trackProductEvent).toHaveBeenCalledWith("token", {
      eventName: "source_evidence_opened",
      assetId: 402,
    });
  });
});
