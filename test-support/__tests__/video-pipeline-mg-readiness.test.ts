import { expect as pollExpect } from "@playwright/test";
import { describe, expect, it } from "vitest";

import {
  getMgReadiness,
  plannedMgExecutions,
  type MgExecutionScene,
} from "../video-pipeline-mg-readiness";

const presenter = (...statuses: (string | undefined)[]): MgExecutionScene[] => [{
  id: "scene-1",
  mg_decision: { items: statuses.map((status, index) => ({
    event_id: `evt-${index + 1}`, needed: true, status,
  })) },
}];

describe("ordinary MG compatibility", () => {
  it("retains not-needed and root-level dispatch / terminal states", () => {
    expect(getMgReadiness([], "terminal")).toBe("not-needed");
    for (const status of ["planned", "stale", undefined]) {
      const scenes = [{ id: "s", mg_decision: { needed: true, status } }];
      expect(getMgReadiness(scenes, "dispatch")).toMatch(/^mg-not-dispatched:/);
      expect(getMgReadiness(scenes, "terminal")).toMatch(/^mg-in-flight:/);
    }
    for (const status of ["queued", "rendering", "rendered", "failed"]) {
      expect(getMgReadiness([{ id: "s", mg_decision: { needed: true, status } }], "dispatch"))
        .toBe("dispatched");
    }
    expect(getMgReadiness([{ id: "s", mg_decision: { needed: true, status: "rendered" } }], "terminal"))
      .toBe("ready");
    expect(() => getMgReadiness([{ id: "s", mg_decision: { needed: true, status: "failed" } }], "terminal"))
      .toThrow("all enabled MG scenes reached a failed terminal state");
  });
});

describe("Presenter per-event MG readiness", () => {
  it("does not call r13's rendering items not-needed", () => {
    expect(getMgReadiness(presenter("rendering"), "terminal")).toBe("mg-in-flight:scene-1/evt-1:rendering");
  });

  it("counts items instead of a parent summary and inspects every scene", () => {
    const scenes = presenter("rendered", "rendering");
    Object.assign(scenes[0].mg_decision!, { needed: true, status: "rendered" });
    scenes.push({ id: "scene-2", mg_decision: { items: [
      { event_id: "disabled", needed: false, status: "planned" },
      { event_id: "pending", needed: true, status: "queued" },
    ] } });
    expect(plannedMgExecutions(scenes)).toHaveLength(3);
    expect(getMgReadiness(scenes, "terminal")).toContain("scene-2/pending:queued");
    expect(getMgReadiness(scenes, "terminal")).toContain("scene-1/evt-2:rendering");
    expect(getMgReadiness([{ id: "s", mg_decision: { needed: true, items: [] } }], "terminal"))
      .toBe("not-needed");
  });

  it.each(["planned", "stale", undefined])("waits for item dispatch: %s", (status) => {
    expect(getMgReadiness(presenter(status), "dispatch")).toMatch(/^mg-not-dispatched:/);
  });

  it.each(["queued", "rendering", "unexpected", undefined])("does not accept a nonterminal item: %s", (status) => {
    expect(getMgReadiness(presenter("failed", status), "terminal")).toMatch(/^mg-in-flight:/);
  });

  it("waits for all terminal items before failure/success, preserving legacy all-failed behavior", () => {
    expect(() => getMgReadiness(presenter("failed", "failed"), "terminal"))
      .toThrow("all enabled MG scenes reached a failed terminal state");
    expect(getMgReadiness(presenter("failed", "rendered"), "terminal")).toBe("ready");
  });

  it("waits for native Presenter events as well as MG without changing publish required flags", () => {
    const scenes = presenter("rendered");
    scenes[0].visual_events = [
      { event_id: "native", type: "media_overlay", status: "rendering", required_for_publish: false },
      { event_id: "failed", type: "text_emphasis", status: "failed", required_for_publish: false },
    ];
    expect(getMgReadiness(scenes, "terminal", true)).toBe("presenter-events-in-flight:scene-1/native:rendering");
    // Ordinary videos retain their existing MG-only contract.
    expect(getMgReadiness(scenes, "terminal")).toBe("ready");
    scenes[0].visual_events[0].status = "rendered";
    expect(getMgReadiness(scenes, "terminal", true)).toBe("ready");
  });

  it("does not skip native-only Presenter plans or missing event status", () => {
    const scenes = [{ id: "s", visual_events: [{ event_id: "native" }] }];
    expect(getMgReadiness(scenes, "terminal", true)).toBe("presenter-events-in-flight:s/native:missing");
  });

  it("waits for other Presenter events before reporting that every MG failed", () => {
    const scenes = presenter("failed");
    scenes[0].visual_events = [{ event_id: "native", status: "planned", required_for_publish: true }];
    const before = structuredClone(scenes);
    expect(getMgReadiness(scenes, "terminal", true)).toBe("presenter-events-in-flight:scene-1/native:planned");
    expect(scenes).toEqual(before);
    scenes[0].visual_events[0].status = "rendered";
    expect(() => getMgReadiness(scenes, "terminal", true)).toThrow("failed terminal state");
  });

  it("actual Playwright poll consumes later snapshots, not the main-ready checkpoint", async () => {
    const snapshots = [presenter("planned"), presenter("rendering"), presenter("rendered")];
    let reads = 0;
    const observations: string[] = [];
    await pollExpect.poll(async () => {
      const state = getMgReadiness(structuredClone(snapshots[Math.min(reads++, 2)]), "terminal", true);
      observations.push(state);
      return state;
    }, { timeout: 1000, intervals: [1] }).toMatch(/^(?:ready|not-needed)$/);
    expect(reads).toBe(3);
    expect(observations).toEqual([
      "mg-in-flight:scene-1/evt-1:planned", "mg-in-flight:scene-1/evt-1:rendering", "ready",
    ]);
  });

  it("a stuck rendering event times out rather than passing as not-needed", async () => {
    let reads = 0;
    await expect(pollExpect.poll(() => {
      reads++;
      return getMgReadiness(presenter("rendering"), "terminal");
    }, { timeout: 50, intervals: [1] }).toMatch(/^(?:ready|not-needed)$/)).rejects.toThrow();
    expect(reads).toBeGreaterThan(1);
  });
});
