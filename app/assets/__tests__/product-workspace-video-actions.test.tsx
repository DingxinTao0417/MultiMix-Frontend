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
  it("opens the material picker without leaving the finished-video browse surface", async () => {
    const product = displayProducts["case-06-project-ready-no-mp4"];
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("asset-suggestions")) {
        return new Response(JSON.stringify({ suggestions: [{ asset_id: 12, title: "施工过程记录", preview_url: "", match_reason: "匹配施工过程" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
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

    expect(screen.getByLabelText("成片预览")).toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: "为分镜 #1 换素材" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /施工过程记录/ })).toBeInTheDocument());
  });
});
