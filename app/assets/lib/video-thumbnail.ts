const MAX_ACTIVE_DECODERS = 2;
const DECODE_TIMEOUT_MS = 12_000;
const THUMBNAIL_MAX_WIDTH = 640;
let activeDecoders = 0;
const pending: Array<() => void> = [];

function drain() {
  while (activeDecoders < MAX_ACTIVE_DECODERS && pending.length) pending.shift()?.();
}

// Read-only compatibility for videos persisted before durable posters were added.
export function readVideoThumbnail(source: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const cancelQueued = () => {
      const index = pending.indexOf(start);
      if (index >= 0) pending.splice(index, 1);
      reject(new DOMException("Aborted", "AbortError"));
    };
    function start() {
      signal.removeEventListener("abort", cancelQueued);
      if (signal.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
      activeDecoders += 1;
      const video = document.createElement("video");
      let done = false;
      const timer = setTimeout(() => finish(new Error("Video thumbnail timed out")), DECODE_TIMEOUT_MS);
      function finish(error?: Error, frame?: string) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", cancel);
        video.removeEventListener("loadeddata", capture);
        video.removeEventListener("error", failed);
        video.pause();
        video.removeAttribute("src");
        video.load();
        activeDecoders -= 1;
        if (error) reject(error); else resolve(frame!);
        drain();
      }
      function cancel() { finish(new DOMException("Aborted", "AbortError")); }
      function failed() { finish(new Error("Video thumbnail unavailable")); }
      function capture() {
        if (!video.videoWidth || !video.videoHeight) { failed(); return; }
        try {
          const canvas = document.createElement("canvas");
          canvas.width = Math.min(THUMBNAIL_MAX_WIDTH, video.videoWidth);
          canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
          const context = canvas.getContext("2d");
          if (!context) { failed(); return; }
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          finish(undefined, canvas.toDataURL("image/jpeg", 0.82));
        } catch { failed(); }
      }
      signal.addEventListener("abort", cancel, { once: true });
      video.addEventListener("loadeddata", capture);
      video.addEventListener("error", failed, { once: true });
      video.crossOrigin = "anonymous";
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = source;
      video.load();
    }
    signal.addEventListener("abort", cancelQueued, { once: true });
    pending.push(start);
    drain();
  });
}
