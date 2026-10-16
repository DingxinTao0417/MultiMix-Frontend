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

describe("public material retirement in legal text", () => {
  it("no longer discloses stock providers or public material search", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const page of ["terms/page.tsx", "privacy/page.tsx"]) {
      const text = readFileSync(join(__dirname, "..", page), "utf-8");
      expect(text).not.toMatch(/Pexels|Unsplash|公共素材检索可能|和公共素材检索/);
    }
    expect(LEGAL_VERSION).toBe("2026-10-16");
  });
});
