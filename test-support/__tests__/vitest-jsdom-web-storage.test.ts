// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

describe("Vitest jsdom Web Storage", () => {
  it("uses the test window's localStorage and sessionStorage instead of Node globals", () => {
    const testWindow = (globalThis as typeof globalThis & {
      jsdom?: { window: Window };
    }).jsdom?.window;

    expect(testWindow).toBeDefined();
    expect(globalThis.localStorage).toBe(testWindow?.localStorage);
    expect(globalThis.sessionStorage).toBe(testWindow?.sessionStorage);

    localStorage.setItem("local-storage-contract", "local");
    sessionStorage.setItem("session-storage-contract", "session");

    expect(localStorage.getItem("local-storage-contract")).toBe("local");
    expect(sessionStorage.getItem("session-storage-contract")).toBe("session");
  });
});
