import { spawnSync } from "node:child_process";

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const DECLARED_DURATION_TOLERANCE_SECONDS = 0.05;

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function positiveFinite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function probeProductMediaFile(
  sourcePath,
  {
    command = "ffprobe",
    spawn = spawnSync,
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  } = {},
) {
  const result = spawn(
    command,
    [
      "-v", "error",
      "-show_entries", "stream=codec_type,width,height:format=duration",
      "-of", "json",
      sourcePath,
    ],
    {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) {
    const detail = String(
      result.error?.message
      ?? result.stderr
      ?? result.signal
      ?? `exit ${result.status}`,
    ).trim().slice(0, 500);
    throw new Error(`Product media ffprobe failed for ${sourcePath}: ${detail || "unknown error"}`);
  }
  let payload;
  try {
    payload = JSON.parse(String(result.stdout ?? ""));
  } catch (error) {
    throw new Error(`Product media ffprobe returned invalid JSON for ${sourcePath}: ${error.message}`);
  }
  const stream = Array.isArray(payload.streams)
    ? payload.streams.find((candidate) => (
        positiveInteger(candidate?.width) !== null
        && positiveInteger(candidate?.height) !== null
      ))
    : null;
  const width = positiveInteger(stream?.width);
  const height = positiveInteger(stream?.height);
  if (width === null || height === null) {
    throw new Error(`Product media file has no valid visual dimensions: ${sourcePath}`);
  }
  return {
    width,
    height,
    durationSeconds: positiveFinite(payload.format?.duration),
  };
}

export function assertDeclaredProductMediaMetadata(
  declared,
  probed,
  { mediaType, label },
) {
  for (const [declaredKey, factKey] of [
    ["width", "width"],
    ["height", "height"],
  ]) {
    if (declared?.[declaredKey] === undefined) continue;
    const value = Number(declared[declaredKey]);
    if (value !== probed[factKey]) {
      throw new Error(
        `${label} declared ${declaredKey}=${declared[declaredKey]} `
        + `but probed ${factKey}=${probed[factKey]}`,
      );
    }
  }
  if (mediaType === "video" && positiveFinite(probed.durationSeconds) === null) {
    throw new Error(`${label} requires a positive probed duration`);
  }
  if (declared?.duration_seconds !== undefined) {
    const declaredDuration = positiveFinite(declared.duration_seconds);
    if (
      declaredDuration === null
      || probed.durationSeconds === null
      || Math.abs(declaredDuration - probed.durationSeconds)
        > DECLARED_DURATION_TOLERANCE_SECONDS
    ) {
      throw new Error(
        `${label} declared duration_seconds=${declared.duration_seconds} `
        + `but probed duration_seconds=${probed.durationSeconds}`,
      );
    }
  }
  return probed;
}
