import fs from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";


type RetainedDirectorRetrySeed = {
  backendUrl: string;
  email: string;
  password: string;
  conversationId: string;
  generationJobId: string;
  generationAttemptsBefore: number;
  ingestJobIds: string[];
  sourceAssetIds: number[];
  benchmarkSourceHashes: string[];
  resultDir: string;
};

type GenerationJob = {
  id?: string;
  status?: string;
  stage?: string;
  attempts?: number;
  result_asset_id?: number | null;
  error_code?: string | null;
  error_message?: string | null;
};

const seed = JSON.parse(
  process.env.VIDEO_PIPELINE_RETAINED_DIRECTOR_RETRY_SEED ?? "null",
) as RetainedDirectorRetrySeed | null;


async function authenticate(page: Page, value: RetainedDirectorRetrySeed): Promise<string> {
  const response = await page.request.post(`${value.backendUrl}/v1/auth/login`, {
    data: { email: value.email, password: value.password },
  });
  expect(response.ok(), `retained login failed: ${response.status()}`).toBe(true);
  const body = await response.json() as { access_token?: string };
  expect(body.access_token, "retained login returned no access token").toBeTruthy();
  const token = body.access_token!;
  await page.addInitScript(({ email, accessToken }) => {
    window.localStorage.setItem(
      "multimix_local_user",
      JSON.stringify({ email, token: accessToken }),
    );
  }, { email: value.email, accessToken: token });
  return token;
}


test("retries one retained quality-rejected director job without repeating ingestion", async ({ page }) => {
  test.setTimeout(25 * 60_000);
  if (!seed) throw new Error("VIDEO_PIPELINE_RETAINED_DIRECTOR_RETRY_SEED is missing");
  fs.mkdirSync(seed.resultDir, { recursive: true });
  const mutatingRequests: Array<{ method: string; url: string }> = [];
  page.on("request", (request) => {
    if (["POST", "PUT", "PATCH"].includes(request.method())) {
      mutatingRequests.push({ method: request.method(), url: request.url() });
    }
  });

  const token = await authenticate(page, seed);
  const headers = { authorization: `Bearer ${token}` };
  await page.goto(`/app/assets?conversation=${encodeURIComponent(seed.conversationId)}`);
  const retryButton = page.getByRole("button", { name: "重新执行此步骤", exact: true }).last();
  await expect(retryButton).toBeVisible({ timeout: 180_000 });
  await expect(retryButton).toBeEnabled();
  const retryResponsePromise = page.waitForResponse(
    (response) => response.request().method() === "POST"
      && response.url().includes(
        `/v1/assets/generation-jobs/${seed.generationJobId}/retry`,
      ),
    { timeout: 180_000 },
  );
  await retryButton.click();
  const retryResponse = await retryResponsePromise;
  const retryText = await retryResponse.text();
  expect(
    retryResponse.ok(),
    `retained director retry failed: ${retryResponse.status()} ${retryText}`,
  ).toBe(true);
  const retryJob = JSON.parse(retryText) as GenerationJob;
  expect(retryJob.id).toBe(seed.generationJobId);
  expect(["queued", "running"]).toContain(retryJob.status);

  let completedJob: GenerationJob | undefined;
  await expect.poll(async () => {
    const response = await page.request.get(
      `${seed.backendUrl}/v1/assets/generation-jobs/${seed.generationJobId}`,
      { headers },
    );
    if (!response.ok()) return `http-${response.status()}`;
    const job = await response.json() as GenerationJob;
    if (job.status === "failed") {
      throw new Error(
        `retained director retry failed (${job.error_code ?? "unknown"}): ${job.error_message ?? "unknown error"}`,
      );
    }
    if (job.status === "completed") {
      completedJob = job;
      return "completed";
    }
    return `${job.status ?? "unknown"}:${job.stage ?? "unknown"}`;
  }, { timeout: 20 * 60_000, intervals: [1000, 2500, 5000] }).toBe("completed");

  expect(completedJob?.result_asset_id).toBeTruthy();
  const retryRequests = mutatingRequests.filter(({ url }) => (
    url.includes(`/v1/assets/generation-jobs/${seed.generationJobId}/retry`)
  ));
  expect(retryRequests).toHaveLength(1);
  expect(
    mutatingRequests.filter(({ url }) => url.includes("/v1/assets/upload")),
  ).toEqual([]);

  fs.writeFileSync(
    path.join(seed.resultDir, "retained-director-retry-result.json"),
    `${JSON.stringify({
      generationJobId: seed.generationJobId,
      generationAttemptsBefore: seed.generationAttemptsBefore,
      generationAttemptsAfterExpected: seed.generationAttemptsBefore + 1,
      resultAssetId: completedJob?.result_asset_id,
      ingestJobIds: seed.ingestJobIds,
      sourceAssetIds: seed.sourceAssetIds,
      benchmarkSourceHashes: seed.benchmarkSourceHashes,
      mutatingRequests,
    }, null, 2)}\n`,
  );
});
