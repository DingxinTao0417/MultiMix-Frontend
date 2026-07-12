import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { agentTimelineStepsFromBackend, videoJobTimelineSteps } from "../../../lib/asset-mappers";

const root = process.cwd();

function readAssetFile(path: string) {
  return readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
}

function loadProductionFunctions(
  path: string,
  names: string[],
): Record<string, (...args: never[]) => unknown> {
  const nativeRequire = createRequire(import.meta.url);
  const ts = nativeRequire("typescript") as typeof import("typescript");
  const source = readAssetFile(path);
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TSX,
  );
  const declarations = sourceFile.statements.filter((statement) => (
    ts.isFunctionDeclaration(statement)
    && Boolean(statement.name && names.includes(statement.name.text))
  ));
  const foundNames = new Set(declarations.flatMap((declaration) => (
    ts.isFunctionDeclaration(declaration) && declaration.name ? [declaration.name.text] : []
  )));
  const missing = names.filter((name) => !foundNames.has(name));
  if (missing.length) throw new Error("Production functions missing: " + missing.join(", "));
  const compiled = ts.transpileModule(
    declarations.map((declaration) => declaration.getText(sourceFile)).join("\n"),
    {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    },
  ).outputText;
  const productionModule = { exports: {} as Record<string, unknown> };
  const executeModule = new Function("module", "exports", compiled);
  executeModule(productionModule, productionModule.exports);
  return productionModule.exports as Record<string, (...args: never[]) => unknown>;
}

function loadWorkspaceDecision<T extends (...args: never[]) => unknown>(name: string): T {
  return loadProductionFunctions(
    "app/assets/components/assets-workspace-client.tsx",
    [name],
  )[name] as T;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsyncWork() {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

type TestConversation = {
  id: string;
  product: { metadata?: Record<string, unknown> };
  products?: Array<{ metadata?: Record<string, unknown> }>;
  messages?: Array<{
    role: "user" | "assistant";
    presentation?: string;
    metadata?: Record<string, unknown>;
  }>;
};

type TestVideoJob = {
  status: string;
  steps: Array<{ status: string }>;
};

type TestFullVideoJob = {
  id: string;
  assetId: number;
  status: string;
  renderStage: string;
  steps: Array<{
    key: string;
    label: string;
    status: string;
    elapsedSeconds: number | null;
    retryJobId: string | null;
  }>;
  errorMessage: string | null;
  project: Record<string, unknown> | null;
};

function fullVideoJob(
  id: string,
  overrides: Partial<TestFullVideoJob> = {},
): TestFullVideoJob {
  return {
    id,
    assetId: id === "main-2" ? 2 : 1,
    status: "completed",
    renderStage: "done",
    steps: [{
      key: "build_project",
      label: "组装可编辑视频工程",
      status: "done",
      elapsedSeconds: 1,
      retryJobId: null,
    }],
    errorMessage: null,
    project: {},
    ...overrides,
  };
}

describe("video execution polling decisions", () => {
  it("selects pending background jobs and the selected conversation job once without duplicates", () => {
    const executionVideoJobIds = loadWorkspaceDecision<(
      conversations: TestConversation[],
      selectedConversationId: string,
    ) => string[]>("executionVideoJobIds");
    const conversations: TestConversation[] = [
      {
        id: "selected",
        product: { metadata: { latest_job_public_id: "unused-fallback" } },
        products: [
          { metadata: { latest_job_public_id: "job-selected" } },
          { metadata: { latest_job_public_id: "job-selected" } },
        ],
      },
      {
        id: "background",
        product: {
          metadata: {
            latest_job_public_id: "job-background",
            orchestration_pending: true,
          },
        },
      },
      {
        id: "duplicate-background",
        product: {
          metadata: {
            latest_job_public_id: "job-background",
            orchestration_pending: true,
          },
        },
      },
      {
        id: "inactive",
        product: { metadata: { latest_job_public_id: "job-inactive" } },
      },
    ];

    expect(executionVideoJobIds(conversations, "selected")).toEqual([
      "job-selected",
      "job-background",
    ]);
  });

  it("restores the selected main job from the persisted execution anchor when asset metadata lost it", () => {
    const executionVideoJobIds = loadWorkspaceDecision<(
      conversations: TestConversation[],
      selectedConversationId: string,
    ) => string[]>("executionVideoJobIds");
    const conversations: TestConversation[] = [{
      id: "selected",
      product: { metadata: { latest_job_public_id: null } },
      products: [{ metadata: { latest_job_public_id: null } }],
      messages: [{
        role: "assistant",
        presentation: "execution_anchor",
        metadata: {
          job_public_id: "video-job-persisted",
          video_workflow_stage: "video_project_ready",
        },
      }],
    }];

    expect(executionVideoJobIds(conversations, "selected")).toEqual([
      "video-job-persisted",
    ]);
  });

  it.each([
    ["failed jobs", { status: "failed", steps: [] }, true],
    ["completed jobs with no steps", { status: "completed", steps: [] }, true],
    ["completed jobs with finished steps", { status: "completed", steps: [{ status: "done" }] }, true],
    ["completed main jobs with running MG", { status: "completed", steps: [{ status: "done" }, { status: "run" }] }, false],
    ["completed main jobs with waiting MG", { status: "completed", steps: [{ status: "done" }, { status: "wait" }] }, false],
    ["non-completed jobs", { status: "running", steps: [{ status: "done" }] }, false],
  ])("classifies %s without stopping active MG work", (_label, job, expected) => {
    const isExecutionTerminal = loadWorkspaceDecision<(job: TestVideoJob) => boolean>(
      "isExecutionTerminal",
    );

    expect(isExecutionTerminal(job)).toBe(expected);
  });

  it("requires two consecutive terminal observations so late MG dispatch is reconciled", () => {
    const resolveObservation = loadWorkspaceDecision<(
      wasObserved: boolean,
      isTerminal: boolean,
    ) => { observed: boolean; shouldFinalize: boolean }>(
      "resolveExecutionTerminalObservation",
    );

    expect(resolveObservation(false, true)).toEqual({ observed: true, shouldFinalize: false });
    expect(resolveObservation(true, false)).toEqual({ observed: false, shouldFinalize: false });
    expect(resolveObservation(false, true)).toEqual({ observed: true, shouldFinalize: false });
    expect(resolveObservation(true, true)).toEqual({ observed: true, shouldFinalize: true });
  });

  it.each([
    ["queued", "queued", "queued", ["run", "wait", "wait", "wait"]],
    ["running", "running", "segment", ["done", "done", "run", "wait"]],
    ["completed", "completed", "done", ["done", "done", "done", "done"]],
    ["failed", "failed", "render", ["done", "done", "done", "fail"]],
  ])("maps legacy %s jobs with empty backend steps into the real four-step skeleton", (
    _label,
    status,
    renderStage,
    expectedStatuses,
  ) => {
    const resolveLiveExecutionTimelineSteps = loadWorkspaceDecision<(
      live: {
        jobId: string;
        status: string;
        renderStage: string;
        steps: TestFullVideoJob["steps"];
      },
      mapBackendSteps: typeof agentTimelineStepsFromBackend,
      mapLegacySteps: typeof videoJobTimelineSteps,
    ) => ReturnType<typeof videoJobTimelineSteps>>("resolveLiveExecutionTimelineSteps");

    const steps = resolveLiveExecutionTimelineSteps(
      { jobId: "main-1", status, renderStage, steps: [] },
      agentTimelineStepsFromBackend,
      videoJobTimelineSteps,
    );

    expect(steps.map((step) => step.status)).toEqual(expectedStatuses);
    expect(steps).toHaveLength(4);
    if (status === "failed") {
      expect(steps.find((step) => step.status === "fail")?.retryJobId).toBe("main-1");
    }
  });

  it("processes one resolved job while another job GET remains pending", async () => {
    const startExecutionJobPolls = loadWorkspaceDecision<(args: {
      jobIds: Iterable<string>;
      inFlightJobIds: Set<string>;
      getJob: (jobId: string) => Promise<TestFullVideoJob>;
      isCancelled: () => boolean;
      onJob: (job: TestFullVideoJob) => void;
      onFetchError: (jobId: string, error: unknown) => void;
    }) => void>("startExecutionJobPolls");
    const first = deferred<TestFullVideoJob>();
    const second = deferred<TestFullVideoJob>();
    const inFlightJobIds = new Set<string>();
    const processed: string[] = [];
    const errors: string[] = [];

    startExecutionJobPolls({
      jobIds: ["main-1", "main-2"],
      inFlightJobIds,
      getJob: (jobId) => jobId === "main-1" ? first.promise : second.promise,
      isCancelled: () => false,
      onJob: (job) => processed.push(job.id),
      onFetchError: (jobId) => errors.push(jobId),
    });

    expect(inFlightJobIds).toEqual(new Set(["main-1", "main-2"]));
    first.resolve(fullVideoJob("main-1"));
    await flushAsyncWork();
    expect(processed).toEqual(["main-1"]);
    expect(errors).toEqual([]);
    expect(inFlightJobIds.has("main-1")).toBe(false);
    expect(inFlightJobIds.has("main-2")).toBe(true);

    second.resolve(fullVideoJob("main-2"));
    await flushAsyncWork();
  });

  it("isolates a per-job fetch failure from another job result", async () => {
    const startExecutionJobPolls = loadWorkspaceDecision<(args: {
      jobIds: Iterable<string>;
      inFlightJobIds: Set<string>;
      getJob: (jobId: string) => Promise<TestFullVideoJob>;
      isCancelled: () => boolean;
      onJob: (job: TestFullVideoJob) => void;
      onFetchError: (jobId: string, error: unknown) => void;
    }) => void>("startExecutionJobPolls");
    const first = deferred<TestFullVideoJob>();
    const second = deferred<TestFullVideoJob>();
    const inFlightJobIds = new Set<string>();
    const processed: string[] = [];
    const errors: string[] = [];

    startExecutionJobPolls({
      jobIds: ["main-1", "main-2"],
      inFlightJobIds,
      getJob: (jobId) => jobId === "main-1" ? first.promise : second.promise,
      isCancelled: () => false,
      onJob: (job) => processed.push(job.id),
      onFetchError: (jobId) => errors.push(jobId),
    });

    first.reject(new Error("job one unavailable"));
    second.resolve(fullVideoJob("main-2"));
    await flushAsyncWork();

    expect(errors).toEqual(["main-1"]);
    expect(processed).toEqual(["main-2"]);
    expect(inFlightJobIds.size).toBe(0);
  });

  it("keeps job GET ownership across effect generations until the old request settles", async () => {
    const startExecutionJobPolls = loadWorkspaceDecision<(args: {
      jobIds: Iterable<string>;
      inFlightJobIds: Set<string>;
      getJob: (jobId: string) => Promise<TestFullVideoJob>;
      isCancelled: () => boolean;
      onJob: (job: TestFullVideoJob) => void;
      onFetchError: (jobId: string, error: unknown) => void;
    }) => void>("startExecutionJobPolls");
    const generationAGet = deferred<TestFullVideoJob>();
    const generationBGet = deferred<TestFullVideoJob>();
    const sharedOwnership = new Set<string>();
    const processed: string[] = [];
    let generationACancelled = false;
    let fetchCalls = 0;

    startExecutionJobPolls({
      jobIds: ["main-1"],
      inFlightJobIds: sharedOwnership,
      getJob: () => {
        fetchCalls += 1;
        return generationAGet.promise;
      },
      isCancelled: () => generationACancelled,
      onJob: () => processed.push("generation-a"),
      onFetchError: () => undefined,
    });
    generationACancelled = true;

    const startGenerationB = () => startExecutionJobPolls({
      jobIds: ["main-1"],
      inFlightJobIds: sharedOwnership,
      getJob: () => {
        fetchCalls += 1;
        return generationBGet.promise;
      },
      isCancelled: () => false,
      onJob: () => processed.push("generation-b"),
      onFetchError: () => undefined,
    });

    startGenerationB();
    expect(fetchCalls).toBe(1);
    expect(sharedOwnership).toEqual(new Set(["main-1"]));

    generationAGet.resolve(fullVideoJob("main-1"));
    await flushAsyncWork();
    expect(processed).toEqual([]);
    expect(sharedOwnership.size).toBe(0);

    startGenerationB();
    expect(fetchCalls).toBe(2);
    generationBGet.resolve(fullVideoJob("main-1"));
    await flushAsyncWork();
    expect(processed).toEqual(["generation-b"]);
    expect(sharedOwnership.size).toBe(0);
  });

  it("starts a retried run GET without waiting for the old snapshot and drops the old result", async () => {
    const startExecutionJobPolls = loadWorkspaceDecision<(args: {
      jobIds: Iterable<string>;
      inFlightJobIds: Set<string>;
      requestIdentity?: (jobId: string) => string;
      isRequestCurrent?: (jobId: string, identity: string) => boolean;
      getJob: (jobId: string) => Promise<TestFullVideoJob>;
      isCancelled: () => boolean;
      onJob: (job: TestFullVideoJob) => void;
      onFetchError: (jobId: string, error: unknown) => void;
    }) => void>("startExecutionJobPolls");
    const oldSnapshot = deferred<TestFullVideoJob>();
    const newSnapshot = deferred<TestFullVideoJob>();
    const inFlightRequestIds = new Set<string>();
    const events: string[] = [];
    let generation = 0;
    let fetchCalls = 0;
    const currentIdentity = () => "main-1::" + generation;
    const startPoll = (snapshot: ReturnType<typeof deferred<TestFullVideoJob>>) => {
      startExecutionJobPolls({
        jobIds: ["main-1"],
        inFlightJobIds: inFlightRequestIds,
        requestIdentity: () => currentIdentity(),
        isRequestCurrent: (_jobId, identity) => identity === currentIdentity(),
        getJob: () => {
          fetchCalls += 1;
          return snapshot.promise;
        },
        isCancelled: () => false,
        onJob: (job) => events.push("poll:" + job.status),
        onFetchError: () => undefined,
      });
    };

    startPoll(oldSnapshot);
    generation += 1;
    events.push("store:queued");
    startPoll(newSnapshot);

    expect(fetchCalls).toBe(2);
    expect(inFlightRequestIds).toEqual(new Set(["main-1::0", "main-1::1"]));

    oldSnapshot.resolve(fullVideoJob("main-1", {
      status: "failed",
      renderStage: "render",
      steps: [],
      errorMessage: "old failed snapshot",
    }));
    await flushAsyncWork();
    expect(events).toEqual(["store:queued"]);
    expect(inFlightRequestIds).toEqual(new Set(["main-1::1"]));

    newSnapshot.resolve(fullVideoJob("main-1", {
      status: "queued",
      renderStage: "queued",
      steps: [],
      project: null,
    }));
    await flushAsyncWork();
    expect(events).toEqual(["store:queued", "poll:queued"]);
    expect(inFlightRequestIds.size).toBe(0);
  });

  it("suppresses refresh callbacks when cancellation happens during the ready refresh", async () => {
    const startReadyConversationRefresh = loadWorkspaceDecision<(args: {
      jobId: string;
      successfulJobIds: Set<string>;
      inFlightJobIds: Set<string>;
      isCancelled: () => boolean;
      refresh: () => Promise<string[]>;
      onRefreshed: (rows: string[]) => void;
      onRefreshError: (error: unknown) => void;
    }) => boolean>("startReadyConversationRefresh");
    const refresh = deferred<string[]>();
    const successfulJobIds = new Set<string>();
    const inFlightJobIds = new Set<string>();
    const callbacks: string[] = [];
    let cancelled = false;

    expect(startReadyConversationRefresh({
      jobId: "main-1",
      successfulJobIds,
      inFlightJobIds,
      isCancelled: () => cancelled,
      refresh: () => refresh.promise,
      onRefreshed: () => callbacks.push("state"),
      onRefreshError: () => callbacks.push("toast"),
    })).toBe(true);

    cancelled = true;
    refresh.resolve(["ready conversation"]);
    await flushAsyncWork();

    expect(callbacks).toEqual([]);
    expect(successfulJobIds.size).toBe(0);
  });

  it("keeps ready refresh ownership across generations until the old refresh settles", async () => {
    const startReadyConversationRefresh = loadWorkspaceDecision<(args: {
      jobId: string;
      successfulJobIds: Set<string>;
      inFlightJobIds: Set<string>;
      isCancelled: () => boolean;
      refresh: () => Promise<string[]>;
      onRefreshed: (rows: string[]) => void;
      onRefreshError: (error: unknown) => void;
    }) => boolean>("startReadyConversationRefresh");
    const generationARefresh = deferred<string[]>();
    const generationBRefresh = deferred<string[]>();
    const successfulJobIds = new Set<string>();
    const sharedOwnership = new Set<string>();
    const callbacks: string[] = [];
    let generationACancelled = false;
    let refreshCalls = 0;

    expect(startReadyConversationRefresh({
      jobId: "main-1",
      successfulJobIds,
      inFlightJobIds: sharedOwnership,
      isCancelled: () => generationACancelled,
      refresh: () => {
        refreshCalls += 1;
        return generationARefresh.promise;
      },
      onRefreshed: () => callbacks.push("generation-a"),
      onRefreshError: () => callbacks.push("generation-a-error"),
    })).toBe(true);
    generationACancelled = true;

    const startGenerationB = () => startReadyConversationRefresh({
      jobId: "main-1",
      successfulJobIds,
      inFlightJobIds: sharedOwnership,
      isCancelled: () => false,
      refresh: () => {
        refreshCalls += 1;
        return generationBRefresh.promise;
      },
      onRefreshed: () => callbacks.push("generation-b"),
      onRefreshError: () => callbacks.push("generation-b-error"),
    });

    expect(startGenerationB()).toBe(false);
    expect(refreshCalls).toBe(1);
    expect(sharedOwnership).toEqual(new Set(["main-1"]));

    generationARefresh.resolve(["stale rows"]);
    await flushAsyncWork();
    expect(callbacks).toEqual([]);
    expect(successfulJobIds.size).toBe(0);
    expect(sharedOwnership.size).toBe(0);

    expect(startGenerationB()).toBe(true);
    expect(refreshCalls).toBe(2);
    generationBRefresh.resolve(["fresh rows"]);
    await flushAsyncWork();
    expect(callbacks).toEqual(["generation-b"]);
    expect(successfulJobIds).toEqual(new Set(["main-1"]));
    expect(sharedOwnership.size).toBe(0);
  });

  it("builds a new request identity from a monotonically advanced run generation", () => {
    const production = loadProductionFunctions(
      "app/assets/components/assets-workspace-client.tsx",
      ["executionRunKey", "nextExecutionRunGeneration"],
    );
    const executionRunKey = production.executionRunKey as unknown as (
      jobId: string,
      generation: number,
    ) => string;
    const nextExecutionRunGeneration = production.nextExecutionRunGeneration as unknown as (
      generation: number,
    ) => number;

    const first = nextExecutionRunGeneration(0);
    const second = nextExecutionRunGeneration(first);

    expect(first).toBe(1);
    expect(second).toBe(2);
    expect(executionRunKey("main-1", first)).not.toBe(executionRunKey("main-1", second));
  });

  it("lets a retried run refresh immediately while discarding the old failed refresh", async () => {
    const startReadyConversationRefresh = loadWorkspaceDecision<(args: {
      jobId: string;
      requestIdentity?: string;
      isRequestCurrent?: (identity: string) => boolean;
      successfulJobIds: Set<string>;
      inFlightJobIds: Set<string>;
      isCancelled: () => boolean;
      refresh: () => Promise<string[]>;
      onRefreshed: (rows: string[]) => void;
      onRefreshError: (error: unknown) => void;
    }) => boolean>("startReadyConversationRefresh");
    const oldRefresh = deferred<string[]>();
    const newRefresh = deferred<string[]>();
    const successfulRequestIds = new Set<string>();
    const inFlightRequestIds = new Set<string>();
    const rows: string[] = [];
    let generation = 0;
    const currentIdentity = () => "main-1::" + generation;
    const oldIdentity = currentIdentity();

    expect(startReadyConversationRefresh({
      jobId: "main-1",
      requestIdentity: oldIdentity,
      isRequestCurrent: (identity) => identity === currentIdentity(),
      successfulJobIds: successfulRequestIds,
      inFlightJobIds: inFlightRequestIds,
      isCancelled: () => false,
      refresh: () => oldRefresh.promise,
      onRefreshed: (value) => rows.push(...value),
      onRefreshError: () => undefined,
    })).toBe(true);

    generation += 1;
    const newIdentity = currentIdentity();
    expect(startReadyConversationRefresh({
      jobId: "main-1",
      requestIdentity: newIdentity,
      isRequestCurrent: (identity) => identity === currentIdentity(),
      successfulJobIds: successfulRequestIds,
      inFlightJobIds: inFlightRequestIds,
      isCancelled: () => false,
      refresh: () => newRefresh.promise,
      onRefreshed: (value) => rows.push(...value),
      onRefreshError: () => undefined,
    })).toBe(true);
    expect(inFlightRequestIds).toEqual(new Set([oldIdentity, newIdentity]));

    oldRefresh.resolve(["stale failed conversation"]);
    await flushAsyncWork();
    expect(rows).toEqual([]);
    expect(successfulRequestIds.has(oldIdentity)).toBe(false);
    expect(inFlightRequestIds).toEqual(new Set([newIdentity]));

    newRefresh.resolve(["current queued conversation"]);
    await flushAsyncWork();
    expect(rows).toEqual(["current queued conversation"]);
    expect(successfulRequestIds).toEqual(new Set([newIdentity]));
    expect(inFlightRequestIds.size).toBe(0);
  });

  it("finalizes only the current run once after stale poll and refresh callbacks interleave", async () => {
    const production = loadProductionFunctions(
      "app/assets/components/assets-workspace-client.tsx",
      [
        "isExecutionTerminal",
        "resolveExecutionTerminalObservation",
        "startExecutionJobPolls",
        "startReadyConversationRefresh",
        "applyExecutionJobResult",
      ],
    );
    const startExecutionJobPolls = production.startExecutionJobPolls as unknown as (args: {
      jobIds: Iterable<string>;
      inFlightJobIds: Set<string>;
      requestIdentity?: (jobId: string) => string;
      isRequestCurrent?: (jobId: string, identity: string) => boolean;
      getJob: (jobId: string) => Promise<TestFullVideoJob>;
      isCancelled: () => boolean;
      onJob: (job: TestFullVideoJob) => void;
      onFetchError: (jobId: string, error: unknown) => void;
    }) => void;
    const startReadyConversationRefresh = production.startReadyConversationRefresh as unknown as (args: {
      jobId: string;
      requestIdentity?: string;
      isRequestCurrent?: (identity: string) => boolean;
      successfulJobIds: Set<string>;
      inFlightJobIds: Set<string>;
      isCancelled: () => boolean;
      refresh: () => Promise<string[]>;
      onRefreshed: (rows: string[]) => void;
      onRefreshError: (error: unknown) => void;
    }) => boolean;
    const applyExecutionJobResult = production.applyExecutionJobResult as unknown as (args: {
      job: TestFullVideoJob;
      isCancelled: () => boolean;
      publishJob: (job: TestFullVideoJob) => void;
      startReadyRefresh: (jobId: string) => void;
      readyRefreshSucceeded: (jobId: string) => boolean;
      hasTerminalObservation: (jobId: string) => boolean;
      setTerminalObservation: (jobId: string, observed: boolean) => void;
      finalizeJob: (job: TestFullVideoJob) => void;
    }) => void;
    const oldPoll = deferred<TestFullVideoJob>();
    const oldRefresh = deferred<string[]>();
    const firstNewPoll = deferred<TestFullVideoJob>();
    const secondNewPoll = deferred<TestFullVideoJob>();
    const newRefresh = deferred<string[]>();
    const pollInFlight = new Set<string>();
    const refreshInFlight = new Set<string>();
    const refreshSucceeded = new Set<string>();
    const terminalObservations = new Set<string>();
    const terminalJobs = new Set<string>();
    const published: string[] = [];
    const rows: string[] = [];
    const finalized: string[] = [];
    const refreshStarts: string[] = [];
    let toastCount = 0;
    let generation = 0;
    const currentIdentity = (jobId: string) => jobId + "::" + generation;
    const oldIdentity = currentIdentity("main-1");

    const startRefreshForCurrentRun = (jobId: string) => {
      const requestIdentity = currentIdentity(jobId);
      startReadyConversationRefresh({
        jobId,
        requestIdentity,
        isRequestCurrent: (identity) => identity === currentIdentity(jobId),
        successfulJobIds: refreshSucceeded,
        inFlightJobIds: refreshInFlight,
        isCancelled: () => false,
        refresh: () => {
          refreshStarts.push(requestIdentity);
          return requestIdentity === oldIdentity ? oldRefresh.promise : newRefresh.promise;
        },
        onRefreshed: (value) => rows.push(...value),
        onRefreshError: () => undefined,
      });
    };

    const processCurrentJob = (job: TestFullVideoJob) => {
      if (terminalJobs.has(job.id)) return;
      applyExecutionJobResult({
        job,
        isCancelled: () => false,
        publishJob: (value) => published.push(value.status),
        startReadyRefresh: startRefreshForCurrentRun,
        readyRefreshSucceeded: (jobId) => refreshSucceeded.has(currentIdentity(jobId)),
        hasTerminalObservation: (jobId) => terminalObservations.has(jobId),
        setTerminalObservation: (jobId, observed) => {
          if (observed) terminalObservations.add(jobId);
          else terminalObservations.delete(jobId);
        },
        finalizeJob: (value) => {
          terminalJobs.add(value.id);
          finalized.push(value.id);
          toastCount += 1;
        },
      });
    };

    startRefreshForCurrentRun("main-1");
    startExecutionJobPolls({
      jobIds: ["main-1"],
      inFlightJobIds: pollInFlight,
      requestIdentity: (jobId) => currentIdentity(jobId),
      isRequestCurrent: (jobId, identity) => identity === currentIdentity(jobId),
      getJob: () => oldPoll.promise,
      isCancelled: () => false,
      onJob: processCurrentJob,
      onFetchError: () => undefined,
    });

    generation += 1;
    const newIdentity = currentIdentity("main-1");
    const terminalJob = fullVideoJob("main-1", {
      status: "completed",
      renderStage: "done",
      steps: [],
    });
    startExecutionJobPolls({
      jobIds: ["main-1"],
      inFlightJobIds: pollInFlight,
      requestIdentity: (jobId) => currentIdentity(jobId),
      isRequestCurrent: (jobId, identity) => identity === currentIdentity(jobId),
      getJob: () => firstNewPoll.promise,
      isCancelled: () => false,
      onJob: processCurrentJob,
      onFetchError: () => undefined,
    });
    firstNewPoll.resolve(terminalJob);
    await flushAsyncWork();
    expect(refreshStarts).toEqual([oldIdentity, newIdentity]);
    expect(finalized).toEqual([]);

    oldPoll.resolve(fullVideoJob("main-1", {
      status: "failed",
      renderStage: "render",
      steps: [],
      errorMessage: "stale failure",
    }));
    oldRefresh.resolve(["stale failed conversation"]);
    await flushAsyncWork();
    expect(published).toEqual(["completed"]);
    expect(rows).toEqual([]);
    expect(refreshSucceeded.has(oldIdentity)).toBe(false);

    newRefresh.resolve(["current completed conversation"]);
    await flushAsyncWork();
    expect(rows).toEqual(["current completed conversation"]);
    expect(refreshSucceeded).toEqual(new Set([newIdentity]));

    startExecutionJobPolls({
      jobIds: ["main-1"],
      inFlightJobIds: pollInFlight,
      requestIdentity: (jobId) => currentIdentity(jobId),
      isRequestCurrent: (jobId, identity) => identity === currentIdentity(jobId),
      getJob: () => secondNewPoll.promise,
      isCancelled: () => false,
      onJob: processCurrentJob,
      onFetchError: () => undefined,
    });
    secondNewPoll.resolve(terminalJob);
    await flushAsyncWork();
    processCurrentJob(terminalJob);

    expect(finalized).toEqual(["main-1"]);
    expect(toastCount).toBe(1);
    expect(refreshStarts).toEqual([oldIdentity, newIdentity]);
  });

  it("retries a failed ready refresh and blocks terminalization until refresh succeeds", async () => {
    const production = loadProductionFunctions(
      "app/assets/components/assets-workspace-client.tsx",
      [
        "isExecutionTerminal",
        "resolveExecutionTerminalObservation",
        "startReadyConversationRefresh",
        "applyExecutionJobResult",
      ],
    );
    const startReadyConversationRefresh = production.startReadyConversationRefresh as unknown as (args: {
      jobId: string;
      successfulJobIds: Set<string>;
      inFlightJobIds: Set<string>;
      isCancelled: () => boolean;
      refresh: () => Promise<string[]>;
      onRefreshed: (rows: string[]) => void;
      onRefreshError: (error: unknown) => void;
    }) => boolean;
    const applyExecutionJobResult = production.applyExecutionJobResult as unknown as (args: {
      job: TestFullVideoJob;
      isCancelled: () => boolean;
      publishJob: (job: TestFullVideoJob) => void;
      startReadyRefresh: (jobId: string) => void;
      readyRefreshSucceeded: (jobId: string) => boolean;
      hasTerminalObservation: (jobId: string) => boolean;
      setTerminalObservation: (jobId: string, observed: boolean) => void;
      finalizeJob: (job: TestFullVideoJob) => void;
    }) => void;
    const successfulJobIds = new Set<string>();
    const inFlightJobIds = new Set<string>();
    const terminalObservations = new Set<string>();
    const finalized: string[] = [];
    const secondRefresh = deferred<string[]>();
    let refreshAttempts = 0;

    const startReadyRefresh = (jobId: string) => {
      startReadyConversationRefresh({
        jobId,
        successfulJobIds,
        inFlightJobIds,
        isCancelled: () => false,
        refresh: () => {
          refreshAttempts += 1;
          return refreshAttempts === 1
            ? Promise.reject(new Error("conversation reload failed"))
            : secondRefresh.promise;
        },
        onRefreshed: () => undefined,
        onRefreshError: () => undefined,
      });
    };
    const apply = () => applyExecutionJobResult({
      job: fullVideoJob("main-1"),
      isCancelled: () => false,
      publishJob: () => undefined,
      startReadyRefresh,
      readyRefreshSucceeded: (jobId) => successfulJobIds.has(jobId),
      hasTerminalObservation: (jobId) => terminalObservations.has(jobId),
      setTerminalObservation: (jobId, observed) => {
        if (observed) terminalObservations.add(jobId);
        else terminalObservations.delete(jobId);
      },
      finalizeJob: (job) => finalized.push(job.id),
    });

    apply();
    await flushAsyncWork();
    expect(refreshAttempts).toBe(1);
    expect(finalized).toEqual([]);
    expect(inFlightJobIds.size).toBe(0);

    apply();
    expect(refreshAttempts).toBe(2);
    expect(finalized).toEqual([]);
    secondRefresh.resolve(["ready conversation"]);
    await flushAsyncWork();
    expect(successfulJobIds.has("main-1")).toBe(true);
    expect(finalized).toEqual([]);

    apply();
    expect(refreshAttempts).toBe(2);
    expect(finalized).toEqual(["main-1"]);
  });

  it("publishes a failed main job but retries its conversation refresh before terminalizing", async () => {
    const production = loadProductionFunctions(
      "app/assets/components/assets-workspace-client.tsx",
      [
        "isExecutionTerminal",
        "resolveExecutionTerminalObservation",
        "startReadyConversationRefresh",
        "applyExecutionJobResult",
      ],
    );
    const startReadyConversationRefresh = production.startReadyConversationRefresh as unknown as (args: {
      jobId: string;
      successfulJobIds: Set<string>;
      inFlightJobIds: Set<string>;
      isCancelled: () => boolean;
      refresh: () => Promise<string[]>;
      onRefreshed: (rows: string[]) => void;
      onRefreshError: (error: unknown) => void;
    }) => boolean;
    const applyExecutionJobResult = production.applyExecutionJobResult as unknown as (args: {
      job: TestFullVideoJob;
      isCancelled: () => boolean;
      publishJob: (job: TestFullVideoJob) => void;
      startReadyRefresh: (jobId: string) => void;
      readyRefreshSucceeded: (jobId: string) => boolean;
      hasTerminalObservation: (jobId: string) => boolean;
      setTerminalObservation: (jobId: string, observed: boolean) => void;
      finalizeJob: (job: TestFullVideoJob) => void;
    }) => void;
    const failedJob = fullVideoJob("main-1", {
      status: "failed",
      renderStage: "render",
      steps: [],
      errorMessage: "main render failed",
      project: null,
    });
    const successfulJobIds = new Set<string>();
    const inFlightJobIds = new Set<string>();
    const terminalObservations = new Set<string>();
    const published: string[] = [];
    const finalized: string[] = [];
    const secondRefresh = deferred<string[]>();
    let refreshAttempts = 0;

    const startReadyRefresh = (jobId: string) => {
      startReadyConversationRefresh({
        jobId,
        successfulJobIds,
        inFlightJobIds,
        isCancelled: () => false,
        refresh: () => {
          refreshAttempts += 1;
          return refreshAttempts === 1
            ? Promise.reject(new Error("failed conversation reload"))
            : secondRefresh.promise;
        },
        onRefreshed: () => undefined,
        onRefreshError: () => undefined,
      });
    };
    const apply = () => applyExecutionJobResult({
      job: failedJob,
      isCancelled: () => false,
      publishJob: (job) => published.push(job.status),
      startReadyRefresh,
      readyRefreshSucceeded: (jobId) => successfulJobIds.has(jobId),
      hasTerminalObservation: (jobId) => terminalObservations.has(jobId),
      setTerminalObservation: (jobId, observed) => {
        if (observed) terminalObservations.add(jobId);
        else terminalObservations.delete(jobId);
      },
      finalizeJob: (job) => finalized.push(job.id),
    });

    apply();
    expect(published).toEqual(["failed"]);
    expect(refreshAttempts).toBe(1);
    expect(finalized).toEqual([]);
    await flushAsyncWork();

    apply();
    expect(refreshAttempts).toBe(2);
    expect(finalized).toEqual([]);
    secondRefresh.resolve(["failed persisted conversation"]);
    await flushAsyncWork();
    expect(successfulJobIds).toEqual(new Set(["main-1"]));

    apply();
    expect(refreshAttempts).toBe(2);
    expect(finalized).toEqual(["main-1"]);
  });

  it("leaves aggregate and execution refs unchanged when the retry endpoint rejects", async () => {
    const retryExecutionJob = loadWorkspaceDecision<(args: {
      retryJobId: string;
      executionJobId: string;
      isCancelled: () => boolean;
      retryJob: (jobId: string) => Promise<unknown>;
      getExecutionJob: (jobId: string) => Promise<TestFullVideoJob>;
      reactivateExecution: (jobId: string) => void;
      storeExecution: (job: TestFullVideoJob) => void;
      restartPolling: () => void;
      onRetryRejected: (error: unknown) => void;
      onAggregateRefreshFailed: (notice: string, error: unknown) => void;
      onSuccess: () => void;
    }) => Promise<void>>("retryExecutionJob");
    const terminalJobIds = new Set(["main-1"]);
    const activeJobIds = new Set<string>();
    const terminalObservations = new Set(["main-1"]);
    const liveAggregate = {
      jobId: "main-1",
      steps: [{ key: "mg_overlay", status: "fail", retryJobId: "mg-child" }],
      errorMessage: "MG failed",
    };
    const beforeAggregate = structuredClone(liveAggregate);
    const events: string[] = [];
    let getCalls = 0;

    await retryExecutionJob({
      retryJobId: "mg-child",
      executionJobId: "main-1",
      isCancelled: () => false,
      retryJob: async () => {
        throw new Error("retry endpoint unavailable");
      },
      getExecutionJob: async () => {
        getCalls += 1;
        return fullVideoJob("main-1");
      },
      reactivateExecution: (jobId) => {
        terminalJobIds.delete(jobId);
        terminalObservations.delete(jobId);
        activeJobIds.add(jobId);
      },
      storeExecution: () => events.push("store"),
      restartPolling: () => events.push("restart"),
      onRetryRejected: () => events.push("endpoint-rejected"),
      onAggregateRefreshFailed: () => events.push("refresh-failed"),
      onSuccess: () => events.push("success"),
    });

    expect(liveAggregate).toEqual(beforeAggregate);
    expect(terminalJobIds).toEqual(new Set(["main-1"]));
    expect(activeJobIds.size).toBe(0);
    expect(terminalObservations).toEqual(new Set(["main-1"]));
    expect(getCalls).toBe(0);
    expect(events).toEqual(["endpoint-rejected"]);
  });

  it("reactivates polling with truthful copy when accepted retry aggregate refresh fails", async () => {
    const retryExecutionJob = loadWorkspaceDecision<(args: {
      retryJobId: string;
      executionJobId: string;
      isCancelled: () => boolean;
      retryJob: (jobId: string) => Promise<unknown>;
      getExecutionJob: (jobId: string) => Promise<TestFullVideoJob>;
      reactivateExecution: (jobId: string) => void;
      storeExecution: (job: TestFullVideoJob) => void;
      restartPolling: () => void;
      onRetryRejected: (error: unknown) => void;
      onAggregateRefreshFailed: (notice: string, error: unknown) => void;
      onSuccess: () => void;
    }) => Promise<void>>("retryExecutionJob");
    const terminalJobIds = new Set(["main-1"]);
    const activeJobIds = new Set<string>();
    const terminalObservations = new Set(["main-1"]);
    const existingSteps = [{ key: "mg_overlay", status: "fail", retryJobId: "mg-child" }];
    let liveAggregate = {
      jobId: "main-1",
      steps: existingSteps,
      errorMessage: "MG failed",
    };
    const events: string[] = [];

    await retryExecutionJob({
      retryJobId: "mg-child",
      executionJobId: "main-1",
      isCancelled: () => false,
      retryJob: async (jobId) => {
        events.push("retry:" + jobId);
        return fullVideoJob("mg-child");
      },
      getExecutionJob: async (jobId) => {
        events.push("get:" + jobId);
        throw new Error("aggregate GET unavailable");
      },
      reactivateExecution: (jobId) => {
        events.push("reactivate:" + jobId);
        terminalJobIds.delete(jobId);
        terminalObservations.delete(jobId);
        activeJobIds.add(jobId);
      },
      storeExecution: () => events.push("store"),
      restartPolling: () => events.push("restart"),
      onRetryRejected: () => events.push("endpoint-rejected"),
      onAggregateRefreshFailed: (notice) => {
        events.push("refresh-failed");
        liveAggregate = { ...liveAggregate, errorMessage: notice };
      },
      onSuccess: () => events.push("success"),
    });

    expect(events).toEqual([
      "retry:mg-child",
      "reactivate:main-1",
      "get:main-1",
      "refresh-failed",
      "restart",
    ]);
    expect(terminalJobIds.size).toBe(0);
    expect(terminalObservations.size).toBe(0);
    expect(activeJobIds).toEqual(new Set(["main-1"]));
    expect(liveAggregate.jobId).toBe("main-1");
    expect(liveAggregate.steps).toBe(existingSteps);
    expect(liveAggregate.errorMessage).toBe("重试已受理，状态刷新失败，正在继续轮询");
  });

  it("awaits product retry through the unified execution path with the main ID twice", async () => {
    const dispatchProductVideoJobRetry = loadWorkspaceDecision<(args: {
      product: { metadata?: Record<string, unknown> };
      retryExecution: (retryJobId: string, executionJobId: string) => Promise<void>;
      onMissingJob: () => void;
    }) => Promise<boolean>>("dispatchProductVideoJobRetry");
    const calls: string[][] = [];
    let missingCalls = 0;
    let settled = false;
    const retryCompletion = deferred<void>();

    const delegated = dispatchProductVideoJobRetry({
      product: { metadata: { latest_job_public_id: "main-1" } },
      retryExecution: (...ids) => {
        calls.push(ids);
        return retryCompletion.promise;
      },
      onMissingJob: () => { missingCalls += 1; },
    });
    void Promise.resolve(delegated).then(() => {
      settled = true;
    });
    await flushAsyncWork();
    expect(settled).toBe(false);
    expect(calls).toEqual([["main-1", "main-1"]]);
    expect(missingCalls).toBe(0);

    retryCompletion.resolve();
    await expect(delegated).resolves.toBe(true);
    expect(settled).toBe(true);

    await expect(dispatchProductVideoJobRetry({
      product: { metadata: {} },
      retryExecution: async (...ids) => { calls.push(ids); },
      onMissingJob: () => { missingCalls += 1; },
    })).resolves.toBe(false);
    expect(calls).toEqual([["main-1", "main-1"]]);
    expect(missingCalls).toBe(1);
  });
});

describe("conversation execution timeline state", () => {
  type TimelineStep = {
    key: string;
    label: string;
    status: "done" | "run" | "wait" | "fail";
    retryJobId?: string;
  };
  type LiveTimelineState = {
    jobId: string;
    status: string;
    steps: TimelineStep[];
    errorMessage: string | null;
  };

  const loadTimelineResolver = () => (
    loadProductionFunctions(
      "app/assets/components/conversation-studio.tsx",
      ["resolveExecutionTimelineSteps"],
    ).resolveExecutionTimelineSteps as unknown as (
      liveRunState: LiveTimelineState | undefined,
      fallbackSteps: TimelineStep[] | undefined,
    ) => TimelineStep[]
  );

  it("creates a truthful main-job failure step only for failed empty live steps", () => {
    const resolveExecutionTimelineSteps = loadTimelineResolver();

    expect(resolveExecutionTimelineSteps({
      jobId: "main-1",
      status: "failed",
      steps: [],
      errorMessage: "main failed before steps",
    }, [])).toEqual([{
      key: "execution_failed",
      label: "视频工程生成失败",
      status: "fail",
      retryJobId: "main-1",
    }]);
  });

  it("does not invent a main retry for nonfailed empty steps or MG child failures", () => {
    const resolveExecutionTimelineSteps = loadTimelineResolver();
    const staticFallback: TimelineStep[] = [{
      key: "create_job",
      label: "创建视频工程任务",
      status: "run",
    }];
    const mgFailure: TimelineStep[] = [{
      key: "mg_overlay",
      label: "补充 MG 动效",
      status: "fail",
      retryJobId: "mg-child",
    }];

    expect(resolveExecutionTimelineSteps({
      jobId: "main-1",
      status: "completed",
      steps: [],
      errorMessage: null,
    }, staticFallback)).toBe(staticFallback);
    expect(resolveExecutionTimelineSteps({
      jobId: "main-1",
      status: "completed",
      steps: mgFailure,
      errorMessage: "MG failed",
    }, staticFallback)).toBe(mgFailure);
    expect(mgFailure[0].retryJobId).toBe("mg-child");
  });
});

describe("agent conversation UI copy", () => {
  it("does not use explicit generating text placeholders", () => {
    const conversationStudio = readAssetFile("app/assets/components/conversation-studio.tsx");
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(conversationStudio).not.toContain('assistantText: "正在生成"');
    expect(workspaceClient).not.toContain('text: "正在生成"');
  });

  it("keeps user-facing creation labels out of prompt/script wording", () => {
    const productWorkspace = readAssetFile("app/assets/components/product-workspace.tsx");
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(productWorkspace).toContain("明确要文案、图片或视频后");
    expect(workspaceClient).not.toContain("短视频脚本");
    expect(workspaceClient).not.toContain("图片提示词");
  });

  it("shows video plan summary with folded scene details", () => {
    const productPreview = readAssetFile("app/assets/components/product-preview.tsx");

    expect(productPreview).toContain("shadcn-prototype-video-plan-summary");
    expect(productPreview).toContain("编导稿摘要");
    expect(productPreview).toContain("编导稿草稿");
    expect(productPreview).toContain("当前是可编辑编导稿");
    expect(productPreview).not.toContain("<span>视频方案</span>");
    expect(productPreview).toContain("查看分镜详情");
    expect(productPreview).toContain("自动补素材");
  });

  it("keeps material gap display lightweight", () => {
    const productPreview = readAssetFile("app/assets/components/product-preview.tsx");

    expect(productPreview).toContain("shadcn-prototype-video-plan-gap");
    expect(productPreview).toContain("字幕/标题卡占位");
    expect(productPreview).toContain("个分镜自动加 MG");
    expect(productPreview).toContain("MG 风格：");
    expect(productPreview).toContain("MG：");
    expect(productPreview).not.toContain("素材覆盖度面板");
    expect(productPreview).not.toContain("MG 参数");
  });

  it("keeps asset library controls compact and avoids duplicate topbar upload", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(workspaceClient).not.toContain('{uploading ? "上传中..." : "上传"}');
    expect(workspaceClient).not.toContain("<span>库 /</span>");
    expect(libraryWorkshop).not.toContain("shadcn-prototype-library-title");
    expect(libraryWorkshop).toContain("shadcn-prototype-library-search compact");
    expect(globals).toContain("flex: 0 1 210px");
    expect(globals).toContain("max-width: 210px");
    expect(globals).not.toContain(".shadcn-prototype-library-title");
    expect(globals).not.toContain("animation: shadcn-prototype-spin");
  });

  it("keeps focus feedback on the input containers without an inner glow", () => {
    const globals = readAssetFile("app/globals.css");

    expect(globals).toMatch(
      /\.shadcn-prototype-start-dock textarea:focus\s*,\s*\.shadcn-prototype-library-search input:focus\s*\{[^}]*box-shadow:\s*none;[^}]*outline:\s*none;/s,
    );
    expect(globals).toMatch(
      /\.shadcn-prototype-library-search:focus-within\s*\{[^}]*border-color:\s*var\(--sp-accent-line\);/s,
    );
  });

  it("uses the same MultiMix brand glyph in the sidebar and login shell", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const appShell = readAssetFile("app/multimix-app.tsx");
    const globals = readAssetFile("app/globals.css");
    const brandPath = 'd="M2 12V2.5L7 8l5-5.5V12"';

    expect(appShell).toContain(brandPath);
    expect(workspaceClient).toContain(brandPath);
    expect(workspaceClient).not.toContain("shadcn-prototype-brand-letter");
    expect(globals).toContain(".shadcn-prototype-brand-mark svg");
  });

  it("keeps the conversation list as the flexible sidebar row so the account stays at the bottom", () => {
    const globals = readAssetFile("app/globals.css");

    expect(globals).toContain("grid-template-rows: auto auto auto minmax(0, 1fr) auto auto;");
    expect(globals).not.toContain("grid-template-rows: auto auto auto auto minmax(0, 1fr) auto;");
  });

  it("does not show left icons for copy rows and uses media thumbnails for image or video rows", () => {
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");

    expect(libraryWorkshop).toContain("row.kind === \"copy\" ? null");
    expect(libraryWorkshop).toContain("renderLibraryRowMedia(row, view)");
    expect(libraryWorkshop).toContain("shadcn-prototype-library-media-thumb");
  });

  it("uses asset library content type for media thumbnails and leaves non-media assets blank", () => {
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(libraryWorkshop).toContain("libraryRowMediaKind(row)");
    expect(libraryWorkshop).toContain("row.contentType === \"图片\"");
    expect(libraryWorkshop).toContain("row.contentType === \"视频\"");
    expect(libraryWorkshop).toContain("shadcn-prototype-library-media-thumb empty");
    expect(libraryWorkshop).toContain("with-video-media");
    expect(globals).toContain(".shadcn-prototype-library-grid.view-video");
    expect(globals).toContain(".shadcn-prototype-library-media-thumb.video");
  });

  it("supports chat source attachments inside the composer", () => {
    const conversationStudio = readAssetFile("app/assets/components/conversation-studio.tsx");
    const conversationStart = readAssetFile("app/assets/components/conversation-start.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(conversationStudio).toContain("shadcn-prototype-chat-image-attachment-button");
    expect(conversationStudio).toContain("shadcn-prototype-chat-file-attachment-button");
    expect(conversationStudio).toContain("IMAGE_UPLOAD_ACCEPT");
    expect(conversationStudio).toContain("SOURCE_UPLOAD_ACCEPT");
    expect(conversationStart).toContain("shadcn-prototype-start-dock-attach");
    expect(conversationStart).toContain("IMAGE_UPLOAD_ACCEPT");
    expect(conversationStart).toContain("SOURCE_UPLOAD_ACCEPT");
    expect(conversationStudio).toContain(".pptx");
    expect(conversationStudio).toContain("DOC_ONLY_INSTRUCTION");
    expect(conversationStudio).toContain("shadcn-prototype-chat-attachment-tray");
    expect(conversationStudio).toContain("shadcn-prototype-composer-control has-attachments");
    expect(conversationStudio).toContain("shadcn-prototype-chat-drop-hint");
    expect(conversationStudio).toContain("只上传资料时，我会先询问要基于它做什么");
    expect(globals).toContain(".shadcn-prototype-chat-attachment-tray");
    expect(globals).toContain("shadcn-prototype-composer-control.has-attachments");
    expect(globals).toContain("shadcn-prototype-composer-control.drag-active");
    expect(globals).toContain(".shadcn-prototype-chat-drop-hint");
    expect(globals).toContain(".shadcn-prototype-chat-file-attachment-button");
  });

  it("renders the demo-final start hero and input dock", () => {
    const conversationStart = readAssetFile("app/assets/components/conversation-start.tsx");
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(workspaceClient).toContain('initialConversationId === "new"');
    expect(conversationStart).toContain("今天想做什么内容？");
    expect(conversationStart).toContain("从一句话开始，MultiMix 会带着你的素材一起创作");
    expect(conversationStart).toContain("shadcn-prototype-start-dock");
    expect(conversationStart).toContain("支持拖入 PPT / 图片素材 · 只上传资料时，AI 会先问你要做什么");
    expect(conversationStart).toContain("shadcn-prototype-start-sugg-card");
    expect(globals).toContain(".shadcn-prototype-start-dock");
    expect(globals).toContain(".shadcn-prototype-start-sugg-grid");
    expect(globals).toContain("min-height: 52px");
  });

  it("keeps the conversation title scoped to the chat column", () => {
    const conversationStudio = readAssetFile("app/assets/components/conversation-studio.tsx");
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(workspaceClient).not.toContain("<span>对话 /</span>");
    expect(workspaceClient).not.toContain('selectedConversation.title}</strong>');
    expect(workspaceClient).toContain('accountEmail === "local@admin"');
    expect(workspaceClient).toContain('activeView === "conversation" ? "shadcn-prototype-inset conversation-inset"');
    expect(workspaceClient).toContain("diagnosticsSlot={renderDiagnostics()}");
    expect(conversationStudio).toContain("shadcn-prototype-chat-head");
    expect(conversationStudio).toContain("{selectedConversation.title}");
    expect(conversationStudio).toContain("diagnosticsSlot");
    expect(conversationStudio).toContain("shadcn-prototype-chat-head-actions");
    expect(conversationStudio).toContain("shadcn-prototype-composer-textarea");
    expect(globals).toContain("grid-template-rows: auto minmax(0, 1fr) auto");
    expect(globals).toContain(".shadcn-prototype-inset.conversation-inset");
    expect(globals).toContain(".shadcn-prototype-card .shadcn-prototype-chat-head");
    expect(globals).toContain("padding: 7px clamp(18px, 4vw, 30px)");
    expect(globals).toContain(".shadcn-prototype-composer-textarea");
    expect(globals).toContain("line-height: 20px");
  });

  it("shows the concrete LLM diagnostics error instead of a generic failure", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(workspaceClient).toContain("formatComposerError");
    expect(workspaceClient).toContain("catch (error)");
    expect(workspaceClient).toContain("error: formatComposerError(error)");
    expect(workspaceClient).toContain('diagnostics.error\n                  ? "检测失败"');
    expect(workspaceClient).not.toContain('error: "诊断失败"');
  });

  it("feeds live video-job steps into the conversation execution timeline", () => {
    const conversationStudio = readAssetFile("app/assets/components/conversation-studio.tsx");
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    // Shell derives the main job's aggregate execution state, keyed by asset id.
    expect(workspaceClient).toContain("agentTimelineStepsFromBackend");
    expect(workspaceClient).toContain("liveRunStateByAssetId");
    expect(workspaceClient).toContain("liveRunStateByAssetId={liveRunStateByAssetId}");
    expect(workspaceClient).toContain("onRetryExecution={handleRetryExecution}");
    // Studio reuses the same execution card for live steps, errors, and exact retries.
    expect(conversationStudio).toContain("liveRunStateByAssetId?.[message.assetId]");
    expect(conversationStudio).toContain("resolveExecutionTimelineSteps(liveRunState, message.runSteps)");
    expect(conversationStudio).toContain("errorMessage={liveRunState?.errorMessage}");
    expect(conversationStudio).toContain("onRetryExecution(retryJobId, liveRunState.jobId)");
    expect((conversationStudio.match(/<AgentRunTimeline/g) ?? []).length).toBe(1);
  });

  it("polls each execution independently through ready refresh and terminal reconciliation", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(workspaceClient).toContain("executionVideoJobIds");
    expect(workspaceClient).toContain("isExecutionTerminal");
    expect(workspaceClient).toContain('step.status === "run" || step.status === "wait"');
    expect(workspaceClient).toContain("terminalVideoJobIdsRef");
    expect(workspaceClient).toContain("readyConversationRefreshRef");
    expect(workspaceClient).toContain("terminalObservationVideoJobIdsRef");
    expect(workspaceClient).toContain("activeExecutionVideoJobIdsRef");
    expect(workspaceClient).toContain("...activeExecutionVideoJobIdsRef.current");
    expect(workspaceClient).toContain("inFlightVideoJobIdsRef");
    expect(workspaceClient).toContain("inFlightJobIds: inFlightVideoJobIdsRef.current");
    expect(workspaceClient).toContain("readyConversationRefreshInFlightRef");
    expect(workspaceClient).toContain("startExecutionJobPolls");
    expect(workspaceClient).toContain("startReadyConversationRefresh");
    expect(workspaceClient).toContain("applyExecutionJobResult");
    expect(workspaceClient).not.toContain("Promise.all(");
    expect(workspaceClient).not.toContain("Promise.allSettled(");
    expect(workspaceClient).not.toContain("const inFlightVideoJobIds = new Set<string>()");
    expect(workspaceClient).not.toContain("readyRefreshesStartedByEffect");
    expect(workspaceClient).not.toContain("readyRefreshInFlightJobIds.delete(");
    expect(workspaceClient).not.toContain("const finished = results.some");
  });

  it("retries the exact failed job then restores the main execution aggregate in order", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(workspaceClient).toContain("retryExecutionJob({");
    expect(workspaceClient).toContain("retryJob: (jobId) => assetWorkspaceAdapter.retryVideoJob(token, jobId)");
    expect(workspaceClient).toContain("getExecutionJob: (jobId) => assetWorkspaceAdapter.getVideoJob(token, jobId)");
    expect(workspaceClient).toContain("重试已受理，状态刷新失败，正在继续轮询");
    expect(workspaceClient).not.toContain("const retried = await assetWorkspaceAdapter.retryVideoJob");
  });

  it("uses a separate execution anchor for confirmation without a visible user bubble", () => {
    const conversationStudio = readAssetFile("app/assets/components/conversation-studio.tsx");

    expect(conversationStudio).toContain("optimisticallyConfirmed={confirmingPlanKey === confirmationPlanKey(message.plan)}");
    expect(conversationStudio).toContain('presentation: "execution_anchor"');
    expect(conversationStudio).toContain("runSteps: optimisticVideoProjectSteps()");
    expect(conversationStudio).toContain("mergeVisibleConversationMessages");
    expect(conversationStudio).toContain("shouldRenderMessageBody(message)");
    expect(conversationStudio).not.toContain('{ role: "user" as const, text: optimisticExchange.userText }');
  });

  it("renders visual placeholders instead of raw empty media labels in the library", () => {
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(libraryWorkshop).not.toContain("<span>无</span>");
    expect(libraryWorkshop).toContain("shadcn-prototype-library-media-placeholder");
    expect(libraryWorkshop).toContain("LibraryBigImageIcon");
    expect(globals).toContain(".shadcn-prototype-library-media-placeholder");
  });

  it("prioritizes a placeholder preview for video drafts before plan details", () => {
    const productPreview = readAssetFile("app/assets/components/product-preview.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(productPreview).toContain("shadcn-prototype-video-placeholder-preview");
    expect(productPreview.indexOf("shadcn-prototype-video-placeholder-preview")).toBeLessThan(productPreview.indexOf("shadcn-prototype-video-plan-summary"));
    expect(productPreview).toContain("product.preview?.posterText");
    expect(globals).toContain(".shadcn-prototype-video-placeholder-preview");
  });

  it("keeps public source management UI-rich without requiring provider data changes", () => {
    const adminSources = readAssetFile("app/admin/public-sources/page.tsx");
    const globals = readAssetFile("app/globals.css");

    expect(adminSources).toContain("添加素材源");
    expect(adminSources).toContain("优先级");
    expect(adminSources).toContain("今日额度");
    expect(adminSources).toContain("仅保存为本页草稿");
    expect(adminSources).toContain("frontOnlyDraftSources");
    expect(globals).toContain(".shadcn-prototype-admin-add");
    expect(globals).toContain(".shadcn-prototype-admin-quota");
  });

  it("renders explicit real-conversation loading states without demo fallback", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");

    expect(workspaceClient).toContain("useState<Conversation[]>([])");
    expect(workspaceClient).not.toContain("useState<Conversation[]>(() => assetWorkspaceAdapter.listConversations())");
    expect(workspaceClient).toContain("正在加载你的对话");
    expect(workspaceClient).toContain("还没有对话");
    expect(workspaceClient).toContain("对话加载失败");
    expect(workspaceClient).toContain("未连接后端");
    expect(workspaceClient).toContain("重新加载");
    expect(workspaceClient).not.toContain("显示本地样例数据");
  });

  it("uses uploaded documents as direct conversation source assets", () => {
    const workspaceClient = readAssetFile("app/assets/components/assets-workspace-client.tsx");
    const adapter = readAssetFile("app/assets/lib/asset-workspace-adapter.ts");

    expect(workspaceClient).toContain("createMaterialPackage");
    expect(workspaceClient).toContain("materialPackageAsset");
    expect(workspaceClient).toContain("sourceAttachmentAssets");
    expect(workspaceClient).toContain("upload.fileKind === \"source\"");
    expect(workspaceClient).toContain("上传图片不能超过 20 张");
    expect(adapter).toContain("/assets/material-packages");
  });

  it("offers download and delete actions for every library detail view", () => {
    const libraryWorkshop = readAssetFile("app/assets/components/library-workshop.tsx");
    const adapter = readAssetFile("app/assets/lib/asset-workspace-adapter.ts");

    expect(adapter).toContain("downloadAsset(token: string, assetId: number): Promise<Blob>");
    expect(adapter).toContain("deleteAsset(token: string, assetId: number): Promise<void>");
    expect(adapter).toContain("/download");
    expect(adapter).toContain('method: "DELETE"');
    expect(libraryWorkshop).toContain("handleDownload");
    expect(libraryWorkshop).toContain("handleDelete");
    expect(libraryWorkshop).toContain("确认删除");
    expect((libraryWorkshop.match(/<Download size=\{14\} aria-hidden=\"true\" \/>下载/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((libraryWorkshop.match(/删除/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
