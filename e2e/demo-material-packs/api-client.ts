import fs from "node:fs";
import type { APIRequestContext } from "@playwright/test";

export class DemoApiClient {
  constructor(private readonly request: APIRequestContext, private readonly baseUrl: string, private readonly token?: string) {}
  private headers(): Record<string, string> { return this.token ? { Authorization: `Bearer ${this.token}` } : {}; }
  async uploadAsset(filePath: string, targetKind = "image") {
    const response = await this.request.post(`${this.baseUrl}/v1/assets/upload`, { headers: this.headers(), multipart: { file: { name: filePath.split(/[\\/]/).at(-1)!, mimeType: "application/octet-stream", buffer: fs.readFileSync(filePath) }, target_kind: targetKind } });
    if (!response.ok()) throw new Error(`Asset upload failed ${response.status()}: ${await response.text()}`);
    return response.json() as Promise<{ id: number; metadata?: Record<string, unknown> }>;
  }
  async getAsset(id: number) {
    const response = await this.request.get(`${this.baseUrl}/v1/assets/${id}`, { headers: this.headers() });
    if (!response.ok()) throw new Error(`Asset read failed ${response.status()}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async waitForUnderstanding(id: number, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const asset = await this.getAsset(id);
      const metadata = (asset.metadata ?? {}) as Record<string, unknown>;
      const understanding = (metadata.understanding ?? {}) as Record<string, unknown>;
      if (["ready", "failed"].includes(String(understanding.status))) return asset;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Timed out waiting for understanding of asset ${id}`);
  }
}
