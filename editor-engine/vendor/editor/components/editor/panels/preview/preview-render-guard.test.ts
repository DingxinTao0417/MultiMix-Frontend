import { describe, expect, it, vi } from "vitest";

import { settlePreviewRender } from "./preview-render-guard";

describe("settlePreviewRender", () => {
  it("releases the render lock when one frame rejects so later frames can render", async () => {
    const release = vi.fn();
    const report = vi.fn();

    await settlePreviewRender(Promise.reject(new Error("image load failed")), release, report);

    expect(report).toHaveBeenCalledWith(expect.any(Error));
    expect(release).toHaveBeenCalledTimes(1);
  });
});
