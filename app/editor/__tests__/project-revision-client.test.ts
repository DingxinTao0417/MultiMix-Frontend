import { describe, expect, it, vi } from "vitest";

import { ProjectRevisionClient, saveVersionedProject } from "../project-revision-client";

const first = "a".repeat(64);
const second = "b".repeat(64);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("versioned editor project writes", () => {
  it("rejects a missing server fingerprint before any project write", async () => {
    const client = new ProjectRevisionClient();
    expect(() => client.load(null)).toThrow(/工程版本/);
    const operation = vi.fn();
    await expect(client.run(operation)).rejects.toThrow(/工程版本/);
    expect(operation).not.toHaveBeenCalled();
  });

  it("sends If-Match and advances only to the version returned by the server", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({ project_fingerprint: second }));
    const client = new ProjectRevisionClient();
    client.load(first);
    await client.run(async (revision) => ({
      result: null,
      revision: await saveVersionedProject({
        apiBase: "https://api.example.test",
        assetId: "7",
        token: "token",
        revision,
        project: { tracks: [] },
        fetchImpl,
      }),
    }));
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.example.test/v1/video/projects/7",
      expect.objectContaining({
        method: "PUT",
        headers: expect.objectContaining({ "If-Match": `"${first}"` }),
      }),
    );
    expect(client.current()).toBe(second);
  });

  it("serializes concurrent writes and supplies the second operation the first response version", async () => {
    const client = new ProjectRevisionClient();
    client.load(first);
    let finishFirst: (() => void) | undefined;
    const firstWrite = client.run(async (revision) => {
      expect(revision).toBe(first);
      await new Promise<void>((resolve) => { finishFirst = resolve; });
      return { result: "first", revision: second };
    });
    const secondOperation = vi.fn(async (revision: string) => ({ result: "second", revision }));
    const secondWrite = client.run(secondOperation);
    await Promise.resolve();
    expect(secondOperation).not.toHaveBeenCalled();
    finishFirst?.();
    await expect(firstWrite).resolves.toBe("first");
    await expect(secondWrite).resolves.toBe("second");
    expect(secondOperation).toHaveBeenCalledWith(second);
  });

  it("preserves the loaded version and surfaces a 412 conflict without retrying", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response({
      detail: { code: "project_version_conflict", message: "工程已有新的修改" },
    }, 412));
    const client = new ProjectRevisionClient();
    client.load(first);
    await expect(client.run(async (revision) => ({
      result: null,
      revision: await saveVersionedProject({
        apiBase: "https://api.example.test",
        assetId: "7",
        token: "token",
        revision,
        project: { tracks: [] },
        fetchImpl,
      }),
    }))).rejects.toThrow(/工程已有新的修改/);
    expect(client.current()).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
