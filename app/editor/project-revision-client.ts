const REVISION_PATTERN = /^[0-9a-f]{64}$/;

export class ProjectWriteError extends Error {
  constructor(message: string, readonly status: number, readonly payload: unknown) {
    super(message);
    this.name = "ProjectWriteError";
  }
}

function requireRevision(value: unknown): string {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    throw new Error("工程版本不可用，请刷新剪辑器后重试。");
  }
  return value;
}

function responseError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as Record<string, unknown>).detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const message = (detail as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

export class ProjectRevisionClient {
  private revision: string | null = null;
  private tail: Promise<void> = Promise.resolve();

  load(value: unknown): void {
    this.revision = requireRevision(value);
  }

  current(): string {
    return requireRevision(this.revision);
  }

  async idle(): Promise<void> {
    await this.tail;
  }

  run<T>(operation: (revision: string) => Promise<{ result: T; revision: string }>): Promise<T> {
    const run = this.tail.then(async () => {
      const outcome = await operation(this.current());
      this.revision = requireRevision(outcome.revision);
      return outcome.result;
    });
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }
}

export async function saveVersionedProject(args: {
  apiBase: string;
  assetId: string;
  token: string | null;
  revision: string;
  project: unknown;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const revision = requireRevision(args.revision);
  const response = await (args.fetchImpl ?? fetch)(
    `${args.apiBase}/v1/video/projects/${encodeURIComponent(args.assetId)}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "If-Match": `"${revision}"`,
        ...(args.token ? { Authorization: `Bearer ${args.token}` } : {}),
      },
      body: JSON.stringify(args.project),
    },
  );
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    throw new ProjectWriteError(
      responseError(payload, `工程保存检查失败（HTTP ${response.status}）`),
      response.status,
      payload,
    );
  }
  return requireRevision((payload as Record<string, unknown> | null)?.project_fingerprint);
}
