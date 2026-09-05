// Capability inventory, not a per-video minimum. Backend tests independently
// compare their fixed execution cases against the production event registry.
export const PRESENTER_EVENT_CAPABILITIES = [
  "text_emphasis", "media_overlay", "graphic_overlay", "media_takeover", "presenter_reframe",
] as const;

const frozenFields = [
  "scene_id", "type", "start_word_id", "end_word_id", "spec_hash", "required_for_publish",
] as const;

type EventIdentity = Readonly<{
  scene_id: string;
  event_id: string;
  type: string;
  start_word_id: string;
  end_word_id: string;
  spec_hash?: string;
  required_for_publish: boolean;
}>;

export type FrozenPresenterSelection = Readonly<{
  candidateId: string;
  events: readonly EventIdentity[];
}>;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}

function identity(
  sceneId: string,
  event: Record<string, unknown>,
  requireSpecHash = true,
): EventIdentity {
  const type = text(event.type, "type");
  if (!(PRESENTER_EVENT_CAPABILITIES as readonly string[]).includes(type)) {
    throw new Error(`unknown event type: ${type}`);
  }
  if (typeof event.required_for_publish !== "boolean") {
    throw new Error("required_for_publish must be a boolean");
  }
  const specHash = typeof event.spec_hash === "string" ? event.spec_hash.trim() : "";
  if (requireSpecHash && !specHash) throw new Error("spec_hash is required");
  if (specHash && !/^[a-f0-9]{64}$/.test(specHash)) {
    throw new Error("spec_hash must be a SHA-256 digest");
  }
  return Object.freeze({
    scene_id: sceneId,
    event_id: text(event.event_id, "event_id"),
    type,
    start_word_id: text(event.start_word_id, "start_word_id"),
    end_word_id: text(event.end_word_id, "end_word_id"),
    ...(specHash ? { spec_hash: specHash } : {}),
    required_for_publish: event.required_for_publish,
  });
}

/** Freeze the safe event contract exposed by the confirmation card. */
export function freezePresenterPublicEventSelection(value: unknown): FrozenPresenterSelection {
  const plan = object(value, "confirmation_plan");
  if (plan.kind !== "presenter_project_confirmation") {
    throw new Error("confirmation_plan must be a presenter project confirmation");
  }
  const candidateId = text(plan.direction_default, "direction_default");
  if (!Array.isArray(plan.direction_options)) throw new Error("direction_options must be an array");
  const candidates = plan.direction_options.map((item) => object(item, "direction_option"))
    .filter((item) => item.id === candidateId);
  if (candidates.length !== 1) {
    throw new Error("direction_default must resolve to exactly one direction option");
  }
  const rawEvents = candidates[0].visual_events;
  if (!Array.isArray(rawEvents)) throw new Error("visual_events must be an array");
  const events: EventIdentity[] = [];
  const seen = new Set<string>();
  for (const raw of rawEvents) {
    const event = object(raw, "visual_event");
    const item = identity(text(event.scene_id, "scene_id"), event, false);
    if (seen.has(item.event_id)) throw new Error(`duplicate event_id: ${item.event_id}`);
    seen.add(item.event_id);
    events.push(item);
  }
  return Object.freeze({ candidateId, events: Object.freeze(events) });
}

/** Capture the displayed single-winner plan BEFORE the user confirms it. */
export function freezePresenterEventSelection(value: unknown): FrozenPresenterSelection {
  const plan = object(value, "video_plan");
  const director = object(plan.director_plan, "director_plan");
  const candidateId = text(director.recommended_id, "recommended_id");
  if (director.published_candidate_id != null && director.published_candidate_id !== candidateId) {
    throw new Error("published_candidate_id disagrees with recommended_id");
  }
  if (!Array.isArray(director.candidates)) throw new Error("candidates must be an array");
  const candidates = director.candidates.map((item) => object(item, "candidate"))
    .filter((item) => item.id === candidateId);
  if (candidates.length !== 1) throw new Error("recommended_id must resolve to exactly one candidate");
  if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) throw new Error("scenes are required");
  const sceneIds = new Set(plan.scenes.map((scene) => text(object(scene, "scene").id, "scene.id")));
  if (sceneIds.size !== plan.scenes.length) throw new Error("duplicate scene.id");
  const eventMap = object(candidates[0].scene_visual_events, "scene_visual_events");
  const events: EventIdentity[] = [];
  const seen = new Set<string>();
  for (const [sceneId, rawEvents] of Object.entries(eventMap)) {
    if (!sceneIds.has(sceneId)) throw new Error(`unknown event scene: ${sceneId}`);
    if (!Array.isArray(rawEvents)) throw new Error(`visual_events must be an array: ${sceneId}`);
    for (const raw of rawEvents) {
      const item = identity(sceneId, object(raw, "event"));
      if (seen.has(item.event_id)) throw new Error(`duplicate event_id: ${item.event_id}`);
      seen.add(item.event_id);
      events.push(item);
    }
  }
  return Object.freeze({ candidateId, events: Object.freeze(events) });
}

/** Test completeness, not the product's required/optional publish decision. */
export function assessPresenterEventExecution(selection: FrozenPresenterSelection, scenes: unknown) {
  const errors: string[] = [];
  const expected = new Map(selection.events.map((event) => [event.event_id, event]));
  const seen = new Set<string>();
  const events: Array<{
    sceneId: string; eventId: string; type: string; status: string; requiredForPublish: boolean;
  }> = [];
  try {
    if (!Array.isArray(scenes) || !scenes.length) throw new Error("project scenes are required");
    const sceneIds = new Set<string>();
    for (const rawScene of scenes) {
      const scene = object(rawScene, "scene");
      const sceneId = text(scene.id, "scene.id");
      if (sceneIds.has(sceneId)) errors.push(`duplicate scene.id: ${sceneId}`);
      sceneIds.add(sceneId);
      const rawEvents = scene.visual_events ?? [];
      if (!Array.isArray(rawEvents)) throw new Error(`visual_events must be an array: ${sceneId}`);
      for (const raw of rawEvents) {
        const event = object(raw, "event");
        const actual = identity(
          sceneId,
          event,
          selection.events.some((item) => Boolean(item.spec_hash)),
        );
        const label = `${sceneId}/${actual.event_id}`;
        if (seen.has(actual.event_id)) errors.push(`duplicate event_id: ${actual.event_id}`);
        seen.add(actual.event_id);
        const planned = expected.get(actual.event_id);
        if (!planned) {
          errors.push(`unexpected event: ${label}`);
        } else {
          for (const field of frozenFields) {
            if (planned[field] !== undefined && actual[field] !== planned[field]) {
              errors.push(`event contract changed: ${label}:${field}`);
            }
          }
        }
        const status = typeof event.status === "string" ? event.status : "missing";
        if (status !== "rendered") errors.push(`event not rendered: ${label}:${status}`);
        events.push({
          sceneId, eventId: actual.event_id, type: actual.type, status,
          requiredForPublish: planned?.required_for_publish ?? actual.required_for_publish,
        });
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  for (const item of selection.events) {
    if (!seen.has(item.event_id)) errors.push(`missing event: ${item.scene_id}/${item.event_id}`);
  }
  const selectedTypes = [...new Set(selection.events.map((item) => item.type))].sort();
  return {
    schemaVersion: "presenter-selected-event-acceptance:v1",
    scope: "selected-plan-execution",
    candidateId: selection.candidateId,
    selectedTypes,
    renderedTypes: [...new Set(events.filter((item) => item.status === "rendered").map((item) => item.type))].sort(),
    notSelectedTypes: PRESENTER_EVENT_CAPABILITIES.filter((type) => !selectedTypes.includes(type)).sort(),
    events,
    errors,
  };
}
