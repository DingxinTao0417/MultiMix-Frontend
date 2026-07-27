import fs from "node:fs";
import http from "node:http";
import path from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";

const frontendRoot = path.resolve(import.meta.dirname, "..");
const inputArgument = process.argv
  .slice(2)
  .find((argument) => !argument.startsWith("--"));
const inputVideo = path.resolve(
  inputArgument ?? process.env.VIDEO_CACHE_PROBE_VIDEO ?? "",
);
const alpha = process.argv.includes("--alpha")
  || process.env.VIDEO_CACHE_PROBE_ALPHA === "1";

if (!inputArgument && !process.env.VIDEO_CACHE_PROBE_VIDEO) {
  throw new Error(
    "Pass an input video path or set VIDEO_CACHE_PROBE_VIDEO.",
  );
}
if (!fs.existsSync(inputVideo)) {
  throw new Error(`Video cache probe input does not exist: ${inputVideo}`);
}

const inputExtension = path.extname(inputVideo).toLowerCase();
const mediaType = inputExtension === ".webm" ? "video/webm" : "video/mp4";
const probePath = `/probe${inputExtension || ".mp4"}`;
const probeName = `probe${inputExtension || ".mp4"}`;

const serviceEntry = path.join(
  frontendRoot,
  "editor-engine",
  "vendor",
  "editor",
  "services",
  "video-cache",
  "service.ts",
);
const bundle = await build({
  entryPoints: [serviceEntry],
  bundle: true,
  format: "esm",
  platform: "browser",
  sourcemap: "inline",
  write: false,
});
const serviceJavaScript = bundle.outputFiles[0].text;
const videoStat = fs.statSync(inputVideo);

const html = `<!doctype html>
<html>
  <body>
    <script type="module">
      import { VideoCache } from "/video-cache.js";

      window.runVideoCacheProbe = async () => {
        window.activeVideoCacheProbe?.clearAll();
        const response = await fetch(${JSON.stringify(probePath)});
        if (!response.ok) throw new Error(\`video fetch failed: \${response.status}\`);
        const blob = await response.blob();
        const file = new File([blob], ${JSON.stringify(probeName)}, {
          type: ${JSON.stringify(mediaType)},
        });
        const cache = new VideoCache();
        const mediaIds = ["probe-1", "probe-2", "probe-3", "probe-4"];
        const timePairs = [
          [0.05, 0.8],
          [0.5, 1.4],
          [1.2, 2.2],
          [2.4, 3.1],
          [3.8, 0.2],
          [4.4, 1.0],
          [2.8, 0.1],
        ];

        for (const [firstTime, secondTime] of timePairs) {
          await Promise.all(mediaIds.map(async (mediaId) => {
            const [first, second] = await Promise.all([
              cache.getFrameAt({
                mediaId,
                file,
                time: firstTime,
                alpha: ${JSON.stringify(alpha)},
              }),
              cache.getFrameAt({
                mediaId,
                file,
                time: secondTime,
                alpha: ${JSON.stringify(alpha)},
              }),
            ]);
            if (!first || !second) {
              throw new Error(
                \`missing canvas for \${mediaId} at \${firstTime}/\${secondTime}\`,
              );
            }
          }));
        }

        window.activeVideoCacheProbe = cache;
        return cache.getStats();
      };
      window.clearVideoCacheProbe = () => {
        window.activeVideoCacheProbe?.clearAll();
        const stats = window.activeVideoCacheProbe?.getStats() ?? null;
        window.activeVideoCacheProbe = null;
        return stats;
      };
      window.videoCacheProbeReady = true;
    </script>
  </body>
</html>`;

const server = http.createServer((request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.url === "/video-cache.js") {
    response.writeHead(200, {
      "Content-Type": "text/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(serviceJavaScript);
    return;
  }
  if (request.url === probePath) {
    response.writeHead(200, {
      "Content-Type": mediaType,
      "Content-Length": videoStat.size,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(inputVideo).pipe(response);
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
if (!address || typeof address === "string") {
  server.close();
  throw new Error("Video cache probe server did not bind to a TCP port.");
}

const browser = await chromium.launch({
  headless: true,
  args: ["--js-flags=--expose-gc"],
});
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on("console", (message) => {
  if (message.type() !== "error") return;
  consoleErrors.push(message.text());
});
page.on("pageerror", (error) => pageErrors.push(error.message));

const collectGarbage = async () => {
  const session = await page.context().newCDPSession(page);
  try {
    for (let index = 0; index < 4; index += 1) {
      await session.send("HeapProfiler.collectGarbage");
      await page.waitForTimeout(250);
    }
  } finally {
    await session.detach();
  }
};

const runProbeCycle = async () => {
  await page.waitForFunction(() => window.videoCacheProbeReady === true);
  const activeStats = await page.evaluate(() => window.runVideoCacheProbe());
  // The editor keeps its cache alive throughout rendered-review capture.
  // Collect once before disposal so the probe can detect frames abandoned by
  // an active decoder instead of letting Input.dispose() hide the leak.
  await collectGarbage();
  const clearedStats = await page.evaluate(() => window.clearVideoCacheProbe());
  await collectGarbage();
  return { activeStats, clearedStats };
};

let firstStats;
let secondStats;
try {
  await page.goto(`http://127.0.0.1:${address.port}/`, {
    waitUntil: "load",
  });
  firstStats = await runProbeCycle();
  await page.reload({ waitUntil: "load" });
  secondStats = await runProbeCycle();
  await page.goto("about:blank");
  await collectGarbage();
} finally {
  await browser.close();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

const videoFrameErrors = consoleErrors.filter((message) =>
  message.includes("VideoFrame was garbage collected without being closed")
);
console.log(JSON.stringify({
  inputVideo,
  alpha,
  firstStats,
  secondStats,
  videoFrameErrors,
  otherConsoleErrors: consoleErrors.filter(
    (message) => !videoFrameErrors.includes(message),
  ),
  pageErrors,
}, null, 2));

if (videoFrameErrors.length > 0 || consoleErrors.length > 0 || pageErrors.length > 0) {
  process.exitCode = 1;
}
