import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(scriptDir, "..", "..");
const fixtureRoot = path.join(frontendRoot, "e2e", "demo-material-packs", "fixtures");

function readJson(name) { return JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), "utf8")); }
function send(response, status, payload) { response.writeHead(status, { "content-type": "application/json; charset=utf-8" }); response.end(JSON.stringify(payload)); }
async function body(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }

export async function createFixtureProvider({ port = 8398 } = {}) {
  const vision = readJson("mock-vision-responses.json");
  const llm = readJson("mock-llm-responses.json");
  const server = http.createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/healthz") return send(response, 200, { ok: true, provider: "multimix-demo-fixture" });
    if (request.method !== "POST") return send(response, 404, { detail: "not found" });
    try {
      const payload = await body(request);
      if (request.url?.startsWith("/analyze/")) {
        const key = String(payload.filename || payload.title || "");
        return vision[key] ? send(response, 200, vision[key]) : send(response, 422, { detail: "missing vision fixture", fixture_key: key });
      }
      if (request.url === "/v1/chat/completions" || request.url === "/chat/completions") {
        const messages = Array.isArray(payload.messages) ? payload.messages : [];
        const key = String(messages.at(-1)?.content || "").trim();
        const match = Object.entries(llm).find(([candidate]) => key.includes(candidate));
        if (!match) return send(response, 422, { detail: "missing LLM fixture", fixture_key: key.slice(0, 200) });
        return send(response, 200, { id: "fixture-completion", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(match[1]) }, finish_reason: "stop" }] });
      }
      return send(response, 404, { detail: "not found" });
    } catch (error) { return send(response, 400, { detail: error instanceof Error ? error.message : "invalid request" }); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  return { url: `http://127.0.0.1:${actualPort}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.DEMO_FIXTURE_PORT || 8398);
  const provider = await createFixtureProvider({ port });
  process.stdout.write(`${provider.url}\n`);
}
