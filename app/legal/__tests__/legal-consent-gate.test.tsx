// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  acceptLegalConsent: vi.fn(),
}));

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  acceptLegalConsent: mocks.acceptLegalConsent,
}));

import { LegalConsentGate } from "../legal-consent-gate";
import { LEGAL_VERSION } from "../legal-content";

afterEach(() => {
  cleanup();
  mocks.acceptLegalConsent.mockReset();
});

describe("legal re-consent gate", () => {
  it("cannot continue until the user ticks agreement", () => {
    render(<LegalConsentGate token="t" onAccepted={vi.fn()} onLogout={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "服务条款与隐私政策已更新" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "《服务条款》" })).toHaveAttribute("href", "/legal/terms");
    expect(screen.getByRole("link", { name: "《隐私政策》" })).toHaveAttribute("href", "/legal/privacy");
    expect(screen.getByRole("button", { name: "同意并继续" })).toBeDisabled();
  });

  it("records the current version and lets the user in", async () => {
    mocks.acceptLegalConsent.mockResolvedValue({ legal_consent_version: LEGAL_VERSION, legal_consent_required: false });
    const onAccepted = vi.fn();
    render(<LegalConsentGate token="token-1" onAccepted={onAccepted} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "同意并继续" }));

    await waitFor(() => expect(onAccepted).toHaveBeenCalledTimes(1));
    expect(mocks.acceptLegalConsent).toHaveBeenCalledWith("token-1", LEGAL_VERSION);
  });

  it("stays on the gate and shows the reason when saving fails", async () => {
    mocks.acceptLegalConsent.mockRejectedValue(new Error("条款已更新，请刷新页面后阅读并同意最新版本。"));
    const onAccepted = vi.fn();
    render(<LegalConsentGate token="t" onAccepted={onAccepted} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "同意并继续" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("条款已更新，请刷新页面后阅读并同意最新版本。");
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("does not let the user in when the server still reports consent as required", async () => {
    mocks.acceptLegalConsent.mockResolvedValue({ legal_consent_version: null, legal_consent_required: true });
    const onAccepted = vi.fn();
    render(<LegalConsentGate token="t" onAccepted={onAccepted} onLogout={vi.fn()} />);

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "同意并继续" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("同意记录未保存");
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it("offers signing out instead of agreeing", () => {
    const onLogout = vi.fn();
    render(<LegalConsentGate token="t" onAccepted={vi.fn()} onLogout={onLogout} />);

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));
    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it("uses the same version as the backend", () => {
    // The frontend repo root is three levels up; a task worktree lives two more
    // levels below the primary checkout, so look in both places.
    const frontendRoot = join(__dirname, "..", "..", "..");
    const candidates = [
      join(frontendRoot, "..", "MultiMix-Backend", "app", "legal_versions.py"),
      join(frontendRoot, "..", "..", "..", "MultiMix-Backend", "app", "legal_versions.py"),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) return; // standalone frontend clone without the backend checkout
    expect(readFileSync(path, "utf-8")).toContain(`CURRENT_LEGAL_VERSION = "${LEGAL_VERSION}"`);
  });
});
