export type LocalUser = {
  email: string;
  token?: string | null;
};

export function shouldAttemptLocalDevAdmin(authMode: string): boolean {
  return authMode.trim().toLowerCase() === "dev-admin";
}

export function parseStoredLocalUser(raw: string | null): LocalUser | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<LocalUser>;
    if (
      typeof value.email !== "string"
      || value.email.trim().length === 0
      || typeof value.token !== "string"
      || value.token.trim().length === 0
    ) return null;
    return { email: value.email, token: value.token };
  } catch {
    return null;
  }
}
