export type MgDecisionExecution = {
  event_id?: string;
  needed?: boolean;
  status?: string;
  last_error?: string;
};

export type MgExecutionScene = {
  id: string;
  mg_decision?: MgDecisionExecution & { items?: MgDecisionExecution[] };
  visual_events?: Array<{
    event_id?: string;
    type?: string;
    status?: string;
    required_for_publish?: boolean;
  }>;
};

type Execution = { id: string; status: string; lastError?: string };

export function plannedMgExecutions(scenes: readonly MgExecutionScene[]): Execution[] {
  return scenes.flatMap((scene) => {
    const decision = scene.mg_decision;
    // Presenter owns per-event items; a parent summary cannot override them.
    const items = Array.isArray(decision?.items) ? decision.items : decision ? [decision] : [];
    return items.flatMap((item, index) => item.needed === true ? [{
      id: Array.isArray(decision?.items) ? `${scene.id}/${item.event_id ?? `item-${index + 1}`}` : scene.id,
      status: item.status ?? "missing",
      lastError: item.last_error,
    }] : []);
  });
}

function diagnostic(items: readonly Execution[]): string {
  return items.map((item) => `${item.id}:${item.status}${item.lastError ? `(${item.lastError})` : ""}`).join(",");
}

export function getMgReadiness(
  scenes: readonly MgExecutionScene[],
  phase: "dispatch" | "terminal",
  includePresenterEvents = false,
): string {
  const items = plannedMgExecutions(scenes);
  if (phase === "dispatch") {
    if (items.length === 0) return "not-needed";
    const pending = items.filter((item) => ["planned", "stale", "missing"].includes(item.status));
    return pending.length > 0 ? `mg-not-dispatched:${diagnostic(pending)}` : "dispatched";
  }
  const pending = items.filter((item) => !["rendered", "failed"].includes(item.status));
  if (pending.length > 0) return `mg-in-flight:${diagnostic(pending)}`;
  if (includePresenterEvents) {
    const pendingEvents = scenes.flatMap((scene) => (scene.visual_events ?? [])
      .map((event, index) => ({
        id: `${scene.id}/${event.event_id ?? `event-${index + 1}`}`,
        status: event.status ?? "missing",
      })))
      .filter((event) => !["rendered", "failed"].includes(event.status));
    if (pendingEvents.length > 0) return `presenter-events-in-flight:${diagnostic(pendingEvents)}`;
  }
  if (items.length === 0) return "not-needed";
  if (!items.some((item) => item.status === "rendered")) {
    throw new Error(`all enabled MG scenes reached a failed terminal state: ${diagnostic(items)}`);
  }
  return "ready";
}
