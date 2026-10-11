const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 8;
const TTL_MS = 5 * 60_000;

export type MediaCacheScope = Readonly<{
  key: string;
  userId: number;
  expiresAt: number;
  epoch: number;
}>;

type Entry = { blob: Blob; expiresAt: number };

// Payload fields are only cache hints. A server request must authorize every hit.
function grantHint(url: string): Omit<MediaCacheScope, "epoch"> | null {
  if (!url.startsWith("/api/video-media/projects/")) return null;
  try {
    const parsed = new URL(url, "https://media-cache.invalid");
    const path = /^\/api\/video-media\/projects\/([1-9]\d*)\/media\/([1-9]\d*)$/.exec(parsed.pathname);
    const tokens = parsed.searchParams.getAll("token");
    if (!path || parsed.hash || tokens.length !== 1 || [...parsed.searchParams.keys()].some(key => key !== "token")) return null;
    const token = tokens[0];
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const encoded = token.split(".", 1)[0];
    const payload = JSON.parse(atob(encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=")));
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const keys = Object.keys(payload);
    if (keys.length !== ("vid" in payload ? 6 : 5) || keys.some(key => !["uid", "aid", "fid", "identity", "exp", "vid"].includes(key))) return null;
    for (const key of ["uid", "aid", "fid", "exp", ...("vid" in payload ? ["vid"] : [])]) {
      if (!Number.isSafeInteger(payload[key]) || payload[key] <= 0) return null;
    }
    if (String(payload.aid) !== path[1] || String(payload.fid) !== path[2]
      || typeof payload.identity !== "string" || !/^[a-f0-9]{64}$/.test(payload.identity)) return null;
    const expiresAt = payload.exp * 1000;
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return null;
    return { key: `${payload.uid}:${payload.aid}:${payload.fid}:${payload.identity}`, userId: payload.uid, expiresAt };
  } catch { return null; }
}

// Private to this editor context; no persistent storage or public HTTP caching.
export class PrivateMediaCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  private epoch = 0;
  private userId: number | null = null;

  scope(url: string): MediaCacheScope | null {
    const hint = grantHint(url);
    if (!hint) return null;
    if (this.userId !== null && this.userId !== hint.userId) this.clear();
    this.userId = hint.userId;
    this.prune();
    return { ...hint, epoch: this.epoch };
  }

  get(scope: MediaCacheScope): Blob | null {
    this.prune();
    if (!this.isCurrent(scope)) return null;
    const entry = this.entries.get(scope.key);
    if (!entry) return null;
    this.entries.delete(scope.key);
    this.entries.set(scope.key, entry);
    return entry.blob;
  }

  put(scope: MediaCacheScope, blob: Blob): void {
    this.prune();
    if (!this.isCurrent(scope) || blob.size <= 0 || blob.size > MAX_BYTES) return;
    this.remove(scope);
    while (this.entries.size >= MAX_ENTRIES || this.bytes + blob.size > MAX_BYTES) {
      this.removeKey(this.entries.keys().next().value!);
    }
    this.entries.set(scope.key, { blob, expiresAt: Math.min(scope.expiresAt, Date.now() + TTL_MS) });
    this.bytes += blob.size;
  }

  remove(scope: MediaCacheScope): void {
    if (scope.epoch === this.epoch) this.removeKey(scope.key);
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
    this.userId = null;
    this.epoch += 1;
  }

  private isCurrent(scope: MediaCacheScope): boolean {
    return scope.epoch === this.epoch && scope.userId === this.userId && scope.expiresAt > Date.now();
  }

  private removeKey(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.bytes -= entry.blob.size;
    this.entries.delete(key);
  }

  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= Date.now()) this.removeKey(key);
    }
  }
}
