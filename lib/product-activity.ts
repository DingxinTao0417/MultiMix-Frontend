import { getProductAnalyticsSessionId, trackProductEvent } from "./product-analytics";

export const VIDEO_ACTIVITY_IDLE_MS = 15_000;
export const VIDEO_ACTIVITY_INTERVAL_MS = 30_000;
const OBSERVER_TICK_MS = 1_000;

export class ActiveVideoIntervals {
  private start: number | null = null;
  private lastActivity = 0;
  private lastTick: number | null = null;

  constructor(readonly emit: (start: number, end: number) => void) {}

  interact(time: number): void {
    this.tick(time);
    this.start ??= time;
    this.lastActivity = time;
  }

  tick(time: number): void {
    if (this.lastTick !== null && (time < this.lastTick || time - this.lastTick > VIDEO_ACTIVITY_INTERVAL_MS)) {
      this.start = null;
    }
    this.lastTick = time;
    let start = this.start;
    if (start === null) return;
    const end = Math.min(time, this.lastActivity + VIDEO_ACTIVITY_IDLE_MS);
    while (end - start >= VIDEO_ACTIVITY_INTERVAL_MS) {
      const boundary: number = start + VIDEO_ACTIVITY_INTERVAL_MS;
      this.emit(start, boundary);
      start = boundary;
    }
    this.start = start;
    if (time >= this.lastActivity + VIDEO_ACTIVITY_IDLE_MS) {
      if (end > start) this.emit(start, end);
      this.start = null;
    }
  }

  suspend(time: number): void {
    this.tick(time);
    if (this.start !== null && time > this.start) this.emit(this.start, time);
    this.start = null;
  }
}

export function observeVideoActivity(token: string | null, assetId: number | null, enabled: boolean): () => void {
  return observeActivity(token, assetId, enabled, "video_active_interval");
}

export function observeDirectorActivity(token: string | null, assetId: number | null, enabled: boolean): () => void {
  return observeActivity(token, assetId, enabled, "director_active_interval");
}

function observeActivity(token: string | null, assetId: number | null, enabled: boolean,
  eventName: "video_active_interval" | "director_active_interval"): () => void {
  if (!enabled || !token || !assetId || !Number.isSafeInteger(assetId) || assetId <= 0) return () => {};
  const sessionId = getProductAnalyticsSessionId();
  const recorder = new ActiveVideoIntervals((start, end) => {
    void trackProductEvent(token, { eventName, assetId, sessionId,
      properties: { interval_start_ms: start, interval_end_ms: end } });
  });
  const eligible = () => document.visibilityState === "visible" && document.hasFocus()
    && !(document.activeElement instanceof HTMLIFrameElement);
  const onActivity = (event: Event) => {
    if (event.isTrusted && eligible()) recorder.interact(Date.now());
  };
  const suspend = () => recorder.suspend(Date.now());
  const onVisibility = () => { if (!eligible()) suspend(); };
  const events = ["pointerdown", "keydown", "input", "wheel"] as const;
  for (const name of events) document.addEventListener(name, onActivity, { passive: true, capture: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("blur", suspend);
  window.addEventListener("pagehide", suspend);
  const timer = window.setInterval(() => {
    if (eligible()) recorder.tick(Date.now());
    else suspend();
  }, OBSERVER_TICK_MS);
  return () => {
    suspend();
    window.clearInterval(timer);
    for (const name of events) document.removeEventListener(name, onActivity, true);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("blur", suspend);
    window.removeEventListener("pagehide", suspend);
  };
}
