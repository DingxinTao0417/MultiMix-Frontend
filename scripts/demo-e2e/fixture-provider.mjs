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
        const system = String(messages.find((message) => message.role === "system")?.content || "");
        const key = String(messages.at(-1)?.content || "").trim();
        const match = Object.entries(llm).find(([candidate]) => key.includes(candidate));
        let content = match?.[1];
        if (!content && system.includes("classify a MultiMix content-production instruction")) content = { capability: "video_project", channel: "short_video", audience: "本地门窗客户", format: "video_project", ratio: "9:16", duration: "30", style: "真实克制", video_mode: "real_scene", operation: "draft", asset_requirements: [], confidence: 0.99 };
        if (!content && system.includes("generate MultiMix content artifacts")) content = {
          title: "门窗隔音获客视频",
          body_markdown: "# 门窗隔音获客视频\n\n素材不足的分镜需补充公开素材，不把施工图冒充为其他场景。",
          assistant_message: "已生成可编辑的编导稿，并标出素材缺口。",
          suggestions: ["确认，生成视频工程", "调整分镜"],
          video_segments: [
            { title: "噪音痛点", narration: "临街噪音是不是总打断你的休息？", subtitle: "临街噪音困扰", visual_brief: "临街住宅窗外车流", keywords: ["street traffic", "apartment window"], source_refs: [] },
            { title: "施工过程", narration: "规范安装过程决定门窗最终的密封表现。", subtitle: "安装过程", visual_brief: "工人在现场安装门窗", keywords: ["window installation", "worker tools"], source_refs: [] },
            { title: "现场测量", narration: "先测量窗洞和使用环境再确定方案。", subtitle: "先测量再设计", visual_brief: "技术人员使用仪器测量窗户", keywords: ["window measuring", "technician"], source_refs: [] },
            { title: "产品细节", narration: "型材玻璃和密封结构都需要逐项确认。", subtitle: "检查关键细节", visual_brief: "门窗型材与密封条特写", keywords: ["window frame", "rubber seal"], source_refs: [] },
            { title: "沟通方案", narration: "把现场情况发来我们先帮你梳理改造方向。", subtitle: "咨询改造方案", visual_brief: "顾问展示门窗改造方案", keywords: ["home consultation", "floor plan"], source_refs: [] }
          ]
        };
        if (!content) {
          console.error(JSON.stringify({ event: "missing_llm_fixture", system: system.slice(0, 240), fixture_key: key.slice(0, 240) }));
          return send(response, 422, { detail: "missing LLM fixture", fixture_key: key.slice(0, 200) });
        }
        return send(response, 200, { id: "fixture-completion", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(content) }, finish_reason: "stop" }] });
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
