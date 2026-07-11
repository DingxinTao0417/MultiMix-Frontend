import { describe, expect, it } from "vitest";

import { DemoApiClient } from "../api-client";

describe("DemoApiClient local authentication", () => {
  it("obtains the local dev token before authenticated requests", async () => {
    const calls: Array<{ url: string; headers?: Record<string, string> }> = [];
    const request = {
      get: async (url: string, options?: { headers?: Record<string, string> }) => {
        calls.push({ url, headers: options?.headers });
        return url.endsWith("/auth/local-dev-admin")
          ? { ok: () => true, json: async () => ({ access_token: "signed-local-token" }) }
          : { ok: () => true, json: async () => ({ id: 7, metadata: {} }) };
      },
    };

    const client = await DemoApiClient.create(request as never, "http://backend");
    await client.getAsset(7);

    expect(calls[1].headers).toEqual({ Authorization: "Bearer signed-local-token" });
  });
});
