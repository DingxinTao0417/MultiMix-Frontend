type PreviewPlaybackUpdateSubscription = {
  publish: () => void;
  minIntervalMs?: number;
  now?: () => number;
};

export function subscribePreviewPlaybackUpdates({
  publish,
  minIntervalMs = 100,
  now = () => performance.now(),
}: PreviewPlaybackUpdateSubscription): () => void {
  let lastPublishedAt = Number.NEGATIVE_INFINITY;
  const handlePlaybackUpdate = () => {
    const currentTime = now();
    if (currentTime - lastPublishedAt < minIntervalMs) return;
    lastPublishedAt = currentTime;
    publish();
  };

  window.addEventListener("playback-update", handlePlaybackUpdate);
  return () => window.removeEventListener("playback-update", handlePlaybackUpdate);
}
