export type TimelineSaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export type TimelineFlushResult =
  | { status: "saved" }
  | { status: "error"; message: string };

type TimelineSaveCoordinatorOptions = {
  save: () => Promise<void>;
  onStateChange: (status: TimelineSaveStatus, message?: string) => void;
  debounceMs?: number;
  errorMessage?: string;
};

// Keeps the debounce as a throughput optimization while making the dirty
// version the source of truth. A flush always persists every version that was
// dirty when the request settles, including changes made during an in-flight PUT.
export class TimelineSaveCoordinator {
  private dirtyVersion = 0;
  private savedVersion = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<TimelineFlushResult> | null = null;
  private readonly debounceMs: number;
  private readonly errorMessage: string;

  constructor(private readonly options: TimelineSaveCoordinatorOptions) {
    this.debounceMs = options.debounceMs ?? 800;
    this.errorMessage = options.errorMessage ?? "保存失败，请检查网络后重试。";
  }

  markDirty(): void {
    this.dirtyVersion += 1;
    this.options.onStateChange("dirty");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  flush(): Promise<TimelineFlushResult> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) return this.inFlight;
    if (this.savedVersion >= this.dirtyVersion) {
      this.options.onStateChange("saved");
      return Promise.resolve({ status: "saved" });
    }

    const save = async (): Promise<TimelineFlushResult> => {
      while (this.savedVersion < this.dirtyVersion) {
        const version = this.dirtyVersion;
        this.options.onStateChange("saving");
        try {
          await this.options.save();
          this.savedVersion = version;
        } catch {
          this.options.onStateChange("error", this.errorMessage);
          return { status: "error", message: this.errorMessage };
        }
      }
      this.options.onStateChange("saved");
      return { status: "saved" };
    };
    this.inFlight = save().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
