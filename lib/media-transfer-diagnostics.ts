export type RelayTiming = {
  upstreamHeadersMs: number;
  upstreamBodyMs: number;
  relayMs: number;
};

const metrics = [
  ["media_headers", "upstreamHeadersMs"],
  ["media_body", "upstreamBodyMs"],
  ["media_relay", "relayMs"],
] as const;

export function relayTimingHeader(timing: RelayTiming): string {
  if (metrics.some(([, key]) => !Number.isFinite(timing[key]) || timing[key] < 0)) return "";
  return metrics.map(([name, key]) => `${name};dur=${Math.max(0, Math.round(timing[key]))}`).join(", ");
}

export function parseRelayTiming(header: string | null): RelayTiming | undefined {
  if (!header || header.length > 512) return;
  const values: Partial<RelayTiming> = {};
  for (const part of header.split(",")) {
    const match = /^\s*(media_headers|media_body|media_relay);dur=(\d+(?:\.\d+)?)\s*$/.exec(part);
    if (!match) return;
    const metric = metrics.find(([name]) => name === match[1])!;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || values[metric[1]] !== undefined) return;
    values[metric[1]] = value;
  }
  if (metrics.some(([, key]) => values[key] === undefined)) return;
  return values as RelayTiming;
}

const numericFields = ["rangeStart", "receivedBytes", "status", "durationMs", "responseWaitMs",
  "bodyReadMs", "firstByteMs", "lastByteMs", "maxBodyIdleMs", "interPartGapMs", "freezeCount",
  "resumeCount", "upstreamHeadersMs", "upstreamBodyMs", "relayMs"] as const;
type NumericFields = Partial<Record<typeof numericFields[number], number>>;
type Visibility = "visible" | "hidden" | "unknown";
export type MediaDiagnostic = NumericFields & {
  outcome: "started" | "received" | "delivered" | "failed";
  startVisibility?: Visibility;
  endVisibility?: Visibility;
  failedAt?: "await_response" | "read_body" | "validate";
  reason?: "timeout" | "cancelled" | "upstream" | "contract" | "body";
};

// Whitelist serialization is intentional: URLs, signed grants and object identities never enter logs.
export function reportMediaDiagnostic(prefix: "MediaPart" | "MediaRelay", event: MediaDiagnostic): void {
  try {
    const safe: Record<string, unknown> = { timestamp: new Date().toISOString() };
    if (["started", "received", "delivered", "failed"].includes(event.outcome)) safe.outcome = event.outcome;
    for (const key of numericFields) {
      const value = event[key];
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) safe[key] = Math.round(value);
    }
    for (const key of ["startVisibility", "endVisibility"] as const) {
      if (["visible", "hidden", "unknown"].includes(event[key] ?? "")) safe[key] = event[key];
    }
    if (["await_response", "read_body", "validate"].includes(event.failedAt ?? "")) safe.failedAt = event.failedAt;
    if (["timeout", "cancelled", "upstream", "contract", "body"].includes(event.reason ?? "")) safe.reason = event.reason;
    console[event.outcome === "failed" ? "warn" : "info"](`[${prefix}] ${JSON.stringify(safe)}`);
  } catch { /* Diagnostic output must never alter media preparation. */ }
}

function visibility(): Visibility {
  try {
    const state = typeof document !== "undefined" ? document.visibilityState : undefined;
    return state === "visible" || state === "hidden" ? state : "unknown";
  } catch { return "unknown"; }
}

export function observeMediaPage() {
  const startVisibility = visibility();
  let freezeCount = 0, resumeCount = 0;
  const freeze = () => { freezeCount += 1; };
  const resume = () => { resumeCount += 1; };
  let observed: Document | undefined;
  try {
    if (typeof document !== "undefined") {
      observed = document;
      observed.addEventListener("freeze", freeze);
      observed.addEventListener("resume", resume);
    }
  } catch { /* Page lifecycle capabilities vary by browser. */ }
  return {
    snapshot: () => ({ startVisibility, endVisibility: visibility(), freezeCount, resumeCount }),
    dispose: () => {
      try {
        observed?.removeEventListener("freeze", freeze);
        observed?.removeEventListener("resume", resume);
      } catch { /* Diagnostics cannot alter the media result. */ }
    },
  };
}
