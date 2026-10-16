// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLegalConsentStatus: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("../../assets/components/assets-workspace-client", () => ({
  default: () => <div>工作台已打开</div>,
}));
vi.mock("../../../lib/supabase", () => ({ supabase: null, isSupabaseConfigured: false }));
vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  isApiConfigured: true,
  authLocalDevAdmin: vi.fn().mockRejectedValue(new Error("disabled")),
  getLegalConsentStatus: mocks.getLegalConsentStatus,
}));

import MultiMixApp from "../../multimix-app";

const SIGNED_IN = JSON.stringify({ email: "merchant@example.com", token: "token-1" });

beforeEach(() => {
  window.localStorage.setItem("multimix_local_user", SIGNED_IN);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  mocks.getLegalConsentStatus.mockReset();
});

describe("app shell legal consent gate", () => {
  it("shows the consent gate instead of the workspace when consent is required", async () => {
    mocks.getLegalConsentStatus.mockResolvedValue({ legal_consent_version: "2026-09-16", legal_consent_required: true });
    render(<MultiMixApp basePath="/" />);

    expect(await screen.findByRole("heading", { name: "服务条款与隐私政策已更新" })).toBeInTheDocument();
    expect(screen.queryByText("工作台已打开")).not.toBeInTheDocument();
    expect(mocks.getLegalConsentStatus).toHaveBeenCalledWith("token-1");
  });

  it("opens the workspace when the current version is already accepted", async () => {
    mocks.getLegalConsentStatus.mockResolvedValue({ legal_consent_version: "2026-10-16", legal_consent_required: false });
    render(<MultiMixApp basePath="/" />);

    expect(await screen.findByText("工作台已打开")).toBeInTheDocument();
  });

  it("does not lock users out when an older backend omits the consent field", async () => {
    mocks.getLegalConsentStatus.mockResolvedValue({ legal_consent_version: null });
    render(<MultiMixApp basePath="/" />);

    expect(await screen.findByText("工作台已打开")).toBeInTheDocument();
  });
});
