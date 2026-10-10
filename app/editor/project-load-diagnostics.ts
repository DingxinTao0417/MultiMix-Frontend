const LOAD_STEPS = [
  "request_started", "response_received", "project_parsed", "media_hydration_started", "ready",
] as const;

export type ProjectLoadStep = typeof LOAD_STEPS[number];
export type ProjectLoadOptions = { embedded: boolean; online: boolean; apiSameOrigin: boolean };
export type ProjectLoadEvent = {
  id: string;
  timestamp: string;
  phase: ProjectLoadStep | "mounted" | "failed" | "page_hidden" | "unmounted";
  embedded: boolean;
  online: boolean;
  api_same_origin: boolean;
  http_status?: number;
  failed_at?: ProjectLoadStep | "mounted";
  error_kind?: "abort_error" | "type_error" | "syntax_error" | "error" | "unknown_error";
  after_unmount?: boolean;
};

function errorKind(error: unknown): ProjectLoadEvent["error_kind"] {
  if (error instanceof DOMException && error.name === "AbortError") return "abort_error";
  if (error instanceof TypeError) return "type_error";
  if (error instanceof SyntaxError) return "syntax_error";
  if (error instanceof Error) return "error";
  return "unknown_error";
}

export function createProjectLoadDiagnostic(
  options: ProjectLoadOptions,
  write: (event: ProjectLoadEvent) => void = (event) => console.info("[EditorLoad]", event),
) {
  // The identifier is local correlation only and contains no project identity.
  let id: string;
  try { id = crypto.randomUUID(); }
  catch { id = `load-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`; }
  let active: ProjectLoadStep | "mounted" = "mounted";
  let status: number | undefined;
  let unmounted = false;
  const context = {
    embedded: options.embedded === true,
    online: options.online === true,
    api_same_origin: options.apiSameOrigin === true,
  };
  function emit(phase: ProjectLoadEvent["phase"], details: Pick<ProjectLoadEvent, "failed_at" | "error_kind"> = {}) {
    try {
      write({ id, timestamp: new Date().toISOString(), phase, ...context,
        ...(status === undefined ? {} : { http_status: status }),
        ...(unmounted && phase !== "unmounted" ? { after_unmount: true } : {}), ...details });
    } catch { /* Diagnostic output must never change product execution. */ }
  }
  emit("mounted");
  return {
    stage(step: ProjectLoadStep, httpStatus?: number) {
      if (!LOAD_STEPS.includes(step)) return;
      active = step;
      if (typeof httpStatus === "number" && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) status = httpStatus;
      emit(step);
    },
    fail(error: unknown) { emit("failed", { failed_at: active, error_kind: errorKind(error) }); },
    pageHide() { emit("page_hidden"); },
    unmount() { if (!unmounted) { unmounted = true; emit("unmounted"); } },
  };
}
