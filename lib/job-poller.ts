export class JobPollingTimeoutError extends Error {
  constructor(message = "任务等待超时，请稍后刷新状态或重试。") {
    super(message);
    this.name = "JobPollingTimeoutError";
  }
}

type TerminalJob = { status?: string };

export async function waitForJobTerminal<T extends TerminalJob>(
  load: () => Promise<T>,
  options: {
    intervalMs?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const intervalMs = Math.max(0, options.intervalMs ?? 1500);
  const timeoutMs = Math.max(0, options.timeoutMs ?? 5 * 60_000);
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException("任务等待已取消。", "AbortError");
    }
    if (Date.now() >= deadline) throw new JobPollingTimeoutError();

    const job = await load();
    if (job.status === "completed" || job.status === "failed") return job;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, intervalMs);
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("任务等待已取消。", "AbortError"));
      };
      options.signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
