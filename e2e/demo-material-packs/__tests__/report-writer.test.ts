import { describe, expect, it } from "vitest";

import { redactEvidence, renderSummary } from "../report-writer";

describe("report writer", () => {
  it("lists P0 failures before blocked checks", () => {
    const markdown = renderSummary({ runId: "run-1", mode: "stable", scenarios: [{ id: "04", status: "failed", checks: [{ code: "U1", status: "blocked", severity: "P1" }, { code: "R7", status: "failed", severity: "P0" }] }] });
    expect(markdown.indexOf("R7")).toBeLessThan(markdown.indexOf("U1"));
  });

  it("redacts secrets recursively", () => {
    expect(redactEvidence({ Authorization: "Bearer secret", nested: { llm_api_key: "abc", model: "demo" } })).toEqual({ Authorization: "[REDACTED]", nested: { llm_api_key: "[REDACTED]", model: "demo" } });
  });
});
