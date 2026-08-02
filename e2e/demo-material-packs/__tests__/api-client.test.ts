import { describe, expect, it } from "vitest";

import { DemoApiClient } from "../api-client";

describe("DemoApiClient local authentication", () => {
  it("obtains the local dev token before authenticated requests", async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const request = {
      get: async (url: string, options?: { headers?: Record<string, string> }) => {
        calls.push({ url, headers: options?.headers });
        return url.endsWith("/auth/local-dev-admin")
          ? { ok: () => true, json: async () => ({ access_token: "signed-local-token", email: "demo@multimix.local" }) }
          : { ok: () => true, json: async () => ({ asset: { id: 7, metadata: {} }, inbound_relations: [], outbound_relations: [] }) };
      },
    };

    const client = await DemoApiClient.create(request as never, "http://backend");
    expect(client.browserSession()).toEqual({ email: "demo@multimix.local", token: "signed-local-token" });
    const asset = await client.getAsset(7);

    expect(asset.id).toBe(7);
    expect(calls[1].url).toBe("http://backend/v1/assets/detail/7");
    expect(calls[1].headers).toEqual({ Authorization: "Bearer signed-local-token" });
  });
});
