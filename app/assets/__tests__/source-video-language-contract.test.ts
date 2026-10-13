import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const spec = readFileSync(
  new URL("../../../docs/specs/ui/video-artifact-browse-and-edit-states.md", import.meta.url),
  "utf8",
);
const api = readFileSync(new URL("../../../docs/API.md", import.meta.url), "utf8");

describe("unified video confirmation language", () => {
  test("chooses the single recommendation from its public contract rather than a retired video category", () => {
    expect(spec).toContain("recommendation_mode=single_winner");
    expect(spec).not.toContain("Presenter");
    expect(spec).not.toContain("通用讲解型编导稿");
    expect(spec).toContain("不按旧视频分类分流");
  });

  test("retains source audio, two confirmations and history restoration", () => {
    expect(spec).toContain("先“清理确认”，再“导演确认”");
    expect(spec).toContain("不得替换真人原声");
    expect(spec).toContain("恢复历史版本仍通过现有版本历史追加新版本");
  });

  test("documents the same structural direction contract in the API", () => {
    expect(api).not.toContain("Presenter");
    expect(api).not.toContain("通用讲解型编导稿");
    expect(api).toContain("recommendation_mode=single_winner");
    expect(api).toContain("source_video_direction_request");
    expect(api).toContain("source_video_direction_confirmation");
  });
});
