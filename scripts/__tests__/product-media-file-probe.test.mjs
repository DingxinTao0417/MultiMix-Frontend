import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDeclaredProductMediaMetadata,
  probeProductMediaFile,
} from "../product-media-file-probe.mjs";

test("product media probe returns factual image dimensions without a fake default", () => {
  const calls = [];
  const result = probeProductMediaFile("C:/fixtures/interface.png", {
    command: "ffprobe-custom",
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return {
        status: 0,
        stdout: JSON.stringify({
          streams: [{ codec_type: "video", width: 1258, height: 1286 }],
          format: { duration: "N/A" },
        }),
        stderr: "",
      };
    },
  });

  assert.deepEqual(result, { width: 1258, height: 1286, durationSeconds: null });
  assert.equal(calls[0].command, "ffprobe-custom");
  assert.equal(calls[0].args.at(-1), "C:/fixtures/interface.png");
  assert.equal(calls[0].options.timeout, 30_000);
});

test("product media probe fails closed when the file has no valid visual stream", () => {
  assert.throws(
    () => probeProductMediaFile("C:/fixtures/broken.png", {
      spawn: () => ({
        status: 0,
        stdout: JSON.stringify({ streams: [], format: {} }),
        stderr: "",
      }),
    }),
    /valid visual dimensions/,
  );
});

test("product media probe reports a bounded command failure", () => {
  assert.throws(
    () => probeProductMediaFile("C:/fixtures/interface.mp4", {
      spawn: () => ({
        status: null,
        signal: "SIGTERM",
        stdout: "",
        stderr: "probe timed out",
      }),
    }),
    /ffprobe failed.*probe timed out/,
  );
});

test("declared product media dimensions cannot contradict probed facts", () => {
  assert.throws(
    () => assertDeclaredProductMediaMetadata(
      { width: 2048, height: 1024 },
      { width: 1258, height: 1286, durationSeconds: null },
      { mediaType: "image", label: "capture 1" },
    ),
    /capture 1 declared width=2048.*probed width=1258/,
  );
});

test("video product media requires a positive probed duration", () => {
  assert.throws(
    () => assertDeclaredProductMediaMetadata(
      {},
      { width: 1920, height: 1080, durationSeconds: null },
      { mediaType: "video", label: "capture 2" },
    ),
    /capture 2 requires a positive probed duration/,
  );
});

test("matching optional declarations preserve the probed media facts", () => {
  const facts = { width: 1876, height: 1132, durationSeconds: 3.25 };

  assert.deepEqual(
    assertDeclaredProductMediaMetadata(
      { width: 1876, height: 1132, duration_seconds: 3.25 },
      facts,
      { mediaType: "video", label: "capture 3" },
    ),
    facts,
  );
});
