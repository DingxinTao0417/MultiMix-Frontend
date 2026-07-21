import { describe, expect, it } from "vitest";

import { parseStoredLocalUser, shouldAttemptLocalDevAdmin } from "../lib/local-auth-session";

describe("local auth session", () => {
  it("restores a saved API session only when it carries a token", () => {
    expect(parseStoredLocalUser(JSON.stringify({
      email: "creator@example.com",
      token: "signed-token",
    }))).toEqual({ email: "creator@example.com", token: "signed-token" });
    expect(parseStoredLocalUser(JSON.stringify({ email: "creator@example.com" }))).toBeNull();
  });

  it("rejects malformed or structurally invalid saved sessions", () => {
    expect(parseStoredLocalUser("not-json")).toBeNull();
    expect(parseStoredLocalUser(JSON.stringify({ email: 42, token: "signed-token" }))).toBeNull();
    expect(parseStoredLocalUser(JSON.stringify({ email: "creator@example.com", token: "" }))).toBeNull();
  });

  it("only probes the optional development administrator in explicit dev-admin mode", () => {
    expect(shouldAttemptLocalDevAdmin("local")).toBe(false);
    expect(shouldAttemptLocalDevAdmin("")).toBe(false);
    expect(shouldAttemptLocalDevAdmin("dev-admin")).toBe(true);
  });
});
