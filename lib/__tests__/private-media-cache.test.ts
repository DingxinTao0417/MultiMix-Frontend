import { afterEach, describe, expect, it, vi } from "vitest";
import { PrivateMediaCache } from "../private-media-cache";

function address(overrides: Record<string, unknown> = {}): string {
  const payload = { uid: 1, aid: 42, fid: 7, identity: "a".repeat(64), exp: Math.floor(Date.now() / 1000) + 1000, ...overrides };
  const token = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${"s".repeat(43)}`;
  return `/api/video-media/projects/42/media/7?token=${token}`;
}
const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("private complete-original cache bounds", () => {
  it("indexes file identity rather than renewed tokens or project versions", () => {
    const cache = new PrivateMediaCache(), original = blob();
    const scope = cache.scope(address())!;
    cache.put(scope, original);
    expect(cache.get(cache.scope(address({ vid: 2, exp: Math.floor(Date.now() / 1000) + 1200 }))!)).toBe(original);
    expect(cache.get(cache.scope(address({ identity: "b".repeat(64) }))!)).toBeNull();
  });

  it("evicts the previous user's entries and refuses their in-flight stores", () => {
    const cache = new PrivateMediaCache();
    const old = cache.scope(address())!;
    cache.put(old, blob());
    const current = cache.scope(address({ uid: 2 }))!;
    expect(cache.get(old)).toBeNull();
    cache.put(old, blob());
    expect(cache.get(current)).toBeNull();
    expect(cache.get(cache.scope(address())!)).toBeNull();
  });

  it("does not let a disposed context repopulate the cache", () => {
    const cache = new PrivateMediaCache(), old = cache.scope(address())!;
    cache.clear();
    cache.put(old, blob());
    expect(cache.get(cache.scope(address())!)).toBeNull();
  });

  it("expires after five minutes without extending lifetime on a hit", () => {
    vi.useFakeTimers();
    const cache = new PrivateMediaCache(), original = blob(), scope = cache.scope(address())!;
    cache.put(scope, original);
    vi.advanceTimersByTime(299_000);
    expect(cache.get(scope)).toBe(original);
    vi.advanceTimersByTime(1_001);
    expect(cache.get(cache.scope(address())!)).toBeNull();
  });

  it("does not keep bytes beyond their original authorization expiry", () => {
    vi.useFakeTimers();
    const cache = new PrivateMediaCache();
    const scope = cache.scope(address({ exp: Math.floor(Date.now() / 1000) + 2 }))!;
    cache.put(scope, blob());
    vi.advanceTimersByTime(2_001);
    expect(cache.get(cache.scope(address())!)).toBeNull();
  });

  it("evicts least recently used entries at eight originals", () => {
    const cache = new PrivateMediaCache();
    const scopes = Array.from({ length: 9 }, (_, index) => cache.scope(address({ identity: index.toString(16).repeat(64) }))!);
    for (const scope of scopes.slice(0, 8)) cache.put(scope, blob());
    cache.get(scopes[0]);
    cache.put(scopes[8], blob());
    expect(cache.get(scopes[0])).not.toBeNull();
    expect(cache.get(scopes[1])).toBeNull();
    expect(cache.get(scopes[8])).not.toBeNull();
  });

  it("bounds aggregate retained bytes and refuses empty or oversized originals", () => {
    const cache = new PrivateMediaCache(), first = cache.scope(address())!;
    const second = cache.scope(address({ identity: "b".repeat(64) }))!;
    const large = new Blob([new Uint8Array(36_077_615)], { type: "video/mp4" });
    cache.put(first, large); cache.put(second, large);
    expect(cache.get(first)).toBeNull();
    expect(cache.get(second)).toBe(large);
    cache.put(first, new Blob([]));
    cache.put(first, new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]));
    expect(cache.get(first)).toBeNull();
    expect(cache.get(second)).toBe(large);
  });

  it.each([
    { uid: "1" }, { aid: 43 }, { fid: 8 }, { identity: "not-a-hash" }, { exp: 0 },
    { exp: Number.MAX_SAFE_INTEGER }, { vid: -1 }, { extra: true },
  ])("never indexes a malformed or path-mismatched grant", invalid => {
    expect(new PrivateMediaCache().scope(address(invalid))).toBeNull();
  });

  it.each([
    "/api/video-media/bgm/media/music?token=signed",
    "https://attacker.test/api/video-media/projects/42/media/7?token=signed",
    "/api/video-media/projects/42/media/7?token=bad",
    address() + "&token=duplicate", address() + "&url=https://attacker.test", address() + "#fragment",
  ])("keeps unsigned, music and unrelated URLs outside the cache", url => {
    expect(new PrivateMediaCache().scope(url)).toBeNull();
  });
});
