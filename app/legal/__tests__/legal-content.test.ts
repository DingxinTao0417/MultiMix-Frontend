import { describe, expect, it } from "vitest";
import {
  LEGAL_VERSION,
  createLegalConsentMetadata,
  displayLegalField,
  passwordResetRedirect,
} from "../legal-content";

describe("public legal and recovery contracts", () => {
  it("records one version and an auditable consent time", () => {
    const now = new Date("2026-09-16T04:30:00.000Z");

    expect(createLegalConsentMetadata(now)).toEqual({
      legal_consent_version: LEGAL_VERSION,
      terms_version: LEGAL_VERSION,
      privacy_version: LEGAL_VERSION,
      legal_consented_at: "2026-09-16T04:30:00.000Z",
    });
  });

  it("keeps password recovery on the current trusted origin", () => {
    expect(passwordResetRedirect("https://multimix-frontend.vercel.app")).toBe(
      "https://multimix-frontend.vercel.app/auth/reset-password",
    );
  });

  it("renders intentionally blank operator fields without inventing legal facts", () => {
    expect(displayLegalField("")).toBe("—");
    expect(displayLegalField("  ")).toBe("—");
    expect(displayLegalField("MultiMix Example Co.")).toBe("MultiMix Example Co.");
  });
});
