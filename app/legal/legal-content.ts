export const LEGAL_VERSION = "2026-09-16";
export const LEGAL_EFFECTIVE_DATE = "2026 年 9 月 16 日";
export const LEGAL_OPERATOR = {
  name: "",
  registeredAddress: "",
  contactEmail: "",
} as const;

export function displayLegalField(value: string): string {
  return value.trim() || "—";
}

export type LegalConsentMetadata = {
  legal_consent_version: string;
  terms_version: string;
  privacy_version: string;
  legal_consented_at: string;
};

export function createLegalConsentMetadata(now = new Date()): LegalConsentMetadata {
  return {
    legal_consent_version: LEGAL_VERSION,
    terms_version: LEGAL_VERSION,
    privacy_version: LEGAL_VERSION,
    legal_consented_at: now.toISOString(),
  };
}

export function passwordResetRedirect(origin: string): string {
  return new URL("/auth/reset-password", origin).toString();
}
