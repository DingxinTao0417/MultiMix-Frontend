import fs from "node:fs";
import type { APIRequestContext } from "@playwright/test";

export class DemoApiClient {
  constructor(
    private readonly request: APIRequestContext,
    private readonly baseUrl: string,
    private readonly token?: string,
    private readonly email = "local@admin",
  ) {}
  static async create(request: APIRequestContext, baseUrl: string) {
    const response = await request.get(`${baseUrl}/v1/auth/local-dev-admin`);
    if (!response.ok()) throw new Error(`Local authentication failed ${response.status()}`);
    const payload = await response.json() as { access_token?: string; email?: string };
    if (!payload.access_token) throw new Error("Local authentication returned no access token");
    return new DemoApiClient(request, baseUrl, payload.access_token, payload.email ?? "local@admin");
  }
  browserSession(): { email: string; token: string } {
    if (!this.token) throw new Error("Local authentication token is unavailable");
    return { email: this.email, token: this.token };
  }
  private headers(): Record<string, string> { return this.token ? { Authorization: `Bearer ${this.token}` } : {}; }
  async uploadAsset(filePath: string, targetKind = "image") {
    const response = await this.request.post(`${this.baseUrl}/v1/assets/upload`, { headers: this.headers(), multipart: { file: { name: filePath.split(/[\\/]/).at(-1)!, mimeType: "application/octet-stream", buffer: fs.readFileSync(filePath) }, target_kind: targetKind } });
    if (!response.ok()) throw new Error(`Asset upload failed ${response.status()}: ${await response.text()}`);
    return response.json() as Promise<{ id: number; metadata?: Record<string, unknown> }>;
  }
  async getAsset(id: number) {
    const response = await this.request.get(`${this.baseUrl}/v1/assets/detail/${id}`, { headers: this.headers() });
    if (!response.ok()) throw new Error(`Asset read failed ${response.status()}`);
    const detail = await response.json() as { asset?: Record<string, unknown> };
    if (!detail.asset) throw new Error(`Asset detail ${id} is missing the asset payload`);
    return detail.asset;
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
  async waitForGenerationJob(id: string, timeoutMs = 20 * 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.request.get(
        `${this.baseUrl}/v1/assets/generation-jobs/${encodeURIComponent(id)}`,
        { headers: this.headers() },
      );
      if (!response.ok()) throw new Error(`Generation job read failed ${response.status()}`);
      const job = await response.json() as {
        status?: string;
        result_asset_id?: number | null;
        error_code?: string | null;
        error_message?: string | null;
      };
      if (job.status === "failed") {
        throw new Error(`Generation job failed (${job.error_code ?? "unknown"}): ${job.error_message ?? "unknown error"}`);
      }
      if (job.status === "completed" && job.result_asset_id) return job.result_asset_id;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new Error(`Timed out waiting for generation job ${id}`);
  }
}
