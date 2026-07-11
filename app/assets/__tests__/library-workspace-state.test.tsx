// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LibraryWorkspaceLoading } from "../components/library-workspace-state";

describe("library workspace dynamic states", () => {
  it("shows an accessible image-library loading state", () => {
    render(<LibraryWorkspaceLoading title="图片库" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("正在加载图片库…")).toBeInTheDocument();
  });
});
