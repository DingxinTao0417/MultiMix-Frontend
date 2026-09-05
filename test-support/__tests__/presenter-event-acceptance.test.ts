import { describe, expect, it } from "vitest";

import {
  assessPresenterEventExecution,
  freezePresenterEventSelection,
  freezePresenterPublicEventSelection,
  PRESENTER_EVENT_CAPABILITIES,
} from "../presenter-event-acceptance";

const event = (id: string, type = "text_emphasis") => ({
  event_id: id, type, start_word_id: "word-1", end_word_id: "word-2",
  spec_hash: "a".repeat(64), required_for_publish: false, status: "planned",
});
const plan = (events = [event("evt-001", "media_overlay"), event("evt-002")]) => ({
  scenes: [{ id: "scene-1", visual_events: [] }],
  director_plan: {
    recommended_id: "dir-001", published_candidate_id: "dir-001",
    candidates: [{ id: "dir-001", scene_visual_events: { "scene-1": events } }],
  },
});
const rendered = (input = plan()) => [{
  id: "scene-1",
  visual_events: input.director_plan.candidates[0].scene_visual_events["scene-1"]
    .map((item) => ({ ...item, status: "rendered" })),
}];

describe("natural Presenter selected-event acceptance", () => {
  it("freezes the selected public confirmation-card event contract", () => {
    const frozen = freezePresenterPublicEventSelection({
      kind: "presenter_project_confirmation",
      direction_default: "dir-001",
      direction_options: [{
        id: "dir-001",
        visual_events: [{
          scene_id: "scene-1",
          event_id: "event-1",
          type: "media_overlay",
          start_word_id: "word-1",
          end_word_id: "word-2",
          required_for_publish: false,
          status: "planned",
        }],
      }],
    });

    expect(frozen).toEqual({
      candidateId: "dir-001",
      events: [{
        scene_id: "scene-1",
        event_id: "event-1",
        type: "media_overlay",
        start_word_id: "word-1",
        end_word_id: "word-2",
        required_for_publish: false,
      }],
    });
  });

  it("accepts an explicit public recommendation with no packaging events", () => {
    const frozen = freezePresenterPublicEventSelection({
      kind: "presenter_project_confirmation",
      direction_default: "dir-001",
      direction_options: [{ id: "dir-001", visual_events: [] }],
    });

    const report = assessPresenterEventExecution(frozen, [{
      id: "scene-1",
      visual_events: [],
    }]);

    expect(report.errors).toEqual([]);
    expect(report.selectedTypes).toEqual([]);
    expect(report.notSelectedTypes).toEqual([...PRESENTER_EVENT_CAPABILITIES].sort());
  });

  it("accepts r16's two selected and rendered types without claiming all five", () => {
    const report = assessPresenterEventExecution(freezePresenterEventSelection(plan()), rendered());
    expect(report.errors).toEqual([]);
    expect(report.scope).toBe("selected-plan-execution");
    expect(report.selectedTypes).toEqual(["media_overlay", "text_emphasis"]);
    expect(report.renderedTypes).toEqual(report.selectedTypes);
    expect(report.notSelectedTypes).toEqual(["graphic_overlay", "media_takeover", "presenter_reframe"]);
  });

  it("freezes the pre-confirmation candidate, not the still-empty scene projection", () => {
    const input = plan();
    const frozen = freezePresenterEventSelection(input);
    input.director_plan.candidates[0].scene_visual_events["scene-1"].pop();
    const report = assessPresenterEventExecution(frozen, rendered(input));
    expect(report.errors).toContain("missing event: scene-1/evt-002");
    expect(frozen.events).toHaveLength(2);
    expect(Object.isFrozen(frozen.events[0])).toBe(true);
  });

  it("rejects a dropped event even when another of the same type renders", () => {
    const input = plan([event("first"), event("second")]);
    const actual = rendered(input);
    actual[0].visual_events.pop();
    expect(assessPresenterEventExecution(freezePresenterEventSelection(input), actual).errors)
      .toContain("missing event: scene-1/second");
  });

  it.each(["failed", "planned", "queued", "rendering", "stale", "cancelled", "unknown", undefined])(
    "does not count selected status %s as fully executed", (status) => {
      const actual = rendered();
      Object.assign(actual[0].visual_events[0], { status });
      const report = assessPresenterEventExecution(freezePresenterEventSelection(plan()), actual);
      expect(report.errors).toContain(`event not rendered: scene-1/evt-001:${status ?? "missing"}`);
      expect(report.events[0].requiredForPublish).toBe(false);
    },
  );

  it.each([
    ["type", "graphic_overlay"], ["start_word_id", "other-start"],
    ["end_word_id", "other-end"], ["spec_hash", "b".repeat(64)],
    ["required_for_publish", true],
  ])("rejects a changed frozen %s even with rendered status", (field, value) => {
    const actual = rendered();
    Object.assign(actual[0].visual_events[0], { [field as string]: value });
    expect(assessPresenterEventExecution(freezePresenterEventSelection(plan()), actual).errors)
      .toContain(`event contract changed: scene-1/evt-001:${field}`);
  });

  it("rejects extra events and duplicate IDs across scenes", () => {
    const actual = rendered();
    actual[0].visual_events.push({ ...event("extra"), status: "rendered" });
    actual.push({ id: "scene-2", visual_events: [actual[0].visual_events[0]] });
    const errors = assessPresenterEventExecution(freezePresenterEventSelection(plan()), actual).errors;
    expect(errors).toContain("unexpected event: scene-1/extra");
    expect(errors).toContain("duplicate event_id: evt-001");
  });

  it("rejects moving a selected event to a different scene", () => {
    const actual = rendered();
    actual[0].id = "other-scene";
    expect(assessPresenterEventExecution(freezePresenterEventSelection(plan()), actual).errors)
      .toContain("event contract changed: other-scene/evt-001:scene_id");
  });

  it("allows an explicit no-packaging decision, not a missing decision", () => {
    const input = plan([]);
    const report = assessPresenterEventExecution(freezePresenterEventSelection(input), rendered(input));
    expect(report.errors).toEqual([]);
    expect(report.notSelectedTypes).toEqual([...PRESENTER_EVENT_CAPABILITIES].sort());
    Object.assign(input.director_plan.candidates[0], { scene_visual_events: undefined });
    expect(() => freezePresenterEventSelection(input)).toThrow("scene_visual_events must be an object");
  });

  it.each([
    {}, { director_plan: {} },
    { ...plan(), director_plan: { ...plan().director_plan, recommended_id: "missing" } },
    { ...plan(), director_plan: { ...plan().director_plan, published_candidate_id: "other" } },
  ])("fails closed for missing or inconsistent candidate selection", (input) => {
    expect(() => freezePresenterEventSelection(input)).toThrow();
  });

  it("rejects duplicate candidates and unknown event scenes", () => {
    const input = plan();
    input.director_plan.candidates.push(input.director_plan.candidates[0]);
    expect(() => freezePresenterEventSelection(input)).toThrow("exactly one candidate");
    const unknown = plan();
    unknown.scenes[0].id = "other-scene";
    expect(() => freezePresenterEventSelection(unknown)).toThrow("unknown event scene");
  });

  it.each(["event_id", "type", "start_word_id", "end_word_id", "spec_hash", "required_for_publish"])(
    "rejects a missing frozen %s", (key) => {
      const input = plan();
      Reflect.deleteProperty(input.director_plan.candidates[0].scene_visual_events["scene-1"][0], key);
      expect(() => freezePresenterEventSelection(input)).toThrow(key);
    },
  );

  it("rejects unknown event types and duplicate frozen IDs", () => {
    expect(() => freezePresenterEventSelection(plan([event("one", "invented")]))).toThrow("type");
    expect(() => freezePresenterEventSelection(plan([event("same"), event("same")]))).toThrow("duplicate event_id");
  });

  it("does not allow malformed actual events to pass an empty selection", () => {
    const frozen = freezePresenterEventSelection(plan([]));
    expect(assessPresenterEventExecution(frozen, [{ id: "scene-1", visual_events: {} }]).errors.length)
      .toBeGreaterThan(0);
  });
});
